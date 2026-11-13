# Andy: form submission → automatic project update

## Try the working local flow

1. Open **http://localhost:3001** and click **Submit work**.
2. Choose a project and an open task, enter your name, and optionally add notes or a link.
3. Choose the outcome:
   - **Send for manager review** (default): record the submission, leave the task open, and show **Pending review** on the task.
   - **Complete automatically**: record the submission and mark the task complete immediately in Later.
4. For review mode, open **Submissions**, select **Review submission**, enter the reviewer's name, and choose **Approve & complete**.

The app records submission time, the deadline as it was at submission, on-time/late comparison, reviewer, and approval/completion time. Dashboard data refreshes every 15 seconds while visible and no dialog is open. Use Refresh for an immediate update.

Tasks awaiting review cannot be completed, replaced, or deleted through our app's normal task controls. This guard also applies to deleting their project. Direct calls to the upstream API remain outside our app's control.

## Connect an external form using n8n

The webhook is implemented and tested. No external account or form provider has been connected by this project.

Workflow: **your form's submission trigger → HTTP Request node → inspect the submission status**.

Use these HTTP Request settings:

| Setting | Value |
| --- | --- |
| Method | POST |
| URL | `http://localhost:3001/api/webhooks/task-submitted` for n8n running directly on this same machine |
| Authentication | None for this local take-home |
| Send Body | On |
| Body Content Type | JSON |
| Specify Body | Using Fields Below, or Using JSON |

Map the incoming form fields to this body:

```json
{
  "eventId": "YOUR_STABLE_FORM_SUBMISSION_ID",
  "projectId": "CURRENT_PROJECT_ID",
  "taskId": "CURRENT_TASK_ID",
  "submitter": "NAME_FROM_FORM",
  "mode": "review",
  "notes": "NOTES_OR_WORK_LINK_FROM_FORM"
}
```

Set `mode` to `complete` for Andy's simplest trigger-to-completion workflow. The mode is required; the backend does not guess whether to bypass review.

Use the originating form record's stable ID for `eventId`. Keep both the ID and body unchanged when delivering that event again. A distinct form submission needs a new ID. Do not generate a fresh ID on every delivery retry. The browser form generates its event ID automatically.

Get current project IDs and task IDs from `GET /api/projects` or **Export project data**. A task ID appears as `todos[].id`. Configure form options to carry those values so employees choose names rather than entering IDs. IDs may change after an API reset or task replacement; remap the form options then.

n8n Cloud, Make, and Zapier cannot reach this computer's loopback URL. Connecting them requires a reachable hosted or tunnel URL; Docker/container-based n8n also needs a host-reachable address. This exercise stays local: no tunnel, public deployment, authentication, or external workflow activation is configured. The working local form calls the same submission service as the webhook.

The HTTP Request field names above were checked against the [official n8n HTTP Request documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/). Make and Zapier can use the same JSON contract in their HTTP steps.

## Terminal example

Replace the two IDs with a current project and task before running this. It writes to the real API.

```sh
curl -sS -X POST http://localhost:3001/api/webhooks/task-submitted \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"demo-form-001","projectId":"CURRENT_PROJECT_ID","taskId":"CURRENT_TASK_ID","submitter":"Andy","mode":"review","notes":"Ready for review."}'
```

Repeat the exact request to see `duplicate: true` and the same submission ID. Reusing its event ID with changed details returns HTTP 409 instead of guessing which event was intended.

## Response handling

| Response | Meaning |
| --- | --- |
| 201 with `status: pending` | Submission recorded; manager approval needed |
| 201 with `status: completed` | Submission recorded and task completed automatically |
| 200 with `duplicate: true` | This event was already received; no second submission or write |
| 202 with `status: uncertain` | Submission saved, but completion could not be confirmed; reconcile through Submissions |
| 400 | Fix missing or invalid input |
| 409 | Conflicting duplicate, an existing pending review, or a task/project that no longer exists |
| 502 | Could not read upstream data; no confirmed new submission |

Every successful receipt includes `{ submission, duplicate?, warning? }`. Treat `submission.status` as the result; HTTP 202 does not mean completion succeeded. An automation can branch on that status. A duplicated uncertain event is returned with 202 and `duplicate: true`.

Other local routes:

| Method | Route | Body |
| --- | --- | --- |
| GET | `/api/submissions` | None |
| POST | `/api/submissions` | Same body as the webhook; used by the local form |
| POST | `/api/submissions/:submissionId/approve` | `{ "reviewer": "Carlos" }` |
| POST | `/api/submissions/:submissionId/retry` | `{}` |

**Check & retry** reads the current task first. If already complete, it reconciles the local receipt without marking it again. Otherwise it repeats the idempotent set-complete operation. A pending review cannot use retry to skip approval.

## Storage and limits

Only submission metadata is stored in `.local/submissions.json`, which is excluded from Git. The write uses a temporary file followed by rename. A single-process queue serializes receipts and review decisions. Metadata survives a local server restart; Later remains the source of truth for projects and tasks.

The local file and remote API cannot form one atomic transaction. A restart during completion becomes **Needs a check**, requiring reconciliation. If the upstream data resets, historical submissions remain visible as local records; unavailable tasks cannot be approved or recreated automatically. Review names are entered for this local demo; login and manager-role enforcement are outside the exercise scope.

Approval is implemented. Returning work for changes, attachments, notifications, and multi-server storage are left for later. A generic edit history is Carlos's next phase; these records currently cover submissions and approvals only.
