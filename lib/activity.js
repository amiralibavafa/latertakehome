import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getProject, normalizeProject, normalizeTask } from './projects.js';

export function createActivityStore({ filePath, now = () => new Date() }) {
  let data;
  let tail = Promise.resolve();
  const serial = action => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  async function save(value) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(`${filePath}.tmp`, filePath);
  }
  async function load() {
    if (data) return;
    try {
      const existing = JSON.parse(await readFile(filePath, 'utf8'));
      if (existing.version !== 1 || !Array.isArray(existing.events) || !existing.trackingSince) throw new Error('Invalid activity history.');
      data = existing;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const initial = { version: 1, trackingSince: now().toISOString(), events: [] };
      await save(initial);
      data = initial;
    }
  }
  return {
    read: () => serial(async () => { await load(); return structuredClone(data); }),
    append: event => serial(async () => {
      await load();
      const next = { ...data, events: [...data.events, { ...event, id: `evt_${randomUUID()}`, occurredAt: now().toISOString() }] };
      await save(next);
      data = next;
    }),
  };
}

const projectFields = ['title', 'description', 'status'];
const taskFields = ['id', 'title', 'assignee', 'dueAt', 'done'];
function differences(before, after, fields) {
  return fields.filter(field => (before?.[field] ?? null) !== (after?.[field] ?? null)).map(field => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}

// Only confirmed successful changes are recorded. A logging failure must never
// disguise an already-saved upstream write as an unsaved edit.
export function createActivityRecorder({ store, projectOptions = {}, getProjectImpl = getProject }) {
  return async ({ type, projectId, taskId, operation }) => {
    const beforeProject = projectId ? await getProjectImpl(projectId, projectOptions) : null;
    const beforeTask = beforeProject?.todos.find(todo => todo.id === taskId);
    const result = await operation();
    try {
      let after;
      let changes;
      let title = beforeProject?.title;
      let taskTitle = beforeTask?.title;
      if (type.startsWith('project.')) {
        after = type === 'project.deleted' ? null : normalizeProject(result.result);
        title = after?.title || title;
        projectId ||= after?.id;
        changes = differences(beforeProject, after, projectFields);
        if (type === 'project.deleted') changes.push({ field: 'taskCount', before: beforeProject.todos.length, after: 0 });
      } else {
        after = type === 'task.deleted' ? null : normalizeTask(result.result);
        taskTitle = after?.title || taskTitle;
        changes = differences(beforeTask, after, type === 'task.completed' || type === 'task.reopened' ? ['done'] : taskFields);
      }
      if (changes.length) await store.append({
        type, projectId, projectTitle: title, taskId: after?.id && type.startsWith('task.') ? after.id : taskId || null,
        taskTitle: taskTitle || null, actor: 'Workspace', source: 'workspace', changes,
      });
      return result;
    } catch {
      return { ...result, warning: [result.warning, 'Your change was saved, but its activity history could not be recorded.'].filter(Boolean).join(' ') };
    }
  };
}

// Submission receipts already carry real timestamps. Derive their timeline
// without inventing earlier project edits or duplicating stored audit events.
export function submissionEvents(submissions) {
  return submissions.flatMap(item => {
    const base = { projectId: item.projectId, projectTitle: item.projectTitle, taskId: item.taskId, taskTitle: item.taskTitle, source: 'submission', changes: [] };
    const events = [{ ...base, id: `${item.id}:submitted`, type: 'work.submitted', actor: item.submitter, occurredAt: item.submittedAt, mode: item.mode }];
    if (item.status === 'approved' && item.completedAt) events.push({ ...base, id: `${item.id}:approved`, type: 'work.approved', actor: item.reviewedBy || 'Reviewer', occurredAt: item.completedAt });
    if (item.status === 'completed' && item.completedAt) events.push({ ...base, id: `${item.id}:completed`, type: 'work.completed', actor: item.submitter, occurredAt: item.completedAt });
    return events;
  });
}
