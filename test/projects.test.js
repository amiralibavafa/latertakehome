import test from 'node:test';
import assert from 'node:assert/strict';
import { listProjects, UpstreamError } from '../lib/projects.js';
import { deadline } from '../public/dates.js';

const timeZone = 'America/Vancouver';
const now = new Date('2026-11-02T20:00:00Z');
const task = (dueAt, done = false) => ({ dueAt, done });

test('deadline colors honor overdue, today, 4 days, and the exact 5-day boundary', () => {
  assert.equal(deadline(task('2026-11-01T20:00:00Z'), now, timeZone).tone, 'overdue');
  assert.equal(deadline(task('2026-11-02T09:00:00Z'), now, timeZone).tone, 'soon');
  assert.equal(deadline(task('2026-11-06T20:00:00Z'), now, timeZone).tone, 'soon');
  assert.equal(deadline(task('2026-11-07T20:00:00Z'), now, timeZone).tone, 'safe');
});

test('a due date later today stays yellow, including near local midnight', () => {
  const result = deadline(task('2026-11-03T07:59:00Z'), now, timeZone);
  assert.equal(result.days, 0);
  assert.equal(result.label, 'Due today');
});

test('completed overdue tasks stay done; absent or invalid dates stay neutral', () => {
  assert.equal(deadline(task('2026-10-01T20:00:00Z', true), now, timeZone).tone, 'done');
  assert.equal(deadline(task(null), now, timeZone).tone, 'neutral');
  assert.equal(deadline(task('invalid'), now, timeZone).tone, 'neutral');
});

test('calendar-day math works across the Vancouver daylight-saving change', () => {
  const result = deadline(task('2026-11-02T20:00:00Z'), new Date('2026-10-28T19:00:00Z'), timeZone);
  assert.equal(result.days, 5);
  assert.equal(result.tone, 'safe');
});

function rawProject(index) {
  return { id: `p${index}`, title: `Project ${index}`, description: 'Example', status: 'wip', updated_at: 1793647815601,
    items: [{ id: `t${index}`, task: 'Example task', who: 'andy', by: 1793820615601, done: false }] };
}

test('fetches all seven projects instead of silently stopping at the first five', async () => {
  const paths = [];
  const fetchImpl = async url => {
    paths.push(new URL(url).search);
    return Response.json(paths.length === 1
      ? { total: 7, projects: [0, 1, 2, 3, 4].map(rawProject) }
      : { total: 7, projects: [5, 6].map(rawProject) });
  };
  const result = await listProjects({ fetchImpl });
  assert.equal(result.length, 7);
  assert.deepEqual(paths, ['?from=0&take=5', '?from=5&take=5']);
  assert.deepEqual(result[0].todos[0], { id: 't0', title: 'Example task', assignee: 'andy', dueAt: new Date(1793820615601).toISOString(), done: false });
});

test('reports an incomplete page instead of showing incorrect totals', async () => {
  let calls = 0;
  const fetchImpl = async () => Response.json({ total: 7, projects: calls++ === 0 ? [rawProject(0)] : [] });
  await assert.rejects(() => listProjects({ fetchImpl }), /incomplete project list/);
});

test('detects a repeated page rather than looping on a broken pagination response', async () => {
  const fetchImpl = async () => Response.json({ total: 7, projects: [rawProject(0)] });
  await assert.rejects(() => listProjects({ fetchImpl }), /incomplete project list/);
});

test('turns upstream errors into readable failures without fake fallback projects', async () => {
  await assert.rejects(() => listProjects({ fetchImpl: async () => new Response('', { status: 503 }) }), UpstreamError);
});
