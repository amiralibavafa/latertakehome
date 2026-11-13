# Take-home phases

Work through one phase at a time. Respect the assignment's 90-minute total cap; optional additions come after one useful workflow for each persona.

## Complete: shared dashboard

- [x] Local Node.js and JavaScript app using live Later API data.
- [x] Load every project page; search, expand projects, show task people and deadlines.
- [x] Green (5+ days), yellow (0–4 days), and red (overdue) date controls.
- [x] Status filters, summary counts, refresh, errors, and JSON export.

## Phase 1: Betty — complete

- [x] Discover actual write URLs, bodies, status values, and timestamp behavior.
- [x] Create, edit, and delete projects; manually manage project status.
- [x] Add tasks; complete or reopen them; delete with confirmation.
- [x] Explicitly replace task details, warning that IDs change and preserving completion.
- [x] Handle failed writes and partial replacement without silently deleting originals or retrying writes.
- [x] Verify with disposable data and remove it afterward.

## Phase 2: Andy — complete locally

- [x] Employee submission form identifies a project and open task.
- [x] Webhook reuses the shared completion operation.
- [x] Verify automatic completion against Later's real API.
- [x] Document an n8n HTTP Request setup in ANDY.md. No external account has been connected; cloud tools need a reachable URL, while the local form works now.
- [x] Implement pending review, manager approval, submission time, and original deadline in a local metadata file.
- [x] Deduplicate by stable event ID; reject changed payloads reusing an ID.
- [x] Reconcile interrupted writes and restarts through Check & retry.
- [x] Guard pending review against completion/replacement/deletion through normal task routes.
- [x] Verify with isolated metadata and disposable source tasks, then remove the test project.

## Phase 3: Carlos — complete

- [x] Add a concise summary of every project's state, overdue work, and blockers, with explainable attention signals.
- [x] Record confirmed edits through the app with before/after fields and timestamps; filter by project and period.
- [x] Show submission time relative to the original deadline (provided by Andy's flow).
- [x] Show when edit tracking began and explain that earlier/direct upstream edits cannot be reconstructed.
- [x] Download a last-seven-day summary containing all projects, recorded changes, and submission timing. No messages are sent.
- [x] Verify field differences, history persistence, late submissions, and report download using disposable data.

## Phase 4: Dani — JSON-based Q&A implemented

- [x] Add a bottom-corner chat panel.
- [x] Connect Gemini server-side; protect the key in environment configuration/ignored owner-only .env.
- [x] Regenerate a complete JSON file for every question, including live projects, submission/history metadata, and calculated summaries.
- [x] Restrict the structured prompt to this JSON, validate source paths, and refuse unsupported questions.
- [x] Handle missing keys, provider errors, quota limits, timeouts, and invalid answers without fake responses.
- [x] Verify real Gemini answers and secret-boundary behavior.
- [ ] Deferred by the requested Q&A scope: write tools and confirmed natural-language task creation.

## Phase 5: demo handoff

- [x] Finalize run instructions, supported workflows, omissions, API quirks, and next-day priorities in README.md and DEMO.md.
- [x] Exercise each implemented workflow through API/browser verification; keep a short walkthrough in DEMO.md.
- [x] Document reset behavior and verify stale-ID/restart handling with controlled tests; no upstream restart was performed.
- [x] Stop implementation before this session's 90-minute cap; keep deferred work explicitly listed above.
