export const DEFAULT_API_URL = 'https://fde-takehome-projects-api-hkbn2zj27a-ue.a.run.app';

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const PROJECT_STATUSES = ['kickoff', 'wip', 'blocked', 'wrapped', 'dropped'];

export async function apiRequest(path, { baseUrl = DEFAULT_API_URL, fetchImpl = fetch, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new UpstreamError(method === 'GET'
      ? 'Could not reach the Projects API. Check your connection and try again.'
      : 'Connection interrupted during a write. The change may have saved. Refresh projects before trying again.');
  }
  if (!response.ok) {
    let detail;
    try { detail = (await response.json()).error; } catch { /* Fall back to status. */ }
    throw new UpstreamError(typeof detail === 'string' ? detail : `The Projects API returned HTTP ${response.status}.`,
      [400, 404, 409, 422].includes(response.status) ? response.status : 502);
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new UpstreamError(method === 'GET' ? 'The Projects API returned an unreadable response.'
      : 'The API accepted the write but returned an unreadable response. Refresh projects before trying again.');
  }
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new InputError('Invalid project or task ID.');
  return encodeURIComponent(value);
}

function text(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) {
    throw new InputError(`${label} ${allowEmpty ? 'must be text' : 'is required'} and must be ${max} characters or fewer.`);
  }
  return value.trim();
}

function projectFields(input, creating = false) {
  const fields = {};
  if (creating || input.title !== undefined) fields.title = text(input.title, 'Project title', 200);
  if (creating || input.description !== undefined) fields.description = text(input.description ?? '', 'Description', 5000, true);
  if (creating || input.status !== undefined) {
    fields.status = input.status ?? 'kickoff';
    if (!PROJECT_STATUSES.includes(fields.status)) throw new InputError('Choose a valid project status.');
  }
  if (!Object.keys(fields).length) throw new InputError('No project changes were supplied.');
  return fields;
}

function taskFields(input) {
  const task = text(input.title, 'Task title', 500);
  const who = text(input.assignee, 'Assignee', 100);
  const by = typeof input.dueAt === 'string' && input.dueAt.trim() ? new Date(input.dueAt).getTime() : NaN;
  if (!Number.isFinite(by)) throw new InputError('Choose a valid due date.');
  return { task, who, by };
}

const projectPath = id => `/api/v1/proj/${identifier(id)}`;
const taskPath = (projectId, taskId) => `${projectPath(projectId)}/items/${identifier(taskId)}`;

// This API does not update updated_at on normal writes. Timestamp failure must
// not make the UI report that an already-saved change failed.
async function withTouch(projectId, operation, options) {
  const result = await operation();
  try {
    await apiRequest(`${projectPath(projectId)}/touch`, { ...options, method: 'POST', body: {} });
    return { result };
  } catch {
    return { result, warning: 'Your change was saved, but the project’s updated time could not be refreshed.' };
  }
}

export async function getProject(projectId, options) {
  return normalizeProject(await apiRequest(projectPath(projectId), options));
}

export async function createProject(input, options) {
  return { result: await apiRequest('/api/v1/proj/new', { ...options, method: 'POST', body: projectFields(input, true) }) };
}

export async function updateProject(projectId, input, options) {
  const body = projectFields(input);
  return withTouch(projectId, () => apiRequest(`${projectPath(projectId)}/modify`, { ...options, method: 'PUT', body }), options);
}

export async function deleteProject(projectId, options) {
  return { result: await apiRequest(`${projectPath(projectId)}/remove`, { ...options, method: 'DELETE' }) };
}

export async function addTask(projectId, input, options) {
  const body = taskFields(input);
  return withTouch(projectId, () => apiRequest(`${projectPath(projectId)}/items/add`, { ...options, method: 'POST', body }), options);
}

export async function markTask(projectId, taskId, input, options) {
  if (typeof input.done !== 'boolean') throw new InputError('Task completion must be true or false.');
  return withTouch(projectId, () => apiRequest(`${taskPath(projectId, taskId)}/mark`, {
    ...options, method: 'POST', body: { flag: input.done ? 'yes' : 'no' },
  }), options);
}

export async function deleteTask(projectId, taskId, options) {
  return withTouch(projectId, () => apiRequest(`${taskPath(projectId, taskId)}/yank`, { ...options, method: 'DELETE' }), options);
}

// Explicit replacement: never pretend the upstream has an in-place task edit.
// Create first so a failed create cannot delete the original task.
export async function replaceTask(projectId, taskId, input, options) {
  const body = taskFields(input);
  const original = (await getProject(projectId, options)).todos.find(todo => todo.id === taskId);
  if (!original) throw new InputError('This task no longer exists. Refresh projects.', 404);
  return withTouch(projectId, async () => {
    const created = await apiRequest(`${projectPath(projectId)}/items/add`, { ...options, method: 'POST', body });
    if (typeof created?.id !== 'string' || !created.id || created.id === taskId) {
      throw new UpstreamError('The API did not return a new task ID. The original was kept. Refresh projects before retrying.');
    }
    if (original.done) {
      try {
        await apiRequest(`${taskPath(projectId, created.id)}/mark`, { ...options, method: 'POST', body: { flag: 'yes' } });
      } catch {
        throw new UpstreamError('A replacement task was created, but its completion could not be confirmed. The original was kept. Refresh to review both tasks before retrying.', 409);
      }
    }
    try {
      await apiRequest(`${taskPath(projectId, taskId)}/yank`, { ...options, method: 'DELETE' });
    } catch {
      throw new UpstreamError('A replacement task was created, but removal of the original could not be confirmed. Refresh to review the tasks before retrying.', 409);
    }
    return { ...created, done: original.done, replacedId: taskId };
  }, options);
}

export function normalizeProject(project) {
  if (typeof project.id !== 'string' || !Array.isArray(project.items)) {
    throw new UpstreamError('The Projects API returned an unexpected project format.');
  }
  return {
    id: project.id,
    title: project.title || 'Untitled project',
    description: project.description || '',
    status: project.status || 'unknown',
    updatedAt: toIso(project.updated_at),
    todos: project.items.map(normalizeTask),
  };
}

export function normalizeTask(item) {
  return { id: item.id, title: item.task || 'Untitled task', assignee: item.who || null, dueAt: toIso(item.by), done: item.done === true };
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The upstream defaults to 5 projects. Fetch every page before rendering totals.
export async function listProjects(options = {}) {
  const projects = new Map();
  let from = 0;
  const pageSize = 5;
  for (let page = 0; page < 200; page += 1) {
    const body = await apiRequest(`/api/v1/proj?from=${from}&take=${pageSize}`, options);
    if (!Array.isArray(body.projects) || !Number.isInteger(body.total) || body.total < 0) {
      throw new UpstreamError('The Projects API returned an unexpected project list.');
    }
    const previousSize = projects.size;
    for (const project of body.projects) projects.set(project.id, normalizeProject(project));
    if (projects.size >= body.total) return [...projects.values()];
    if (!body.projects.length || projects.size === previousSize) throw new UpstreamError('The Projects API returned an incomplete project list. Please refresh.');
    from += body.projects.length;
  }
  throw new UpstreamError('Could not load every project. Please refresh.');
}
