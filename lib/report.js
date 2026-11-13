import { projectSummaries, recentEvents, WEEK_MS, activityLabels } from '../public/summary.js';

const statusNames = { kickoff: 'Kickoff', wip: 'In progress', blocked: 'Blocked', wrapped: 'Completed', dropped: 'Dropped' };
const line = value => String(value ?? '').replace(/[\r\n]+/g, ' ');

export function formatWeeklyReport({ projects, submissions, activity }, { now = new Date(), timeZone = 'America/Vancouver' } = {}) {
  const formatDate = value => new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const events = recentEvents(activity.events, now).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const summaries = projectSummaries(projects, submissions, activity.events, now, timeZone);
  const rows = [
    '# Later project update', '', `Generated: ${formatDate(now)} (${timeZone})`,
    `Period: ${formatDate(new Date(new Date(now).getTime() - WEEK_MS))} to ${formatDate(now)} — last 7 days`, '',
    `${projects.length} projects · ${summaries.filter(item => item.risk === 'attention').length} need attention · ${summaries.reduce((sum, item) => sum + item.pending, 0)} awaiting review · ${events.length} recorded updates`, '',
    '## Project summaries', '',
  ];
  for (const item of summaries) {
    rows.push(`### ${line(item.title)}`, `Status: ${statusNames[item.status] || line(item.status)} · ${item.done}/${item.total} tasks complete · ${item.overdue} overdue · ${item.updates} updates in the last 7 days`,
      ...item.signals.map(signal => `- ${signal.text}`),
      item.next ? `Earliest open deadline: ${line(item.next.title)} — ${formatDate(item.next.dueAt)}` : 'No unfinished dated tasks.', '');
  }
  rows.push('## Recorded updates in the last 7 days', '');
  if (!events.length) rows.push('No changes have been recorded in this period. This is not proof that no work happened.');
  for (const event of events) {
    rows.push(`- ${formatDate(event.occurredAt)} — ${activityLabels[event.type] || line(event.type)}: ${line(event.taskTitle || event.projectTitle)} (${line(event.projectTitle)}; ${line(event.actor)})`);
    for (const change of event.changes || []) rows.push(`  - ${change.field}: ${line(change.before ?? '(not set)')} → ${line(change.after ?? '(removed)')}`);
  }
  const recentSubmissions = submissions.filter(item => recentEvents([{ occurredAt: item.submittedAt }], now).length);
  rows.push('', '## Submission timing', '');
  if (!recentSubmissions.length) rows.push('No submissions recorded in this period.');
  for (const item of recentSubmissions) rows.push(`- ${line(item.taskTitle)} (${line(item.projectTitle)}): ${line(item.submitter)} submitted ${formatDate(item.submittedAt)}; ${item.dueAt ? `deadline ${formatDate(item.dueAt)}; ${Date.parse(item.submittedAt) <= Date.parse(item.dueAt) ? 'on time' : 'late'}` : 'no deadline recorded'}; ${line(item.status)}.`);
  rows.push('', '## History coverage', '', activity.trackingSince ? `Project/task edit tracking began ${formatDate(activity.trackingSince)}. Earlier edits and direct upstream changes are not reconstructed. Submission receipts use their own recorded timestamps.` : 'Activity history is unavailable.',
    'Project state is fetched live from Later. A stale timestamp is a signal to investigate, not proof that progress stopped. Incomplete or failed writes may be absent from the edit log.',
    activity.warning || '', '');
  return rows.join('\n');
}
