# Later project workspace

A local Node.js + plain JavaScript workspace using the provided Later Projects API. No npm dependencies, build step, or separate database. Gemini chat uses a server-side API key; the dashboard works without it.

## Run locally

Requires Node.js 20 or newer, plus internet access to the hosted API.

```sh
npm start
```

Open **http://localhost:3000**. `npm run dev` restarts the server when backend files change; refresh the browser after frontend edits. Use `PORT=3001 npm start` if port 3000 is occupied.

## Dashboard and editing

- All projects, including every page of upstream results.
- Search project titles and descriptions.
- Expand a project to view its tasks, people, deadlines, and completion.
- Green dates: at least 5 calendar days away. Yellow: today through 4 days away. Red: an unfinished task due before today. Completed tasks have a neutral Done label.
- Click a task's date for its full deadline and details.
- Overview counts; filters for in-progress, blocked, completed, and projects needing attention.
- Manual refresh, loading and empty states, and readable connection errors. A failed refresh keeps the last loaded results and clearly labels them.
- Download a fresh JSON snapshot using **Export project data**.
- Create projects; edit their title, description, and status.
- Add tasks with an assignee and a due date. New dates use the end of the selected local day.
- Use the task checkbox to mark complete or reopen.
- **Replace task** changes its title, assignee, and deadline by creating a new task with a new ID, preserving completion, then removing the original. The form explicitly warns that automation links using the old ID need updating. If the selected due date is unchanged, the original deadline timestamp is preserved.
- Delete tasks or whole projects with a confirmation naming what will be removed.
- Buttons are disabled while saving. Errors preserve form inputs. Writes are never automatically retried; after an ambiguous failure, the list refreshes to show the upstream state.
- **Submit work** sends a task for manager review or completes it automatically. **Submissions** shows receipts, original deadlines, timing, and approvals. Pending review is the default and leaves the task open until approval.
- A webhook receives the same events from automation tools, deduplicates repeated delivery, and reuses the shared task adapter. See [ANDY.md](ANDY.md) for the working local demo and n8n HTTP setup.
- Visible dashboards refresh every 15 seconds when no form is open, so external submissions appear without a click.
- **Manager overview** summarizes every project's state, risks, progress, reviews, and recorded updates. A filterable activity log shows before/after edits, and **Download 7-day summary** exports a fresh workspace report. See [CARLOS.md](CARLOS.md) for the rules and history coverage.
- **Ask LLM** opens a Gemini-powered question-answering panel. Each question regenerates a private JSON file containing the live projects, submissions, history, and computed summaries. The structured prompt restricts answers to that snapshot, and source references are validated. See [DANI.md](DANI.md) for prompt and credential handling.

Replacement uses multiple API calls because no in-place task edit was verified. It is not atomic. If a later step fails, the original may remain alongside a replacement; the error explains this and asks the user to refresh and review. The original is never removed before the replacement is ready.

Calendar dates use the browser's local timezone. “In progress” combines `kickoff` and `wip`; “Completed projects” means upstream status `wrapped`. “Needs attention” means blocked or containing an unfinished overdue task. Counts include all projects, including dropped projects, to avoid silently hiding their outstanding tasks. Completed tasks do not count as overdue.

## Inspect the API from your terminal

```sh
npm run inspect:api
```

This prints health, the raw default response, all projects after pagination, and a normalized project example. It only reads data.

The server also exposes:

```sh
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/projects
curl -s http://localhost:3000/api/snapshot
```

`GET /api/projects` returns `{ fetchedAt, source, total, projects, submissions, activity }`. A project has `{ id, title, description, status, updatedAt, todos }`; a todo has `{ id, title, assignee, dueAt, done }`. Dates are ISO strings or null. `/api/snapshot` returns the same structure with a JSON download header. Projects are fetched live; submission and activity metadata come from local files. `/api/activity` returns `{ trackingSince, events, warning? }`; `/api/report?timeZone=America%2FVancouver` downloads the seven-day Markdown report.

## Structure

```text
server.js               Local HTTP server; serves frontend and read/write routes
lib/projects.js         Shared upstream client, pagination, field normalization
lib/submissions.js      Durable local submission receipts, deduplication, approval
lib/activity.js         Persistent field-change history and submission timeline
lib/report.js           Whole-workspace seven-day Markdown report
lib/chat.js             Server-only Gemini configuration, prompt, context, evidence
public/index.html       Dashboard structure
public/app.js           Dashboard, editor forms, confirmation, and save feedback
public/chat.js          Bottom-corner chat, plain-text answers, and sources
public/dates.js         Calendar-day deadline rules
public/summary.js       Shared manager summary rules and activity labels
public/styles.css      Responsive layout
scripts/inspect-api.js  Terminal exploration of real API responses
test/projects.test.js   Date-boundary and API-pagination checks
test/writes.test.js     Write mapping, timestamps, and replacement failure checks
test/submissions.test.js Review, retry, duplicate, restart, and reset checks
test/manager.test.js    Manager signals, history differences, persistence, report
test/chat.test.js       Fresh context, grounded references, errors, secret handling
ANDY.md                 Employee flow, webhook payload, and automation setup
CARLOS.md               Manager view, report, and history coverage
DANI.md                 Gemini setup, structured prompt, and Q&A scope
DEMO.md                 Live walkthrough, decisions, omissions, next-day ideas
```

The browser talks to the local Node server; Node talks to Later's API. This avoids browser CORS issues and gives future automation and LLM tools one shared integration layer. Later remains the source of truth. Saves write to the real hosted API, which can reset. No mock projects or silently cached disk data are used. The server requires no npm dependencies.

Optional server configuration: `PROJECTS_API_URL=https://… npm start`. It defaults to the take-home URL. `SUBMISSIONS_FILE=/absolute/path/submissions.json` overrides the submission file, and `ACTIVITY_FILE=/absolute/path/activity.json` overrides the edit history file; both default to `.local/`. Gemini reads `GEMINI_API_KEY` and optional `GEMINI_MODEL` from server environment variables or the ignored `.env` file. `.env.example` contains placeholders. The actual key is not in public assets, prompts, logs, or snapshot exports. Exclude `.env` and `.local` when sharing source.

## API discoveries

Observed in this session; the upstream IDs, dates, and data can reset.

- `GET /api/v1/health` → `{ "status": "ok" }`.
- `GET /api/v1/proj` → `{ from: 0, take: 5, total: 7, projects: [...] }`.
- Pagination uses `from` and `take`; `?from=5&take=5` returned the remaining two projects.
- Projects embed task data as `items` (not `todos`).
- Task fields are `id`, `task` (title), `who` (person), `by` (Unix milliseconds), and `done` (boolean).
- Project `updated_at` is also Unix milliseconds.
- Observed statuses: `wip`, `kickoff`, `blocked`, `wrapped`, `dropped`.
- The list contains enough data for this dashboard, so per-project requests are unnecessary.
- The project ID belongs **in the URL**, not an `id` query parameter or request body. `/api/v1/proj/modify` alone is treated as a project lookup, so PUT returns 405.
- Project updates silently ignore an `items` array. No task-field edit endpoint was verified. Replacement is an explicit separate operation, not an in-place edit.
- Task completion accepts `{ "flag": "yes" }` or `{ "flag": "no" }`, not `{ "done": true }`.
- Ordinary writes do **not** advance `updated_at`; explicitly POST to `touch`. The adapter does this after project edits, task addition, completion, replacement, and deletion. A failed touch returns a saved-change warning rather than falsely reporting the write as unsaved.
- Invalid statuses return 400 and list the five accepted statuses.

Verified upstream routes (`:projectId` and `:taskId` are URL path segments):

| Method | Path after `/api/v1` | JSON body |
| --- | --- | --- |
| GET | `/proj/:projectId` | None |
| POST | `/proj/new` | `{ title, description, status }` |
| PUT | `/proj/:projectId/modify` | Any of `{ title, description, status }` |
| DELETE | `/proj/:projectId/remove` | None |
| POST | `/proj/:projectId/touch` | `{}` |
| GET | `/proj/:projectId/items` | None |
| POST | `/proj/:projectId/items/add` | `{ task, who, by }`, where `by` is Unix milliseconds |
| POST | `/proj/:projectId/items/:taskId/mark` | `{ flag: "yes" }` or `{ flag: "no" }` |
| DELETE | `/proj/:projectId/items/:taskId/yank` | None |

The local API exposes friendlier routes:

| Method | Local route | Purpose |
| --- | --- | --- |
| POST | `/api/projects` | Create with `{ title, description, status }` |
| PATCH | `/api/projects/:projectId` | Edit project fields |
| DELETE | `/api/projects/:projectId` | Delete a project and its tasks |
| POST | `/api/projects/:projectId/tasks` | Add with `{ title, assignee, dueAt }` (ISO date) |
| PATCH | `/api/projects/:projectId/tasks/:taskId` | Set `{ done: true }` or `{ done: false }` |
| DELETE | `/api/projects/:projectId/tasks/:taskId` | Delete task |
| POST | `/api/projects/:projectId/tasks/:taskId/replace` | Replace with `{ title, assignee, dueAt }` |

Successful writes return `{ result, warning? }`. Both human forms and future automation/LLM clients can use these routes.

## Phases and remaining work

The dashboard, Betty's controls, Andy's local submission/webhook/review workflow, Carlos's overview/history/report, and Dani's Gemini Q&A are implemented. See [PHASES.md](PHASES.md) and [DEMO.md](DEMO.md). No external automation account is connected; a cloud tool would need a reachable URL. Dani is read-only, matching the requested JSON-based answers.

1. **Later extension:** confirmed natural-language task creation using the shared adapter. It is deliberately deferred in this question-answering pass.
2. **Demo:** follow DEMO.md and discuss the deliberate omissions and API reset behavior.

Write discovery and browser verification use clearly named disposable projects, removed afterward. Andy's live verification also uses a separate metadata file so test receipts do not appear in the normal workspace. Existing projects are left in place. Keep the exercise's 90-minute hard cap in view; prioritize one useful action per persona before expanding features.

## Checks

```sh
npm test
```

Forty focused checks cover deadlines, pagination, writes, submissions, review, restart/reset behavior, manager/history/report logic, fresh chat snapshots, source validation, and credential protection. Live API and browser checks covered the workflows and real Gemini answers. Unsupported/out-of-scope requests were refused. History has an explicit start time and is never backfilled with guessed edits.
