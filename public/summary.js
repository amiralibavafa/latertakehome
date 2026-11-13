import { deadline, calendarDay } from './dates.js';

export const WEEK_MS = 7 * 86_400_000;
export const activityLabels = { 'project.created': 'Created project', 'project.updated': 'Edited project', 'project.deleted': 'Deleted project', 'task.added': 'Added task', 'task.completed': 'Completed task', 'task.reopened': 'Reopened task', 'task.deleted': 'Deleted task', 'task.replaced': 'Replaced task', 'work.submitted': 'Submitted work', 'work.approved': 'Approved submission', 'work.completed': 'Completed through automation' };
export function recentEvents(events, now = new Date()) {
  const current = new Date(now).getTime();
  return events.filter(event => { const time = Date.parse(event.occurredAt); return time >= current - WEEK_MS && time <= current; });
}

export function summarizeProject(project, submissions, events, now = new Date(), timeZone) {
  const open = project.todos.filter(todo => !todo.done);
  const overdue = open.filter(todo => deadline(todo, now, timeZone).tone === 'overdue');
  const soon = open.filter(todo => deadline(todo, now, timeZone).tone === 'soon');
  const validIds = new Set(project.todos.map(todo => todo.id));
  const pending = submissions.filter(item => item.projectId === project.id && validIds.has(item.taskId) && item.status === 'pending');
  const uncertain = submissions.filter(item => item.projectId === project.id && validIds.has(item.taskId) && item.status === 'uncertain');
  const updates = recentEvents(events, now).filter(event => event.projectId === project.id);
  const done = project.todos.length - open.length;
  const inactive = project.status === 'dropped';
  const updatedDay = calendarDay(project.updatedAt, timeZone);
  const ageDays = updatedDay === null ? null : calendarDay(now, timeZone) - updatedDay;
  const signals = [];
  if (inactive) signals.push({ tone: 'neutral', text: `Dropped project; ${open.length} open ${open.length === 1 ? 'task remains' : 'tasks remain'}.` });
  else {
    if (project.status === 'blocked') signals.push({ tone: 'danger', text: 'Project is marked blocked.' });
    if (overdue.length) signals.push({ tone: 'danger', text: `${overdue.length} unfinished ${overdue.length === 1 ? 'task is' : 'tasks are'} overdue.` });
    if (project.status === 'wrapped' && open.length) signals.push({ tone: 'danger', text: `Marked completed, but ${open.length} ${open.length === 1 ? 'task is' : 'tasks are'} still open.` });
    if (open.length && ageDays >= 7 && !['wrapped', 'dropped'].includes(project.status)) signals.push({ tone: 'watch', text: `No project timestamp update for ${ageDays} days; check whether work is moving.` });
    if (soon.length) signals.push({ tone: 'watch', text: `${soon.length} open ${soon.length === 1 ? 'task is' : 'tasks are'} due within 4 days.` });
  }
  if (pending.length) signals.push({ tone: 'watch', text: `${pending.length} ${pending.length === 1 ? 'submission awaits' : 'submissions await'} manager review.` });
  if (uncertain.length) signals.push({ tone: 'danger', text: `${uncertain.length} ${uncertain.length === 1 ? 'completion needs' : 'completions need'} checking.` });
  if (!signals.length) signals.push({ tone: 'safe', text: open.length ? 'No overdue work or blockers flagged.' : project.todos.length ? 'All tasks are complete.' : 'No tasks have been added yet.' });
  const risk = signals.some(signal => signal.tone === 'danger') ? 'attention' : signals.some(signal => signal.tone === 'watch') ? 'watch' : inactive ? 'inactive' : 'clear';
  const next = [...open].filter(todo => todo.dueAt).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0] || null;
  return { id: project.id, title: project.title, status: project.status, total: project.todos.length, done, open: open.length, overdue: overdue.length,
    dueSoon: soon.length, pending: pending.length, uncertain: uncertain.length, updates: updates.length, updatedAt: project.updatedAt, ageDays, next, risk, signals };
}

export function projectSummaries(projects, submissions, events, now = new Date(), timeZone) {
  const order = { attention: 0, watch: 1, clear: 2, inactive: 3 };
  return projects.map(project => summarizeProject(project, submissions, events, now, timeZone)).sort((a, b) => order[a.risk] - order[b.risk] || b.overdue - a.overdue || a.title.localeCompare(b.title));
}
