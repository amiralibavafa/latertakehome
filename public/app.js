import { deadline } from './dates.js';
import { projectSummaries, recentEvents, activityLabels } from './summary.js';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  flag: '<path d="M5 21V4m0 0c5-5 9 5 14 0v10c-5 5-9-5-14 0"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 3.5 3.5 0 0 1-1 7Z"/><path d="m9 13 2 2 4-4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  folder: '<path d="M3 7V5h6l2 3h10v12H3Z"/>',
  rocket: '<path d="M14 5c3-2 6-2 6-2s0 4-2 7l-7 7-5-5 8-7ZM6 12H3l4-6h6m-2 11v4l6-4v-6M7 17l-3 3"/><circle cx="15" cy="8" r="1"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  inbox: '<path d="m3 14 3-10h12l3 10v6H3Z"/><path d="M3 14h5l2 3h4l2-3h5"/>',
  send: '<path d="m21 3-7 18-3-8-8-3 18-7ZM11 13l5-5"/>',
  report: '<path d="M4 3h16v18H4ZM8 16v-3m4 3V8m4 8v-6"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.folder}</svg>`;
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = svg(element.dataset.icon); });

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fullDate = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : 'Not provided by the API';
const shortDate = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)) : 'No due date';
const personName = person => person ? person.charAt(0).toUpperCase() + person.slice(1) : 'Unassigned';
const statuses = {
  wip: ['In progress', 'progress'], kickoff: ['Kickoff', 'kickoff'], blocked: ['Blocked', 'blocked'],
  wrapped: ['Completed', 'complete'], dropped: ['Dropped', 'dropped'],
};
const personColors = { andy: 'purple', betty: 'peach', carlos: 'sky', dan: 'green' };
const state = { projects: [], submissions: [], activity: { events: [], trackingSince: null }, view: 'all', filter: 'all', search: '', expanded: new Set(), loaded: false, fetchedAt: null, loading: false, failed: false, mutating: false, editor: null, submissionEventId: null, reviewing: null, lastContent: null, managerSearch: '', activityProject: '', activityPeriod: 'week', activityLimit: 50 };
const isActive = project => ['wip', 'kickoff'].includes(project.status);
const overdueTasks = project => project.todos.filter(todo => deadline(todo).tone === 'overdue');
const needsAttention = project => project.status === 'blocked' || overdueTasks(project).length > 0;
const pendingReview = (projectId, taskId) => state.submissions.find(item => item.projectId === projectId && item.taskId === taskId && item.mode === 'review' && ['pending', 'processing', 'uncertain'].includes(item.status));

function avatar(person, extraClass = '') {
  return `<span class="avatar ${personColors[person] || 'neutral-avatar'} ${extraClass}" title="${escape(personName(person))}">${escape((person || '?')[0].toUpperCase())}</span>`;
}

function renderStats() {
  const allTasks = state.projects.flatMap(project => project.todos);
  const done = allTasks.filter(todo => todo.done).length;
  const count = state.projects.length;
  $('#stat-total').textContent = count;
  $('#stat-active').textContent = state.projects.filter(isActive).length;
  $('#stat-overdue').textContent = allTasks.filter(todo => deadline(todo).tone === 'overdue').length;
  $('#stat-done').textContent = done;
  $('#done-caption').textContent = `${done} of ${allTasks.length} tasks checked off`;
  $('#nav-all').textContent = count;
  $('#tab-total').textContent = count;
  $('#nav-attention').textContent = state.projects.filter(needsAttention).length;
  $('#nav-completed').textContent = state.projects.filter(project => project.status === 'wrapped').length;
  $('#nav-submissions').textContent = state.submissions.filter(item => item.status === 'pending' && currentSubmissionTask(item)).length;
  $('#nav-manager').textContent = projectSummaries(state.projects, state.submissions, state.activity.events).filter(item => item.risk === 'attention').length;
}

function visibleProjects() {
  return state.projects.filter(project => {
    if (state.view === 'attention' && !needsAttention(project)) return false;
    if (state.view === 'completed' && project.status !== 'wrapped') return false;
    if (state.filter === 'active' && !isActive(project)) return false;
    if (state.filter === 'blocked' && project.status !== 'blocked') return false;
    const text = `${project.title} ${project.description}`.toLocaleLowerCase();
    return text.includes(state.search.trim().toLocaleLowerCase());
  });
}

function taskRow(todo, project) {
  const due = deadline(todo);
  const pending = pendingReview(project.id, todo.id);
  return `<div class="task-row ${todo.done ? 'task-done' : ''}">
    <div class="task-name"><button class="task-check ${todo.done ? 'checked' : ''}" data-action="toggle-task" data-project-id="${escape(project.id)}" data-task-id="${escape(todo.id)}" aria-label="${pending ? 'Awaiting manager review:' : todo.done ? 'Reopen' : 'Mark complete:'} ${escape(todo.title)}" aria-pressed="${todo.done}" ${state.mutating || pending ? 'disabled' : ''}>${todo.done ? svg('check') : ''}</button><span>${escape(todo.title)}${pending ? '<span class="pending-tag">Pending review</span>' : ''}</span></div>
    <div class="task-assignee">${avatar(todo.assignee)}<span>${escape(personName(todo.assignee))}</span></div>
    <div class="task-deadline"><button class="due-badge ${due.tone}" data-task-id="${escape(todo.id)}" data-project-id="${escape(project.id)}" aria-label="View details for ${escape(todo.title)}: ${escape(due.label)}">${svg(todo.done ? 'check' : 'clock')}<span>${escape(shortDate(todo.dueAt))}</span></button><span class="due-caption ${due.tone}">${escape(due.label)}</span></div>
    <div class="task-actions"><button class="icon-button" data-action="replace-task" data-project-id="${escape(project.id)}" data-task-id="${escape(todo.id)}" title="${pending ? 'Review submission first' : 'Replace task'}" aria-label="Replace task: ${escape(todo.title)}" ${state.mutating || pending ? 'disabled' : ''}>${svg('edit')}</button><button class="icon-button delete-control" data-action="delete-task" data-project-id="${escape(project.id)}" data-task-id="${escape(todo.id)}" title="${pending ? 'Review submission first' : 'Delete task'}" aria-label="Delete task: ${escape(todo.title)}" ${state.mutating || pending ? 'disabled' : ''}>${svg('trash')}</button></div>
  </div>`;
}

function projectCard(project, index) {
  const [label, tone] = statuses[project.status] || [project.status, 'dropped'];
  const done = project.todos.filter(todo => todo.done).length;
  const total = project.todos.length;
  const overdue = overdueTasks(project).length;
  const people = [...new Set(project.todos.map(todo => todo.assignee).filter(Boolean))];
  const complete = total > 0 && done === total;
  const icon = ['rocket', 'folder', 'activity', 'spark'][index % 4];
  const countLabel = complete ? 'All tasks complete' : overdue ? `${overdue} overdue` : `${total - done} open ${total - done === 1 ? 'task' : 'tasks'}`;
  return `<details class="project-card" data-project="${escape(project.id)}" ${state.expanded.has(project.id) ? 'open' : ''}>
    <summary><span class="project-icon project-color-${index % 4}">${svg(icon)}</span>
      <span class="project-info"><span class="project-title-row"><span class="project-title">${escape(project.title)}</span><span class="status-badge ${tone}"><i></i>${escape(label)}</span></span><span class="project-description">${escape(project.description || 'No description yet.')}</span><span class="project-bottom"><span class="task-progress">${done}/${total} tasks<span class="progress-track"><span style="width:${total ? Math.round(done / total * 100) : 0}%"></span></span></span><span class="project-health ${overdue ? 'overdue' : complete ? 'safe' : ''}">${escape(countLabel)}</span></span></span>
      <span class="avatar-stack" aria-label="${escape(people.map(personName).join(', '))}">${people.slice(0, 4).map(person => avatar(person)).join('')}</span><span class="project-chevron">${svg('chevron')}</span>
    </summary>
    <div class="tasks-panel"><div class="task-columns"><span>Task</span><span>Assigned to</span><span>Due date</span><span class="visually-hidden">Actions</span></div>${total ? project.todos.map(todo => taskRow(todo, project)).join('') : '<div class="no-tasks">No tasks in this project yet.</div>'}<div class="project-controls"><button class="text-button" data-action="add-task" data-project-id="${escape(project.id)}" ${state.mutating ? 'disabled' : ''}>${svg('plus')}Add task</button><button class="text-button" data-action="edit-project" data-project-id="${escape(project.id)}" ${state.mutating ? 'disabled' : ''}>${svg('edit')}Edit project</button><button class="text-button delete-control" data-action="delete-project" data-project-id="${escape(project.id)}" ${state.mutating ? 'disabled' : ''}>${svg('trash')}Delete project</button></div><div class="project-updated">Updated ${escape(fullDate(project.updatedAt))}</div></div>
  </details>`;
}

function renderList() {
  if (!state.loaded) return;
  renderSubmissions();
  renderManager();
  const projects = visibleProjects();
  $('#results-count').textContent = `Showing ${projects.length} of ${state.projects.length} projects`;
  $('#project-list').innerHTML = projects.length ? projects.map(projectCard).join('') : `<div class="empty-state"><span class="empty-icon">${svg('search')}</span><h2>${state.search ? 'No projects found' : 'Nothing here right now'}</h2><p>${state.search ? 'Try a different project name or description.' : 'Try another view to see the rest of your workspace.'}</p><button class="button button-outline" id="clear-filters">Show all projects</button></div>`;
}

function setView(view) {
  state.view = view;
  state.filter = 'all';
  const titles = { all: 'All projects', attention: 'Needs attention', completed: 'Completed projects', submissions: 'Submissions', manager: 'Manager overview' };
  const descriptions = { all: 'Keep the big picture. Stay on top of the little things.', attention: 'Projects with overdue tasks or a blocked status.', completed: 'Finished projects. A little space to appreciate the progress.', submissions: 'A clear handoff from submitted to approved.', manager: 'Know what needs attention, and what moved forward.' };
  $('.projects-section').hidden = ['submissions', 'manager'].includes(view);
  $('#submission-section').hidden = view !== 'submissions';
  $('#manager-section').hidden = view !== 'manager';
  $('#page-title').innerHTML = `${titles[view]}<span class="title-dot">.</span>`;
  $('#page-description').textContent = descriptions[view];
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  updateTabs();
  renderList();
}

function updateTabs() {
  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.hidden = state.view === 'completed' && button.dataset.filter !== 'all';
  });
}

async function loadProjects({ silent = false } = {}) {
  if (state.loading) return false;
  state.loading = true;
  state.failed = false;
  if (!silent) { $('#refresh').disabled = true; $('#refresh').classList.add('refreshing'); }
  $('#project-list').setAttribute('aria-busy', 'true');
  $('#error-banner').hidden = true;
  try {
    const response = await fetch('/api/projects', { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load projects.');
    if (!Array.isArray(data.projects)) throw new Error('The server returned an unexpected response.');
    const content = JSON.stringify([data.projects, data.submissions || [], data.activity || {}]);
    const changed = content !== state.lastContent;
    state.lastContent = content;
    state.projects = data.projects;
    state.submissions = data.submissions || [];
    state.activity = data.activity || { events: [], trackingSince: null };
    state.fetchedAt = data.fetchedAt;
    if (!state.loaded && data.projects.length) state.expanded.add(data.projects[0].id);
    state.loaded = true;
    $('.sidebar-note').classList.remove('disconnected');
    $('#connection-label').textContent = 'Connected to Projects API';
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(data.fetchedAt));
    $('#sync-status').textContent = `Live API data · Updated ${time} · Auto-refresh on`;
    if (changed || !silent) { renderStats(); renderList(); }
    return true;
  } catch (error) {
    state.failed = true;
    $('#error-banner').textContent = `${error.name === 'TimeoutError' ? 'The request took too long. Please try refreshing.' : error.message}${state.loaded ? ' Showing the last successfully loaded data.' : ''}`;
    $('#error-banner').hidden = false;
    $('.sidebar-note').classList.add('disconnected');
    $('#connection-label').textContent = 'Connection unavailable';
    $('#sync-status').textContent = state.loaded ? 'Connection interrupted · Showing previous data' : 'Could not connect to Later Projects API';
    if (!state.loaded) {
      $('#results-count').textContent = 'Projects could not be loaded';
      $('#project-list').innerHTML = `<div class="empty-state"><span class="empty-icon">${svg('cloud')}</span><h2>Let’s reconnect</h2><p>Check your connection, then refresh your projects.</p><button class="button button-outline" id="retry">Try again</button></div>`;
    }
    return false;
  } finally {
    state.loading = false;
    $('#refresh').disabled = state.mutating;
    $('#refresh').classList.remove('refreshing');
    $('#project-list').setAttribute('aria-busy', 'false');
  }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  updateTabs();
  renderList();
}));
$('#search').addEventListener('input', event => { state.search = event.target.value; renderList(); });
$('#refresh').addEventListener('click', loadProjects);
document.addEventListener('keydown', event => {
  if (event.key === '/' && state.view !== 'submissions' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    $(state.view === 'manager' ? '#manager-search' : '#search').focus();
  }
});
$('#project-list').addEventListener('toggle', event => {
  const id = event.target.dataset.project;
  if (!id) return;
  if (event.target.open) state.expanded.add(id); else state.expanded.delete(id);
}, true);
$('#project-list').addEventListener('click', event => {
  if (event.target.closest('#retry')) return loadProjects();
  if (event.target.closest('#clear-filters')) {
    state.search = '';
    $('#search').value = '';
    return setView('all');
  }
  const action = event.target.closest('[data-action]');
  if (action) {
    if (state.mutating || state.loading) return;
    const project = state.projects.find(project => project.id === action.dataset.projectId);
    const todo = project?.todos.find(todo => todo.id === action.dataset.taskId);
    if (!project) return;
    if (action.dataset.action === 'toggle-task' && todo) {
      void saveChange(`/api/projects/${project.id}/tasks/${todo.id}`, 'PATCH', { done: !todo.done }, todo.done ? 'Task reopened.' : 'Task completed.');
    } else openEditor(action.dataset.action, project, todo);
    return;
  }
  const button = event.target.closest('[data-task-id]');
  if (!button) return;
  const project = state.projects.find(project => project.id === button.dataset.projectId);
  const todo = project?.todos.find(todo => todo.id === button.dataset.taskId);
  if (!todo) return;
  const due = deadline(todo);
  $('#task-dialog-title').textContent = todo.title;
  $('#task-details').innerHTML = [
    ['Project', project.title], ['Assigned to', personName(todo.assignee)], ['Due date', fullDate(todo.dueAt)],
    ['Status', todo.done ? 'Completed' : 'Open'], ['Deadline', due.label],
  ].map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('');
  $('#task-dialog').showModal();
});
$('#task-dialog').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});

function localDateInput(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 7 * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function openEditor(kind, project = null, todo = null) {
  if (state.mutating) return;
  state.editor = { kind, project, todo };
  const isProject = ['new-project', 'edit-project'].includes(kind);
  const isDelete = kind.startsWith('delete-');
  const titles = { 'new-project': 'New project', 'edit-project': 'Edit project', 'add-task': 'Add a task', 'replace-task': 'Replace task', 'delete-task': 'Delete task?', 'delete-project': 'Delete project?' };
  $('#edit-dialog-title').textContent = titles[kind];
  $('#editor-eyebrow').textContent = project ? project.title : 'A FRESH START';
  $('#editor-error').hidden = true;
  $('#save-editor').classList.toggle('button-danger', isDelete);
  $('#save-editor').textContent = isDelete ? (todo ? 'Delete task' : 'Delete project') : kind === 'replace-task' ? 'Replace task' : kind === 'add-task' ? 'Add task' : kind === 'new-project' ? 'Create project' : 'Save changes';
  if (isDelete) {
    $('#editor-fields').innerHTML = `<p class="delete-explanation">Delete <strong>${escape(todo?.title || project.title)}</strong>${todo ? '' : ` and its ${project.todos.length} ${project.todos.length === 1 ? 'task' : 'tasks'}`}? This cannot be undone.</p>`;
  } else if (isProject) {
    $('#editor-fields').innerHTML = `<label class="form-field">Project title<input name="title" aria-label="Project title" required maxlength="200" value="${escape(project?.title || '')}" placeholder="What are we working on?" /></label><label class="form-field">Description<textarea name="description" aria-label="Description" rows="3" maxlength="5000" placeholder="A little context for the team…">${escape(project?.description || '')}</textarea></label><label class="form-field">Status<select name="status" aria-label="Status">${Object.entries(statuses).map(([value, [label]]) => `<option value="${value}" ${(project?.status || 'kickoff') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  } else {
    const people = [...new Set(['andy', 'betty', 'carlos', 'dan', ...state.projects.flatMap(p => p.todos.map(t => t.assignee)).filter(Boolean)])];
    $('#editor-fields').innerHTML = `${kind === 'replace-task' ? '<p class="replacement-notice"><strong>This creates a new task ID.</strong> Update any automations linked to the old task. Completion status is preserved. The original is removed after the replacement is ready.</p>' : ''}<label class="form-field">Task title<input name="title" aria-label="Task title" required maxlength="500" value="${escape(todo?.title || '')}" placeholder="What needs to get done?" /></label><label class="form-field">Assigned to<input name="assignee" aria-label="Assigned to" required maxlength="100" list="assignee-suggestions" value="${escape(todo?.assignee || '')}" placeholder="Choose or type a name" /><datalist id="assignee-suggestions">${people.map(name => `<option value="${escape(name)}"></option>`).join('')}</datalist></label><label class="form-field">Due date<input type="date" name="dueDate" aria-label="Due date" required value="${localDateInput(todo?.dueAt)}" /></label><p class="field-note">New deadlines are due at the end of the selected day in your local timezone.</p>`;
  }
  $('#edit-dialog').showModal();
  if (isDelete) $('#cancel-editor').focus();
}

function setSaving(saving) {
  state.mutating = saving;
  document.querySelectorAll('[data-action], [data-review-id], #new-project, #submit-work, #refresh, #edit-dialog button, #edit-dialog input, #edit-dialog textarea, #edit-dialog select').forEach(control => { control.disabled = saving; });
  if (!saving) renderList();
  $('#editor-form').setAttribute('aria-busy', String(saving));
}

let toastTimeout;
function notify(message, tone = 'success') {
  clearTimeout(toastTimeout);
  $('#toast-message').textContent = message;
  $('#toast').dataset.tone = tone;
  $('#toast').hidden = false;
  if (tone === 'success') toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}

async function saveChange(path, method, body, successMessage, fromEditor = false) {
  if (state.mutating || state.loading) return false;
  setSaving(true);
  if (fromEditor) { $('#editor-error').hidden = true; $('#save-editor').textContent = 'Saving…'; }
  try {
    let response;
    try {
      response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
    } catch { throw new Error('Connection interrupted. The change may have saved. Refresh projects before trying again.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The change could not be saved.');
    if (data.result?.id?.startsWith('proj_')) state.expanded.add(data.result.id);
    if (path === '/api/projects' && method === 'POST') {
      state.search = '';
      $('#search').value = '';
      setView('all');
    }
    if (fromEditor) $('#edit-dialog').close();
    const refreshed = await loadProjects();
    notify(data.warning || (refreshed ? successMessage : `${successMessage} The list could not be refreshed; try Refresh projects.`), data.warning || !refreshed ? 'warning' : 'success');
    return true;
  } catch (error) {
    if (fromEditor) { $('#editor-error').textContent = error.message; $('#editor-error').hidden = false; }
    else notify(error.message, 'error');
    // A timeout or partial replacement can still have changed upstream data.
    await loadProjects();
    return false;
  } finally {
    setSaving(false);
    if (fromEditor) {
      const kind = state.editor?.kind;
      $('#save-editor').textContent = kind === 'replace-task' ? 'Replace task' : kind === 'delete-task' ? 'Delete task' : kind === 'delete-project' ? 'Delete project' : kind === 'add-task' ? 'Add task' : kind === 'new-project' ? 'Create project' : 'Save changes';
    }
  }
}

$('#new-project').addEventListener('click', () => openEditor('new-project'));
$('#close-editor').addEventListener('click', () => { if (!state.mutating) $('#edit-dialog').close(); });
$('#cancel-editor').addEventListener('click', () => { if (!state.mutating) $('#edit-dialog').close(); });
$('#edit-dialog').addEventListener('cancel', event => { if (state.mutating) event.preventDefault(); });
$('#dismiss-toast').addEventListener('click', () => { $('#toast').hidden = true; });
$('#editor-form').addEventListener('submit', event => {
  event.preventDefault();
  if (state.mutating || !state.editor) return;
  const { kind, project, todo } = state.editor;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (kind === 'new-project') return void saveChange('/api/projects', 'POST', data, 'Project created.', true);
  const path = `/api/projects/${project.id}`;
  if (kind === 'edit-project') return void saveChange(path, 'PATCH', data, 'Project updated.', true);
  if (kind === 'delete-project') return void saveChange(path, 'DELETE', undefined, 'Project deleted.', true);
  if (kind === 'delete-task') return void saveChange(`${path}/tasks/${todo.id}`, 'DELETE', undefined, 'Task deleted.', true);
  // Preserve the original timestamp when replacing a task without changing its day.
  data.dueAt = todo?.dueAt && data.dueDate === localDateInput(todo.dueAt)
    ? todo.dueAt : new Date(`${data.dueDate}T23:59:59.999`).toISOString();
  delete data.dueDate;
  if (kind === 'replace-task') return void saveChange(`${path}/tasks/${todo.id}/replace`, 'POST', data, 'Task replaced. Update automations that used the previous task ID.', true);
  void saveChange(`${path}/tasks`, 'POST', data, 'Task added.', true);
});

const submissionStatuses = {
  pending: ['Pending review', 'pending'], approved: ['Approved', 'approved'],
  completed: ['Completed automatically', 'approved'], uncertain: ['Needs a check', 'uncertain'], processing: ['Completing…', 'uncertain'],
};
function currentSubmissionTask(item) {
  return state.projects.find(project => project.id === item.projectId)?.todos.find(todo => todo.id === item.taskId);
}
function submissionTiming(item) {
  if (!item.dueAt) return { label: 'No deadline recorded', tone: 'neutral' };
  return new Date(item.submittedAt) <= new Date(item.dueAt)
    ? { label: 'Submitted on time', tone: 'safe' } : { label: 'Submitted after deadline', tone: 'overdue' };
}
function renderSubmissions() {
  const pending = state.submissions.filter(item => item.status === 'pending' && currentSubmissionTask(item)).length;
  $('#submission-count').textContent = `${pending} awaiting review · ${state.submissions.length} total submissions`;
  $('#submission-list').innerHTML = state.submissions.length ? state.submissions.map(item => {
    let [label, tone] = submissionStatuses[item.status] || [item.status, 'uncertain'];
    const timing = submissionTiming(item);
    const task = currentSubmissionTask(item);
    if (!task && ['pending', 'processing', 'uncertain'].includes(item.status)) [label, tone] = ['Source unavailable', 'uncertain'];
    const action = item.status === 'pending' ? 'Review submission' : item.status === 'uncertain' ? 'Check & retry' : null;
    return `<article class="submission-card"><div class="submission-card-top"><div><span class="submission-project">${escape(item.projectTitle)}</span><h3>${escape(item.taskTitle)}</h3></div><span class="submission-status ${tone}">${escape(label)}</span></div><p class="submission-by">${escape(item.submitter)} submitted · ${escape(fullDate(item.submittedAt))}</p>${item.notes ? `<p class="submission-notes">${escape(item.notes)}</p>` : ''}<div class="submission-card-bottom"><span class="submission-timing ${timing.tone}">${svg('clock')}${escape(timing.label)}</span>${action ? `<button class="button button-outline" data-review-id="${escape(item.id)}" ${state.mutating || !task ? 'disabled' : ''}>${action}</button>` : `<span class="submission-reviewed">${item.reviewedBy ? `Approved by ${escape(item.reviewedBy)}` : 'Automatic completion'}</span>`}</div>${!task ? '<p class="submission-missing">The source task is no longer available. It may have been deleted, replaced, or reset. This submission remains as a local record.</p>' : !task.done && ['approved', 'completed'].includes(item.status) ? '<p class="submission-missing">This task has since been reopened. The submission records its earlier completion.</p>' : ''}${item.error ? `<p class="submission-missing">${escape(item.error)}</p>` : ''}</article>`;
  }).join('') : `<div class="empty-state"><span class="empty-icon">${svg('inbox')}</span><h2>A place for your handoffs</h2><p>Submit work for review or let an automation complete it.</p><button class="button button-primary" id="first-submission">Submit work</button></div>`;
}

function availableTasks(project) {
  return (project?.todos || []).filter(todo => !todo.done && !pendingReview(project.id, todo.id));
}
function updateSubmissionTasks() {
  const project = state.projects.find(project => project.id === $('#submission-project').value);
  const selected = $('#submission-task').value;
  const todos = availableTasks(project);
  $('#submission-task').innerHTML = todos.length ? todos.map(todo => `<option value="${escape(todo.id)}" ${todo.id === selected ? 'selected' : ''}>${escape(todo.title)}${todo.assignee ? ` — ${escape(personName(todo.assignee))}` : ''}</option>`).join('') : '<option value="">No open tasks available</option>';
  $('#submission-task').disabled = !todos.length;
  $('#save-submission').disabled = state.mutating || !todos.length;
}
function updateSubmissionWorkflow() {
  const review = $('#submission-mode').value === 'review';
  $('#workflow-note').textContent = review ? 'Your task stays open until a manager approves it.' : 'Submitting marks the selected task complete immediately.';
  $('#save-submission').textContent = review ? 'Submit for review' : 'Submit & complete';
}
function openSubmissionForm() {
  if (state.mutating || state.loading || !state.loaded) return;
  $('#submission-form').reset();
  state.submissionEventId = crypto.randomUUID();
  const projects = state.projects.filter(project => availableTasks(project).length);
  $('#submission-project').innerHTML = projects.length ? projects.map(project => `<option value="${escape(project.id)}">${escape(project.title)}</option>`).join('') : '<option value="">No projects with open tasks</option>';
  $('#submission-error').hidden = projects.length > 0;
  $('#submission-error').textContent = 'There are no available tasks. Add a task, reopen one, or review an existing submission first.';
  updateSubmissionTasks();
  updateSubmissionWorkflow();
  $('#submission-dialog').showModal();
}
function openReview(item) {
  if (state.mutating || !item || !currentSubmissionTask(item)) return;
  state.reviewing = item;
  const retry = item.status === 'uncertain';
  $('#review-form').reset();
  $('#review-project').textContent = item.projectTitle;
  $('#review-dialog-title').textContent = retry ? 'Check task completion' : 'Review submission';
  const timing = submissionTiming(item);
  $('#review-details').innerHTML = `<h3 class="review-task-title">${escape(item.taskTitle)}</h3><dl class="review-facts"><div><dt>Submitted by</dt><dd>${escape(item.submitter)}</dd></div><div><dt>Submitted at</dt><dd>${escape(fullDate(item.submittedAt))}</dd></div><div><dt>Original deadline</dt><dd>${escape(fullDate(item.dueAt))}</dd></div></dl><p class="submission-timing ${timing.tone}">${escape(timing.label)}</p>${item.notes ? `<p class="submission-notes">${escape(item.notes)}</p>` : '<p class="field-note">No submission notes.</p>'}${retry ? '<p class="workflow-note">We’ll check the current task first. If it is still open, we’ll mark it complete without creating another submission.</p>' : '<p class="workflow-note">Approving this submission marks the task complete in the project.</p>'}`;
  $('#reviewer-field').hidden = retry;
  $('#reviewer-field input').required = !retry;
  $('#approve-submission').textContent = retry ? 'Check & retry completion' : 'Approve & complete';
  $('#review-error').hidden = true;
  $('#review-dialog').showModal();
}
async function workflowWrite(path, body, dialog, errorElement) {
  if (state.mutating || state.loading) return;
  setSaving(true);
  dialog.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = true; });
  errorElement.hidden = true;
  try {
    let response;
    try {
      response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    } catch { throw new Error('Connection interrupted. Check Submissions before retrying. This form keeps the same event ID so a retry will not create a second submission.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The submission could not be saved.');
    dialog.close();
    setView('submissions');
    const refreshed = await loadProjects();
    const messages = { pending: 'Work submitted. It is waiting for manager review.', approved: 'Submission approved. The task is complete.', completed: 'Work submitted. The task was completed automatically.', uncertain: 'Submission recorded. Check and retry task completion from Submissions.' };
    notify(data.warning || `${data.duplicate ? 'This event was already received. ' : ''}${messages[data.submission.status] || 'Submission saved.'}${refreshed ? '' : ' Refresh to see the latest state.'}`, data.warning || data.submission.status === 'uncertain' || !refreshed ? 'warning' : 'success');
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    await loadProjects();
  } finally {
    dialog.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = false; });
    setSaving(false);
    if ($('#submission-dialog').open) updateSubmissionTasks();
  }
}
$('#submit-work').addEventListener('click', openSubmissionForm);
$('#submission-project').addEventListener('change', updateSubmissionTasks);
$('#submission-mode').addEventListener('change', updateSubmissionWorkflow);
$('#submission-list').addEventListener('click', event => {
  if (event.target.closest('#first-submission')) return openSubmissionForm();
  const button = event.target.closest('[data-review-id]');
  if (button) openReview(state.submissions.find(item => item.id === button.dataset.reviewId));
});
for (const [dialogId, closeIds] of [['submission-dialog', ['close-submission', 'cancel-submission']], ['review-dialog', ['close-review', 'cancel-review']]]) {
  closeIds.forEach(id => $(`#${id}`).addEventListener('click', () => { if (!state.mutating) $(`#${dialogId}`).close(); }));
  $(`#${dialogId}`).addEventListener('cancel', event => { if (state.mutating) event.preventDefault(); });
}
$('#submission-form').addEventListener('submit', event => {
  event.preventDefault();
  const body = { ...Object.fromEntries(new FormData(event.currentTarget)), eventId: state.submissionEventId };
  void workflowWrite('/api/submissions', body, $('#submission-dialog'), $('#submission-error'));
});
$('#review-form').addEventListener('submit', event => {
  event.preventDefault();
  const item = state.reviewing;
  if (!item) return;
  const action = item.status === 'uncertain' ? 'retry' : 'approve';
  void workflowWrite(`/api/submissions/${item.id}/${action}`, Object.fromEntries(new FormData(event.currentTarget)), $('#review-dialog'), $('#review-error'));
});

const riskLabels = { attention: 'Needs attention', watch: 'Keep an eye on it', clear: 'Looking clear', inactive: 'Inactive' };
function renderManager() {
  const summaries = projectSummaries(state.projects, state.submissions, state.activity.events);
  const attention = summaries.filter(item => item.risk === 'attention').length;
  const changes = recentEvents(state.activity.events).length;
  $('#manager-overview-count').textContent = `${attention} ${attention === 1 ? 'project needs' : 'projects need'} attention · ${changes} recorded updates in the last 7 days`;
  $('#download-report').href = `/api/report?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
  const visible = summaries.filter(item => item.title.toLocaleLowerCase().includes(state.managerSearch.trim().toLocaleLowerCase()));
  $('#manager-projects').innerHTML = visible.length ? visible.map(item => {
    const [statusLabel, statusTone] = statuses[item.status] || [item.status, 'dropped'];
    return `<article class="manager-card"><div class="manager-card-top"><div><h3>${escape(item.title)}</h3><span class="status-badge ${statusTone}"><i></i>${escape(statusLabel)}</span></div><span class="manager-risk ${item.risk}">${riskLabels[item.risk]}</span></div><ul class="manager-signals">${item.signals.map(signal => `<li class="${signal.tone}"><i></i>${escape(signal.text)}</li>`).join('')}</ul><div class="manager-metrics"><span><strong>${item.done}/${item.total}</strong>Tasks complete</span><span><strong>${item.overdue}</strong>Overdue</span><span><strong>${item.pending}</strong>Awaiting review</span><button data-project-activity="${escape(item.id)}"><strong>${item.updates}</strong>Updates in 7 days</button></div><p class="manager-next">${svg('clock')}<span>${item.next ? `Earliest open deadline: <strong>${escape(shortDate(item.next.dueAt))}</strong> · ${escape(item.next.title)}` : 'No unfinished dated tasks.'}</span></p><div class="manager-card-actions"><button class="text-button" data-open-project="${escape(item.id)}">Open project ${svg('chevron')}</button>${item.pending ? '<button class="text-button" data-show-submissions>Review submissions</button>' : ''}<span>${item.updatedAt ? `Updated ${escape(shortDate(item.updatedAt))}` : 'No updated time'}</span></div></article>`;
  }).join('') : '<div class="empty-state"><h2>No matching projects</h2><p>Try another project name.</p></div>';
  renderActivity();
}

const fieldNames = { id: 'Task ID', title: 'Title', description: 'Description', status: 'Project status', assignee: 'Assigned to', dueAt: 'Due date', done: 'Task status', taskCount: 'Tasks removed with project' };
function changeValue(field, value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (field === 'done') return value ? 'Completed' : 'Open';
  if (field === 'status') return statuses[value]?.[0] || String(value);
  if (field === 'dueAt') return fullDate(value);
  return String(value);
}
function renderActivity() {
  const names = new Map(state.projects.map(project => [project.id, project.title]));
  for (const event of state.activity.events) if (!names.has(event.projectId)) names.set(event.projectId, `${event.projectTitle} (no longer available)`);
  $('#activity-project').innerHTML = '<option value="">All projects</option>' + [...names].map(([id, title]) => `<option value="${escape(id)}" ${id === state.activityProject ? 'selected' : ''}>${escape(title)}</option>`).join('');
  $('#activity-coverage').textContent = state.activity.trackingSince ? `Project edits tracked since ${fullDate(state.activity.trackingSince)}. Earlier edits aren’t included.` : 'Project edit history is unavailable. Recorded submission events may still appear.';
  $('#activity-warning').hidden = !state.activity.warning;
  $('#activity-warning').textContent = state.activity.warning || '';
  const periodEvents = state.activityPeriod === 'week' ? recentEvents(state.activity.events) : state.activity.events;
  const events = periodEvents.filter(event => !state.activityProject || event.projectId === state.activityProject);
  $('#activity-list').innerHTML = events.length ? events.slice(0, state.activityLimit).map(event => `<details class="activity-event"><summary><span class="activity-event-icon">${svg(event.type.startsWith('work.') ? 'inbox' : event.type.includes('deleted') ? 'trash' : 'edit')}</span><span class="activity-event-copy"><strong>${escape(activityLabels[event.type] || event.type)}</strong><span>${escape(event.projectTitle)}${event.taskTitle ? ` · ${escape(event.taskTitle)}` : ''}</span></span><span class="activity-event-time">${escape(fullDate(event.occurredAt))}</span><span class="activity-event-chevron">${svg('chevron')}</span></summary><div class="activity-event-details"><p>Recorded by ${escape(event.actor || 'Workspace')} · ${event.source === 'submission' ? 'Submission workflow' : 'Workspace change'}</p>${event.changes?.length ? `<div class="activity-changes">${event.changes.map(change => `<div class="activity-change"><strong>${escape(fieldNames[change.field] || change.field)}</strong><span class="activity-before">${escape(changeValue(change.field, change.before))}</span><span class="change-arrow">→</span><span class="activity-after">${escape(changeValue(change.field, change.after))}</span></div>`).join('')}</div>` : '<p>Submission time and review details are recorded in Submissions.</p>'}${event.source === 'submission' ? '<button class="text-button" data-show-submissions>Open submissions</button>' : ''}</div></details>`).join('') : '<div class="activity-empty">No recorded updates match this view. Work before tracking began may not appear here.</div>';
  $('#more-activity').hidden = events.length <= state.activityLimit;
  $('#more-activity').textContent = `Show more activity (${Math.min(state.activityLimit, events.length)} of ${events.length})`;
}

$('#manager-search').addEventListener('input', event => { state.managerSearch = event.target.value; renderManager(); });
$('#activity-project').addEventListener('change', event => { state.activityProject = event.target.value; state.activityLimit = 50; renderActivity(); });
$('#activity-period').addEventListener('change', event => { state.activityPeriod = event.target.value; state.activityLimit = 50; renderActivity(); });
$('#more-activity').addEventListener('click', () => { state.activityLimit += 50; renderActivity(); });
$('#manager-section').addEventListener('click', event => {
  if (event.target.closest('[data-show-submissions]')) return setView('submissions');
  const history = event.target.closest('[data-project-activity]');
  if (history) {
    state.activityProject = history.dataset.projectActivity;
    state.activityLimit = 50;
    renderActivity();
    $('#activity-list').scrollIntoView({ block: 'start' });
    return;
  }
  const open = event.target.closest('[data-open-project]');
  if (open) {
    const project = state.projects.find(project => project.id === open.dataset.openProject);
    if (!project) return;
    state.search = project.title;
    state.expanded.add(project.id);
    $('#search').value = state.search;
    setView('all');
    $('#project-list').scrollIntoView({ block: 'start' });
  }
});

// External webhook deliveries become visible without a manual refresh.
setInterval(() => {
  if (!document.hidden && !state.loading && !state.mutating && !document.querySelector('dialog[open]')) void loadProjects({ silent: true });
}, 15_000);

// Keep date colors current when a tab stays open past midnight.
setInterval(() => {
  if (state.loaded && !document.hidden && !state.loading) { renderStats(); renderList(); }
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.loaded && !state.loading) { renderStats(); renderList(); }
});
loadProjects();
