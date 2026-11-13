import test from 'node:test';
import assert from 'node:assert/strict';
import { addTask, updateProject, markTask, replaceTask, InputError } from '../lib/projects.js';

function mockApi(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected API call');
    return Response.json(response.body ?? response, { status: typeof response.status === 'number' ? response.status : 200 });
  } };
}
const taskInput = { title: 'Update copy', assignee: 'betty', dueAt: '2026-11-09T23:59:59.999Z' };
const original = done => ({ id: 'proj_test', title: 'Temporary', status: 'kickoff', items: [
  { id: 'todo_old', task: 'Original', who: 'andy', by: 1794254400000, done },
] });

test('project edits put the ID in the path and explicitly touch updated_at', async () => {
  const api = mockApi([{ id: 'proj_test' }, { id: 'proj_test' }]);
  await updateProject('proj_test', { title: ' Renamed ', status: 'blocked' }, api);
  assert.deepEqual(api.calls, [
    { path: '/api/v1/proj/proj_test/modify', method: 'PUT', body: { title: 'Renamed', status: 'blocked' } },
    { path: '/api/v1/proj/proj_test/touch', method: 'POST', body: {} },
  ]);
});

test('normalizes a form task into upstream task/who/by fields', async () => {
  const api = mockApi([{ id: 'todo_new' }, { id: 'proj_test' }]);
  await addTask('proj_test', taskInput, api);
  assert.deepEqual(api.calls[0], { path: '/api/v1/proj/proj_test/items/add', method: 'POST', body: {
    task: 'Update copy', who: 'betty', by: Date.parse(taskInput.dueAt),
  } });
});

test('completion uses yes/no flags and does not use upstream boolean done', async () => {
  for (const [done, flag] of [[true, 'yes'], [false, 'no']]) {
    const api = mockApi([{ id: 'todo_old' }, { id: 'proj_test' }]);
    await markTask('proj_test', 'todo_old', { done }, api);
    assert.deepEqual(api.calls[0].body, { flag });
    assert.equal(api.calls[0].path, '/api/v1/proj/proj_test/items/todo_old/mark');
  }
});

test('touch failure reports a saved change with a warning, not a failed write', async () => {
  const api = mockApi([{ id: 'todo_new' }, { status: 503, body: { error: 'Unavailable' } }]);
  const result = await addTask('proj_test', taskInput, api);
  assert.equal(result.result.id, 'todo_new');
  assert.match(result.warning, /saved/);
  assert.equal(api.calls.length, 2);
});

test('replacement preserves completion and removes the original only after the new task is ready', async () => {
  const api = mockApi([original(true), { id: 'todo_new' }, { id: 'todo_new', done: true }, { removed: 'todo_old' }, { id: 'proj_test' }]);
  const result = await replaceTask('proj_test', 'todo_old', taskInput, api);
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [
    ['GET', '/api/v1/proj/proj_test'],
    ['POST', '/api/v1/proj/proj_test/items/add'],
    ['POST', '/api/v1/proj/proj_test/items/todo_new/mark'],
    ['DELETE', '/api/v1/proj/proj_test/items/todo_old/yank'],
    ['POST', '/api/v1/proj/proj_test/touch'],
  ]);
  assert.equal(result.result.replacedId, 'todo_old');
  assert.equal(result.result.done, true);
});

test('a failed replacement create never deletes the original or retries automatically', async () => {
  const api = mockApi([original(false), { status: 503, body: { error: 'Unavailable' } }]);
  await assert.rejects(() => replaceTask('proj_test', 'todo_old', taskInput, api));
  assert.equal(api.calls.length, 2);
  assert.ok(api.calls.every(call => call.method !== 'DELETE'));
});

test('a failed completion step leaves the original and explains the partial replacement', async () => {
  const api = mockApi([original(true), { id: 'todo_new' }, { status: 503, body: { error: 'Unavailable' } }]);
  await assert.rejects(() => replaceTask('proj_test', 'todo_old', taskInput, api), /original was kept/);
  assert.ok(api.calls.every(call => call.method !== 'DELETE'));
});

test('invalid data and path IDs are rejected before contacting upstream', async () => {
  const api = mockApi([]);
  await assert.rejects(() => addTask('proj_test', { ...taskInput, dueAt: '' }, api), InputError);
  await assert.rejects(() => updateProject('proj_test', { status: 'invented' }, api), InputError);
  await assert.rejects(() => markTask('proj_test', 'todo_old', { done: 'yes' }, api), InputError);
  await assert.rejects(() => markTask('../other', 'todo_old', { done: true }, api), InputError);
  assert.equal(api.calls.length, 0);
});
