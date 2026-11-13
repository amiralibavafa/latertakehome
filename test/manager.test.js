import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityStore, createActivityRecorder, submissionEvents } from '../lib/activity.js';
import { summarizeProject, recentEvents } from '../public/summary.js';
import { formatWeeklyReport } from '../lib/report.js';

const now = new Date('2026-11-02T20:00:00Z');
const zone = 'America/Vancouver';
const task = { id: 'todo_test', title: 'Review copy', assignee: 'betty', dueAt: '2026-11-01T20:00:00Z', done: false };
const project = { id: 'proj_test', title: 'Example project', description: 'Before', status: 'wip', updatedAt: '2026-11-02T19:00:00Z', todos: [task] };
const rawProject = { id: project.id, title: 'Renamed project', description: 'After', status: 'blocked', updated_at: now.getTime(), items: [{ id: task.id, task: task.title, who: task.assignee, by: Date.parse(task.dueAt), done: false }] };

test('summary flags overdue work and completed projects with open tasks', () => {
  const summary = summarizeProject({ ...project, status: 'wrapped' }, [], [], now, zone);
  assert.equal(summary.risk, 'attention');
  assert.equal(summary.overdue, 1);
  assert.ok(summary.signals.some(item => item.text.includes('Marked completed')));
});

test('dropped projects stay visible without becoming active overdue alerts', () => {
  const summary = summarizeProject({ ...project, status: 'dropped' }, [], [], now, zone);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.risk, 'inactive');
  assert.match(summary.signals[0].text, /Dropped project/);
});

test('stale timestamps are labelled as a check-in signal and old orphan reviews are excluded', () => {
  const summary = summarizeProject({ ...project, updatedAt: '2026-10-20T20:00:00Z', todos: [{ ...task, dueAt: '2026-11-15T20:00:00Z' }] },
    [{ projectId: project.id, taskId: 'old_task', status: 'pending' }], [], now, zone);
  assert.equal(summary.pending, 0);
  assert.equal(summary.risk, 'watch');
  assert.ok(summary.signals.some(item => item.text.includes('No project timestamp update')));
});

test('last-seven-day updates exclude older events and future timestamps', () => {
  const events = [
    { occurredAt: '2026-10-26T20:00:00Z' },
    { occurredAt: '2026-10-26T19:59:59Z' },
    { occurredAt: '2026-11-03T20:00:00Z' },
  ];
  assert.equal(recentEvents(events, now).length, 1);
});

test('activity persists before/after fields across a restart without inventing a baseline event', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'later-activity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { filePath: join(directory, 'activity.json'), now: () => now };
  const store = createActivityStore(options);
  assert.equal((await store.read()).events.length, 0);
  const track = createActivityRecorder({ store, getProjectImpl: async () => project });
  await track({ type: 'project.updated', projectId: project.id, operation: async () => ({ result: rawProject }) });
  const history = await createActivityStore(options).read();
  assert.equal(history.trackingSince, now.toISOString());
  assert.equal(history.events.length, 1);
  assert.deepEqual(history.events[0].changes, [
    { field: 'title', before: 'Example project', after: 'Renamed project' },
    { field: 'description', before: 'Before', after: 'After' },
    { field: 'status', before: 'wip', after: 'blocked' },
  ]);
});

test('no-op completion and failed writes do not create successful-change entries', async () => {
  const events = [];
  const track = createActivityRecorder({ store: { append: async event => events.push(event) }, getProjectImpl: async () => project });
  await track({ type: 'task.reopened', projectId: project.id, taskId: task.id, operation: async () => ({ result: { id: task.id, task: task.title, done: false } }) });
  await assert.rejects(() => track({ type: 'project.updated', projectId: project.id, operation: async () => { throw new Error('Unavailable'); } }));
  assert.equal(events.length, 0);
});

test('a logging failure keeps a successful saved-write result and exposes a warning', async () => {
  const track = createActivityRecorder({ store: { append: async () => { throw new Error('Disk full'); } }, getProjectImpl: async () => project });
  const result = await track({ type: 'project.updated', projectId: project.id, operation: async () => ({ result: rawProject }) });
  assert.equal(result.result.title, 'Renamed project');
  assert.match(result.warning, /saved.*history could not be recorded/);
});

test('submission timeline uses recorded times and does not claim uncertain completion succeeded', () => {
  const records = [{ id: 'sub_test', projectId: project.id, projectTitle: project.title, taskId: task.id, taskTitle: task.title, submitter: 'Betty', mode: 'complete', status: 'uncertain', submittedAt: now.toISOString(), completedAt: null }];
  assert.deepEqual(submissionEvents(records).map(event => event.type), ['work.submitted']);
  assert.equal(submissionEvents(records)[0].occurredAt, now.toISOString());
});

test('weekly export includes each project, observed changes, original submission deadline, and coverage', () => {
  const report = formatWeeklyReport({ projects: [project], submissions: [{ projectId: project.id, taskId: task.id, projectTitle: project.title, taskTitle: task.title, submitter: 'Betty', dueAt: task.dueAt, submittedAt: now.toISOString(), status: 'pending' }], activity: {
    trackingSince: now.toISOString(), events: [{ projectId: project.id, projectTitle: project.title, type: 'project.updated', actor: 'Workspace', occurredAt: now.toISOString(), changes: [{ field: 'status', before: 'kickoff', after: 'wip' }] }],
  } }, { now, timeZone: zone });
  assert.match(report, /### Example project/);
  assert.match(report, /1 recorded updates/);
  assert.match(report, /status: kickoff → wip/);
  assert.match(report, /; late; pending/);
  assert.match(report, /Earlier edits and direct upstream changes are not reconstructed/);
});
