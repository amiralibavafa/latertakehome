# Local demo walkthrough

Start with `PORT=3001 npm start`, then open http://localhost:3001. Node.js 20+ and an internet connection are required. No package installation or build step is needed. Gemini uses the local server key; the rest of the dashboard works without one.

1. **Shared base:** search for a project, expand it, inspect people/deadlines, and click a date. Explain the five-day calendar boundary and all-page API loading.
2. **Betty:** create a temporary project, edit its description/status, add a task, and complete/reopen it. Explain that task-field replacement changes its ID because no in-place edit was verified. Use disposable data for deletes.
3. **Andy:** submit the temporary task for review, show that it stays incomplete, then approve it from Submissions. Alternatively choose automatic completion or send the webhook payload from ANDY.md. Explain stable event IDs and duplicate delivery.
4. **Carlos:** open Manager overview, inspect a flagged project, filter its activity, expand an edit's before/after values, and download the seven-day summary. Explain the explicit history start and the uncertainty of a stale timestamp.
5. **Dani:** ask what's overdue, inspect its sources, then ask a question the workspace cannot answer. Explain that every request regenerates the JSON and that the key stays on the server. No chat-driven writes are implemented in this pass.

Remove the temporary demo project after reviewing its submissions. Its activity remains a historical record; it does not restore removed upstream data.

## Choices to discuss

- One dependency-free local Node server and one shared API adapter serve the UI, webhooks, reports, and Gemini context.
- The hosted API remains the source of truth. Local JSON stores only metadata the API cannot represent: submission/review receipts, observed edit history, and the latest assistant context.
- Undocumented quirks were discovered against disposable data: IDs belong in paths, pagination defaults to five projects, completion uses yes/no strings, and normal writes need a separate timestamp touch.
- LLM Q&A is grounded in the whole small dataset. Source references are validated, but this does not prove every model statement is correct.
- Deliberate omissions: chat-driven writes, external automation activation/tunnels, authenticated roles, email/Slack delivery, returning work for changes, attachments, and production infrastructure.
- With another day: add confirmed task-creation tools to Dani, resolve ambiguous names/dates, connect one real automation, add return-for-changes, and improve multi-user consistency.

## Reset behavior

The upstream data may reset and IDs may change. Refresh the dashboard and update external form mappings. Old local receipts/history can remain, labelled as unavailable when the source task or project no longer exists. Old submissions cannot approve or recreate reset tasks. No upstream restart was triggered during verification; stale-ID and restart behavior were checked with controlled tests.

Do not include `.env` or `.local` when sharing the source. The exercise has a 90-minute hard cap; keep later feature ideas separate from the take-home implementation.
