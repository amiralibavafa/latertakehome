import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSubmissionService } from './lib/submissions.js';
import { createActivityStore, createActivityRecorder, submissionEvents } from './lib/activity.js';
import { formatWeeklyReport } from './lib/report.js';
import { createChatService, loadGeminiConfig, ChatError } from './lib/chat.js';
import { apiRequest, DEFAULT_API_URL, listProjects, UpstreamError, InputError,
  createProject, updateProject, deleteProject, addTask, markTask, deleteTask, replaceTask } from './lib/projects.js';

const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.PROJECTS_API_URL || DEFAULT_API_URL;
const activityStore = createActivityStore({ filePath: process.env.ACTIVITY_FILE || fileURLToPath(new URL('./.local/activity.json', import.meta.url)) });
const recordChange = createActivityRecorder({ store: activityStore, projectOptions: { baseUrl } });
const tracked = (type, projectId, taskId, operation) => recordChange({ type, projectId, taskId, operation });
const submissions = createSubmissionService({
  filePath: process.env.SUBMISSIONS_FILE || fileURLToPath(new URL('./.local/submissions.json', import.meta.url)),
  projectOptions: { baseUrl },
});
const chat = createChatService({ config:loadGeminiConfig(), getSnapshot:workspaceSnapshot,
  snapshotPath:fileURLToPath(new URL('./.local/assistant-context.json',import.meta.url)) });
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/dates.js', ['dates.js', 'text/javascript; charset=utf-8']],
  ['/summary.js', ['summary.js', 'text/javascript; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(body, null, 2));
}

async function readJson(request) {
  if (!request.headers['content-type']?.includes('application/json')) throw new InputError('Send JSON data.', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new InputError('The submitted form is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw new InputError('The submitted form could not be read.'); }
}

async function activitySnapshot(receipts) {
  let history;
  try { history = await activityStore.read(); }
  catch { history = { trackingSince: null, events: [], warning: 'Activity history could not be read. Project data is still live.' }; }
  return { trackingSince: history.trackingSince, events: [...history.events, ...submissionEvents(receipts)].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    ...(history.warning ? { warning: history.warning } : {}) };
}

async function workspaceSnapshot() {
  const projects = await listProjects({ baseUrl });
  const receipts = await submissions.list();
  return { fetchedAt: new Date().toISOString(), source: 'Later Projects API', total: projects.length, projects,
    submissions: receipts, activity: await activitySnapshot(receipts) };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://localhost');
  const pathname = requestUrl.pathname;
  try {
    const options = { baseUrl };
    if (request.method === 'POST' && pathname === '/api/chat') return json(response,200,await chat.ask(await readJson(request)));
    const approveRoute = pathname.match(/^\/api\/submissions\/(sub_[a-zA-Z0-9_-]+)\/approve$/);
    const retryRoute = pathname.match(/^\/api\/submissions\/(sub_[a-zA-Z0-9_-]+)\/retry$/);
    if (request.method === 'POST' && ['/api/submissions', '/api/webhooks/task-submitted'].includes(pathname)) {
      const result = await submissions.submit(await readJson(request));
      return json(response, result.submission.status === 'uncertain' ? 202 : result.duplicate ? 200 : 201, result);
    }
    if (request.method === 'POST' && approveRoute) {
      const result = await submissions.approve(approveRoute[1], await readJson(request));
      return json(response, result.submission.status === 'uncertain' ? 202 : 200, result);
    }
    if (request.method === 'POST' && retryRoute) {
      const result = await submissions.retry(retryRoute[1]);
      return json(response, result.submission.status === 'uncertain' ? 202 : 200, result);
    }
    const projectRoute = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
    const tasksRoute = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/tasks$/);
    const taskRoute = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/tasks\/([a-zA-Z0-9_-]+)$/);
    const replaceRoute = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/tasks\/([a-zA-Z0-9_-]+)\/replace$/);
    if (request.method === 'POST' && pathname === '/api/projects') {
      const body = await readJson(request);
      return json(response, 201, await tracked('project.created', null, null, () => createProject(body, options)));
    }
    if (request.method === 'PATCH' && projectRoute) {
      const body = await readJson(request);
      return json(response, 200, await tracked('project.updated', projectRoute[1], null, () => updateProject(projectRoute[1], body, options)));
    }
    if (request.method === 'DELETE' && projectRoute) {
      await submissions.assertCanChange(projectRoute[1]);
      return json(response, 200, await tracked('project.deleted', projectRoute[1], null, () => deleteProject(projectRoute[1], options)));
    }
    if (request.method === 'POST' && tasksRoute) {
      const body = await readJson(request);
      return json(response, 201, await tracked('task.added', tasksRoute[1], null, () => addTask(tasksRoute[1], body, options)));
    }
    if (request.method === 'PATCH' && taskRoute) {
      const body = await readJson(request);
      if (body.done === true) await submissions.assertCanChange(taskRoute[1], taskRoute[2]);
      return json(response, 200, await tracked(body.done === true ? 'task.completed' : 'task.reopened', taskRoute[1], taskRoute[2], () => markTask(taskRoute[1], taskRoute[2], body, options)));
    }
    if (request.method === 'DELETE' && taskRoute) {
      await submissions.assertCanChange(taskRoute[1], taskRoute[2]);
      return json(response, 200, await tracked('task.deleted', taskRoute[1], taskRoute[2], () => deleteTask(taskRoute[1], taskRoute[2], options)));
    }
    if (request.method === 'POST' && replaceRoute) {
      await submissions.assertCanChange(replaceRoute[1], replaceRoute[2]);
      const body = await readJson(request);
      return json(response, 200, await tracked('task.replaced', replaceRoute[1], replaceRoute[2], () => replaceTask(replaceRoute[1], replaceRoute[2], body, options)));
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'That action is not supported on this URL.' });
    if (pathname === '/api/health') {
      const upstream = await apiRequest('/api/v1/health', { baseUrl });
      return json(response, 200, { status: 'ok', upstream });
    }
    if (pathname === '/api/chat/status') return json(response,200,chat.status());
    if (pathname === '/api/submissions') return json(response, 200, { submissions: await submissions.list() });
    if (pathname === '/api/activity') return json(response, 200, await activitySnapshot(await submissions.list()));
    if (pathname === '/api/report') {
      const timeZone = requestUrl.searchParams.get('timeZone') || 'America/Vancouver';
      try { new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()); }
      catch { throw new InputError('Choose a valid report timezone.'); }
      const report = formatWeeklyReport(await workspaceSnapshot(), { timeZone });
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="later-weekly-summary.md"', 'Cache-Control': 'no-store' });
      return response.end(request.method === 'HEAD' ? undefined : report);
    }
    if (pathname === '/api/projects' || pathname === '/api/snapshot') {
      const snapshot = await workspaceSnapshot();
      return json(response, 200, snapshot, pathname === '/api/snapshot'
        ? { 'Content-Disposition': 'attachment; filename="later-projects.json"' } : {});
    }
    const file = files.get(pathname);
    if (!file) return json(response, 404, { error: 'Not found.' });
    const content = await readFile(fileURLToPath(new URL(`./public/${file[0]}`, import.meta.url)));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error.message);
    const known = error instanceof UpstreamError || error instanceof InputError || error instanceof ChatError;
    json(response, known ? error.status : 500, {
      error: known ? error.message : 'Something went wrong while loading the workspace.',
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`\n  Later workspace → http://localhost:${port}\n  Live data from  → ${baseUrl}\n`);
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Try PORT=3001 npm start.` : error.message);
  process.exitCode = 1;
});
