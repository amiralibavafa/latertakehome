# Later Projects Workspace: technical breakdown

## 1. The problem I chose to solve

Later supplied a project API with no usable interface, documentation, or SDK. Four people wanted different ways to work with the same underlying projects and tasks. The common need was visibility: find a project, understand its status, see the owner and deadline of each task, and know what needed attention.

I built that shared foundation first. A small dashboard makes the data useful to everyone, and one shared server-side integration means each additional workflow reuses the same API knowledge. Betty gets manual controls; Andy gets an event receiver and submission flow; Carlos gets summaries and observed history; Dan gets natural-language answers from a fresh snapshot.

The aim is a working local prototype and explainable decisions. It is not a production project-management replacement.

## 2. Technology stack and packages

| Layer | What is used | Why |
| --- | --- | --- |
| Runtime | Node.js 20+, tested on Node 20.12 | One JavaScript language across the browser and server; native HTTP, fetch, filesystem, and test APIs |
| Backend | JavaScript ES modules and `node:http` | A few focused routes did not require a framework |
| Browser | HTML, CSS, plain JavaScript modules, native Fetch | A small understandable UI with no build pipeline |
| Dates | JavaScript `Date` and `Intl.DateTimeFormat` | Consistent local-calendar deadlines and timezone-aware output |
| Source system | Later's hosted Projects REST API | Remains authoritative for projects, tasks, completion, and project status |
| LLM | Gemini 2.5 Flash through Google's REST API | Answers questions about the current workspace without an SDK dependency |
| Local metadata | JSON files under `.local/` | Stores submission/review receipts and observed history that the API cannot represent |
| Credentials | Server environment variables or ignored, owner-only `.env` | Keeps the Gemini key out of browser assets and prompts |
| Verification | `node:test`, `node:assert/strict`, live HTTP calls, browser checks | Focused checks for easy-to-miss behavior and working workflows |

**Application npm dependencies: zero.** `package.json` defines commands rather than installing runtime packages. There is no Express, React, ORM, SQL database, Gemini SDK, or automation-platform SDK in the application. Native SVG icons and system fonts are used in the UI.

The PDF and slides are handoff artifacts. Their authoring libraries are separate from the application's runtime requirements.

Commands:

```sh
PORT=3001 npm start       # Run the local app
PORT=3001 npm run dev     # Restart the backend after source edits
npm run inspect:api      # Read and print the upstream response structure
npm test                 # Run 40 focused checks
```

Port 3000 is the default; this machine uses 3001 because 3000 was occupied. The server binds to the local computer at `127.0.0.1`.

## 3. Architecture and data ownership

```text
Browser: dashboard, editing, submissions, manager view, Ask LLM
                         |
                  Local Node.js server
                         |
           Shared project API adapter: lib/projects.js
                         |
              Later's hosted Projects API

Local server also reads/writes:
  .local/submissions.json        Submission/review receipts
  .local/activity.json           Confirmed field-change history
  .local/assistant-context.json  Fresh derived context for the latest LLM question

Only the chat route calls Gemini. The API key stays on the server.
```

The browser calls the local server, which calls Later. This gives every workflow the same field mapping and avoids browser cross-origin problems. It also provides a private place for the Gemini credential.

The local JSON files do not replace the project database. Projects and tasks are fetched from Later. Historical receipts can remain after an upstream reset, but they do not recreate old projects or tasks.

## 4. Files and responsibilities

| File | Responsibility |
| --- | --- |
| `server.js` | Serves a fixed list of public assets; validates JSON request bodies; routes reads, writes, submissions, reports, and chat |
| `lib/projects.js` | Upstream HTTP requests, pagination, input validation, field normalization, project/task operations, and explicit timestamp touch |
| `lib/submissions.js` | Stable event IDs, duplicate handling, pending review, approval, uncertain completion, and review guards |
| `lib/activity.js` | Persistent confirmed-change events with before/after values; derives submission timeline events |
| `lib/report.js` | Builds a deterministic Markdown summary for the last seven days |
| `lib/chat.js` | Loads server-only Gemini configuration, builds/writes context, applies the system prompt, calls Gemini, and validates references |
| `public/index.html` | Page structure, forms, dialogs, navigation, and chat panel |
| `public/app.js` | UI rendering, searching/filtering, editor dialogs, saving, submissions, and manager interactions |
| `public/chat.js` | Browser chat state, requests, plain-text answers, source inspection, and errors |
| `public/dates.js` | Shared calendar-day deadline rules |
| `public/summary.js` | Shared manager-summary rules and activity labels |
| `public/styles.css` | Responsive layout and visual styles |
| `scripts/inspect-api.js` | Read-only terminal exploration of Later's API |
| `test/*.test.js` | Focused behavior checks; no live Gemini calls inside the test suite |

## 5. API discovery and normalization

Base URL: `https://fde-takehome-projects-api-hkbn2zj27a-ue.a.run.app`.

Important findings:

1. The project list defaults to **five results**, while the provided dataset contains **seven projects**. The adapter follows `from` and `take` until all projects are loaded. It rejects incomplete or repeated pages rather than displaying incorrect totals.
2. Project IDs belong **inside the URL path**, not an `id` query parameter or request body.
3. Projects embed tasks in `items`; task fields are `task`, `who`, `by`, and `done`.
4. `by` and `updated_at` are Unix milliseconds. The local API converts them to ISO date strings.
5. Completion expects `flag: "yes"` or `flag: "no"`, not a boolean `done` payload upstream.
6. Ordinary writes do not advance `updated_at`. The adapter calls the separate `touch` endpoint after relevant writes.
7. A project update ignores an `items` array. No in-place task-field update was verified. The UI therefore labels the alternative **Replace task**, with a visible warning about the new ID.

| Upstream method | Path after `/api/v1` | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/proj?from=0&take=5` | Paginated project list |
| GET | `/proj/:projectId` | One project |
| POST | `/proj/new` | Create project |
| PUT | `/proj/:projectId/modify` | Edit title, description, status |
| DELETE | `/proj/:projectId/remove` | Delete project |
| POST | `/proj/:projectId/touch` | Update project timestamp |
| GET | `/proj/:projectId/items` | Read tasks |
| POST | `/proj/:projectId/items/add` | Add task |
| POST | `/proj/:projectId/items/:taskId/mark` | Set completion using yes/no |
| DELETE | `/proj/:projectId/items/:taskId/yank` | Delete task |

Normalized project: `{ id, title, description, status, updatedAt, todos }`.

Normalized task: `{ id, title, assignee, dueAt, done }`.

Statuses are `kickoff`, `wip`, `blocked`, `wrapped`, and `dropped`. Friendly UI labels preserve those source meanings.

The browser and automations use these local routes. The server translates their friendlier payloads into the upstream formats above:

| Local method and path | Purpose |
| --- | --- |
| `GET /api/health` | Check the local connection to Later |
| `GET /api/projects` | All normalized projects plus workflow metadata |
| `GET /api/snapshot` | Download that workspace JSON |
| `POST /api/projects` | Create a project |
| `PATCH /api/projects/:projectId` | Edit project title, description, or status |
| `DELETE /api/projects/:projectId` | Delete a project |
| `POST /api/projects/:projectId/tasks` | Add a task |
| `PATCH /api/projects/:projectId/tasks/:taskId` | Complete or reopen with `{ done: true/false }` |
| `DELETE /api/projects/:projectId/tasks/:taskId` | Delete a task |
| `POST /api/projects/:projectId/tasks/:taskId/replace` | Replace task fields with a new task ID |
| `GET /api/submissions` | Read submission receipts |
| `POST /api/submissions` | Submit from the app |
| `POST /api/webhooks/task-submitted` | Submit from an external trigger |
| `POST /api/submissions/:id/approve` | Approve and complete reviewed work |
| `POST /api/submissions/:id/retry` | Reconcile an uncertain completion |
| `GET /api/activity` | Observed edits and submission events |
| `GET /api/report?timeZone=America/Vancouver` | Download a seven-day Markdown report |
| `GET /api/chat/status` | Read whether the assistant is configured |
| `POST /api/chat` | Ask a workspace question with optional short history and timezone |

## 6. Shared dashboard and Betty's controls

The default page shows every project, search by title/description, expandable task lists, people, status, progress, and deadline details. Search and status filters reduce the work needed to find a project.

Deadline colors use the viewer's calendar date: green at five or more days away; yellow from today through four days away; red for an unfinished task due before today. Completed tasks are labelled Done and excluded from overdue counts. Missing dates remain neutral.

Betty can create/edit/delete projects, add tasks, complete/reopen tasks, and replace/delete tasks. Replacement creates the new task first, preserves completion, and removes the old task only after the replacement is ready. It is a multi-call operation, not an atomic transaction. A partial failure is explained and the UI refreshes the actual source state.

Buttons are disabled while saving. Failed writes retain form input. The app does not blindly retry writes whose outcome is uncertain.

## 7. Andy's form and webhook

Both the local form and `POST /api/webhooks/task-submitted` call the same submission service.

Payload: `{ eventId, projectId, taskId, submitter, mode, notes? }`.

- `mode: "complete"`: save the receipt and set the upstream task complete.
- `mode: "review"`: save a pending receipt; leave the task open until a manager approves it.

The form defaults to review mode. The receipt records the submission time and original deadline, so later deadline edits do not rewrite the submission's timeliness.

A stable `eventId` makes repeated deliveries return the same receipt. The same ID with a changed payload returns a conflict. A second pending review for the same task is rejected.

Approval uses `/api/submissions/:id/approve`; Check & retry uses `/api/submissions/:id/retry`. Interrupted completion is reconciled by reading the task first and repeating only the idempotent set-complete operation when needed. A pending review cannot use retry to skip approval.

Normal edit routes guard pending reviews against completion, replacement, task deletion, and project deletion. Direct writes to Later outside this app remain outside those guards.

The webhook works locally and has a documented n8n HTTP setup. No external account, public tunnel, or active cloud workflow is connected. Cloud automation cannot call this computer's loopback URL without a reachable address.

## 8. Carlos's overview and history

Manager overview summarizes every live project, sorting attention items first. Signals include blocked status, unfinished overdue tasks, pending reviews, uncertain completions, and a project marked completed while tasks remain open. An old timestamp is labelled as a check-in signal, not proof that work stopped. Dropped projects stay visible as inactive.

The log records confirmed changes through this app, with field-level old/new values and server timestamps. No-op edits do not create noise. Submission and approval events use their actual receipt timestamps. Generic edits are labelled Workspace because this demo has no authenticated editor identity.

The report covers the last 168 hours and includes all projects, signals, recorded changes, and original submission-deadline comparisons. It is generated from the same deterministic rules as the UI, not from an LLM. No email or Slack message is sent.

The coverage boundary is visible: earlier edits, failed/partial operations, and unobserved external changes may not appear. An empty log does not prove that no work happened.

## 9. Ask LLM: Gemini and fresh JSON

For every question, the server fetches all current projects and loads receipts/history. It adds current date, timezone, overdue calculations, and project summaries, then writes `.local/assistant-context.json`. The exact file content is supplied to Gemini.

The system prompt separates task authority, untrusted data, time semantics, and evidence/output rules. Notes and project descriptions are treated as data rather than instructions. Earlier chat messages help resolve references but cannot override the newest snapshot.

Gemini returns structured JSON: `{ answer, evidence, insufficientData }`. Evidence paths must resolve to the supplied snapshot. Invented paths, uncited factual answers, and malformed results are rejected. Unsupported questions receive a standard missing-data response. Answers render as text rather than executable HTML.

This is full-snapshot grounding for a small dataset, not a vector-search RAG system. Reference validation checks that evidence exists; it does not prove every generated sentence is correct. The UI exposes sources and refresh time so users can verify important claims.

The key is server-only, in environment configuration or an ignored file with owner-only permissions. It is sent only as Google's HTTPS authentication header. It is excluded from prompts and public files. Provider error bodies are not relayed. Both secret/configuration and private context paths return 404 over HTTP. Chat transcripts stay in browser memory.

The assistant is read-only in this pass. Confirmed natural-language task creation is the main deferred part of Dan's original broader request.

## 10. Verification, limitations, and next work

Forty local checks cover date boundaries, pagination, write mapping, replacement failure, duplicate delivery, approval, restart/reset handling, manager signals, history persistence, fresh LLM context, reference validation, and credential protection. Live API/browser checks exercise the implemented workflows. Actual Gemini calls verified grounded overdue answers and refusal of outside-knowledge/secret requests.

Known limits: no authenticated roles, production infrastructure, multi-server JSON coordination, attachments, return-for-changes, external automation activation, or chat-driven writes. Source resets and task replacement can change IDs. Local metadata and remote writes cannot form one transaction.

With another day, I would first add a narrow confirmed task-creation tool to the assistant, then connect one real form workflow, then improve review/concurrency behavior. These are explicit extensions, not claims about the present prototype.

## 11. Demo preparation and reset

The demo content was restored against the first observed Later API snapshot: seven projects and eighteen tasks, with matching titles, descriptions, statuses, people, deadlines, and completion. Local receipts/history were cleared after a private backup. API-generated task IDs and update times can differ; the hosted service does not expose an original-ID restore operation. The key configuration was preserved.

The chat label is now **Ask LLM**. The rename, data cleanup, and handoff materials are presentation preparation after the initial build and should not be represented as additional features completed inside the original build clock.
