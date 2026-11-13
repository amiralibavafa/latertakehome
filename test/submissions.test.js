import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubmissionService } from '../lib/submissions.js';
import { UpstreamError } from '../lib/projects.js';

const input = { eventId: 'form-event-001', projectId: 'proj_demo', taskId: 'todo_demo', submitter: 'Andy', mode: 'review', notes: 'Work is ready.' };
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'later-submissions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const task = { id: 'todo_demo', title: 'Example task', assignee: 'andy', dueAt: '2026-11-09T23:59:59.999Z', done: false };
  const calls = { reads: 0, marks: 0 };
  const options = {
    filePath: join(directory, 'submissions.json'), now: () => new Date('2026-11-02T20:00:00Z'),
    getProjectImpl: async () => { calls.reads++; return { id: 'proj_demo', title: 'Example project', todos: [task] }; },
    markTaskImpl: async (_projectId, _taskId, body) => { calls.marks++; assert.equal(body.done, true); task.done = true; return { result: { ...task } }; },
    ...extra,
  };
  return { service: createSubmissionService(options), options, task, calls };
}

test('review submissions persist timing and stay open until explicitly approved', async t => {
  const f = await fixture(t);
  const created = await f.service.submit(input);
  assert.equal(created.submission.status, 'pending');
  assert.equal(created.submission.submittedAt, '2026-11-02T20:00:00.000Z');
  assert.equal(created.submission.dueAt, f.task.dueAt);
  assert.equal(f.calls.marks, 0);
  assert.equal(f.task.done, false);
  await assert.rejects(() => f.service.assertCanChange('proj_demo', 'todo_demo'), /awaiting manager review/);
  const restarted = createSubmissionService(f.options);
  const result = await restarted.approve(created.submission.id, { reviewer: 'Carlos' });
  assert.equal(result.submission.status, 'approved');
  assert.equal(result.submission.reviewedBy, 'Carlos');
  assert.equal(f.task.done, true);
  await restarted.assertCanChange('proj_demo', 'todo_demo');
});

test('duplicate webhook deliveries, including concurrent requests, create one record', async t => {
  const f = await fixture(t);
  const responses = await Promise.all([f.service.submit(input), f.service.submit(input), f.service.submit(input)]);
  assert.equal(new Set(responses.map(result => result.submission.id)).size, 1);
  assert.equal(responses.filter(result => result.duplicate).length, 2);
  assert.equal((await f.service.list()).length, 1);
  assert.equal(f.calls.reads, 1);
});

test('reusing an event ID with changed details is rejected', async t => {
  const f = await fixture(t);
  await f.service.submit(input);
  await assert.rejects(() => f.service.submit({ ...input, notes: 'Different event payload' }), /different submission details/);
});

test('a second review event cannot create another pending review for the same task', async t => {
  const f = await fixture(t);
  await f.service.submit(input);
  await assert.rejects(() => f.service.submit({ ...input, eventId: 'form-event-002' }), /already has a submission/);
  const [record] = await f.service.list();
  await assert.rejects(() => f.service.retry(record.id), /manager’s approval/);
});

test('automatic completion marks once and a duplicate delivery does not mark again', async t => {
  const f = await fixture(t);
  const body = { ...input, mode: 'complete' };
  const created = await f.service.submit(body);
  assert.equal(created.submission.status, 'completed');
  assert.equal(f.task.done, true);
  const duplicate = await createSubmissionService(f.options).submit(body);
  assert.equal(duplicate.duplicate, true);
  assert.equal(f.calls.marks, 1);
});

test('an ambiguous upstream result is reconciled by reading before retrying completion', async t => {
  const f = await fixture(t);
  let marks = 0;
  const service = createSubmissionService({ ...f.options, markTaskImpl: async () => {
    marks++;
    f.task.done = true;
    throw new UpstreamError('Response was lost after the write.');
  } });
  const created = await service.submit({ ...input, mode: 'complete' });
  assert.equal(created.submission.status, 'uncertain');
  const reconciled = await service.retry(created.submission.id);
  assert.equal(reconciled.submission.status, 'completed');
  assert.equal(marks, 1);
});

test('deleted or reset task IDs cannot approve an old pending submission', async t => {
  const f = await fixture(t);
  const created = await f.service.submit(input);
  const restarted = createSubmissionService({ ...f.options, getProjectImpl: async () => { throw new UpstreamError('not found', 404); } });
  await assert.rejects(() => restarted.approve(created.submission.id, { reviewer: 'Carlos' }), /API may have reset/);
  assert.equal((await restarted.list())[0].status, 'pending');
  assert.equal(f.calls.marks, 0);
});

test('a restart during approval recovers an uncertain result and preserves the reviewer', async t => {
  const f = await fixture(t);
  const created = await f.service.submit(input);
  const data = JSON.parse(await readFile(f.options.filePath, 'utf8'));
  Object.assign(data.submissions[0], { status: 'processing', reviewedBy: 'Carlos', reviewedAt: '2026-11-02T20:00:01Z' });
  await writeFile(f.options.filePath, JSON.stringify(data));
  const restarted = createSubmissionService(f.options);
  assert.equal((await restarted.list())[0].status, 'uncertain');
  const result = await restarted.retry(created.submission.id);
  assert.equal(result.submission.status, 'approved');
  assert.equal(result.submission.reviewedBy, 'Carlos');
});
