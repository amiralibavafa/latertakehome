import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getProject, markTask, InputError } from './projects.js';

const waiting = submission => submission.mode === 'review' && ['pending', 'processing', 'uncertain'].includes(submission.status);
const copy = value => structuredClone(value);

function required(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${label} is required (${max} characters maximum).`);
  return value.trim();
}

function submissionInput(input) {
  const fields = {
    eventId: required(input.eventId, 'A unique form event ID'),
    projectId: required(input.projectId, 'Project ID', 128),
    taskId: required(input.taskId, 'Task ID', 128),
    submitter: required(input.submitter, 'Your name', 100),
    mode: input.mode,
    notes: input.notes ?? '',
  };
  if (!['review', 'complete'].includes(fields.mode)) throw new InputError('Choose review or automatic completion.');
  if (typeof fields.notes !== 'string' || fields.notes.length > 2000) throw new InputError('Submission notes must be 2000 characters or fewer.');
  fields.notes = fields.notes.trim();
  return fields;
}

// Only workflow metadata is local. Projects/tasks remain in Later's resettable API.
// A single queue serializes event deduplication and review decisions in this process.
export function createSubmissionService({ filePath, projectOptions = {}, getProjectImpl = getProject, markTaskImpl = markTask, now = () => new Date() }) {
  let records;
  let tail = Promise.resolve();
  const serial = operation => {
    const run = tail.then(operation);
    tail = run.catch(() => {});
    return run;
  };
  async function load() {
    if (records) return;
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.submissions)) throw new Error('Invalid submission store.');
      records = data.submissions;
      // A crash may occur after an upstream write but before its receipt is saved.
      for (const record of records) if (record.status === 'processing') {
        record.status = 'uncertain';
        record.error = 'The app restarted during completion. Check and retry completion to reconcile the task.';
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      records = [];
    }
  }
  async function persist() {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, submissions: records }, null, 2), { mode: 0o600 });
    await rename(temporary, filePath);
  }
  async function taskFor(projectId, taskId) {
    let project;
    try { project = await getProjectImpl(projectId, projectOptions); }
    catch (error) {
      if (error.status === 404) throw new InputError('The project no longer exists. The API may have reset; choose a current project and task.', 409);
      throw error;
    }
    const task = project.todos.find(todo => todo.id === taskId);
    if (!task) throw new InputError('The task no longer exists. It may have been replaced or the API reset.', 409);
    return { project, task };
  }
  async function finish(record, task) {
    record.status = 'processing';
    record.error = null;
    await persist();
    let warning;
    try {
      if (!task.done) warning = (await markTaskImpl(record.projectId, record.taskId, { done: true }, projectOptions)).warning;
    } catch (error) {
      record.status = 'uncertain';
      record.error = error.message;
      await persist();
      return { submission: copy(record), warning: 'Submission saved, but task completion could not be confirmed. Use Check & retry to reconcile it.' };
    }
    record.status = record.mode === 'review' ? 'approved' : 'completed';
    record.completedAt = now().toISOString();
    await persist();
    return { submission: copy(record), ...(warning ? { warning } : {}) };
  }
  return {
    list: () => serial(async () => { await load(); return copy(records).reverse(); }),
    submit: input => serial(async () => {
      const fields = submissionInput(input);
      await load();
      const fingerprint = JSON.stringify(fields);
      const existing = records.find(record => record.eventId === fields.eventId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new InputError('This event ID was already used with different submission details. Use a new ID for a new form event.', 409);
        return { submission: copy(existing), duplicate: true };
      }
      if (records.some(record => record.projectId === fields.projectId && record.taskId === fields.taskId && waiting(record))) {
        throw new InputError('This task already has a submission awaiting review. Review it in Submissions.', 409);
      }
      const { project, task } = await taskFor(fields.projectId, fields.taskId);
      if (fields.mode === 'review' && task.done) throw new InputError('This task is already complete. Reopen it before requesting review.', 409);
      const record = {
        ...fields, id: `sub_${randomUUID()}`, fingerprint,
        projectTitle: project.title, taskTitle: task.title, assignee: task.assignee,
        dueAt: task.dueAt, submittedAt: now().toISOString(),
        status: fields.mode === 'review' ? 'pending' : 'processing',
        reviewedBy: null, reviewedAt: null, completedAt: null, error: null,
      };
      records.push(record);
      await persist();
      return fields.mode === 'review' ? { submission: copy(record) } : finish(record, task);
    }),
    approve: (id, input) => serial(async () => {
      const reviewer = required(input.reviewer, 'Reviewer name', 100);
      await load();
      const record = records.find(record => record.id === id);
      if (!record) throw new InputError('Submission not found.', 404);
      if (record.status === 'approved') return { submission: copy(record), duplicate: true };
      if (record.mode !== 'review' || record.status !== 'pending') throw new InputError('This submission is not waiting for approval.', 409);
      const { task } = await taskFor(record.projectId, record.taskId);
      record.reviewedBy = reviewer;
      record.reviewedAt = now().toISOString();
      return finish(record, task);
    }),
    retry: id => serial(async () => {
      await load();
      const record = records.find(record => record.id === id);
      if (!record) throw new InputError('Submission not found.', 404);
      if (['approved', 'completed'].includes(record.status)) return { submission: copy(record), duplicate: true };
      if (record.status !== 'uncertain' || (record.mode === 'review' && !record.reviewedBy)) {
        throw new InputError('This submission needs a manager’s approval before completion.', 409);
      }
      const { task } = await taskFor(record.projectId, record.taskId);
      return finish(record, task);
    }),
    assertCanChange: (projectId, taskId = null) => serial(async () => {
      await load();
      if (records.some(record => record.projectId === projectId && (!taskId || record.taskId === taskId) && waiting(record))) {
        throw new InputError('A task is awaiting manager review. Approve its submission before completing, replacing, or deleting it.', 409);
      }
    }),
  };
}
