# Carlos: manager overview and recorded changes

Open **http://localhost:3001** and select **Manager overview**.

## At a glance

Every current project has a summary, with attention items shown first:

- Its upstream status and completed/total task count.
- Overdue unfinished tasks and work due within four local calendar days.
- Pending manager reviews and completion results that need checking.
- The earliest unfinished deadline, including missed deadlines.
- The number of recorded updates in the last seven days.
- **Open project** to inspect tasks, **Review submissions** when relevant, and the update count to jump to that project's history.

A completed project with unfinished tasks is flagged for attention. A blocked project is also flagged even if all its tasks are complete, since its project status may need attention. Dropped projects remain visible as inactive; their old deadlines do not create an active-project alert in this view. The main dashboard's overdue count still includes all projects.

An open active project with no upstream timestamp update for seven calendar days gets a check-in signal. This is not proof that work stopped: other clients may not call the API's `touch` operation. A project marked blocked or containing overdue tasks has stronger direct evidence behind its alert.

The overview and report use deterministic rules, not an LLM interpretation.

## What changed

The activity log records confirmed changes made through this app's project/task routes:

- Project creation, title/description/status edits, and deletion.
- Task addition, completion, reopening, replacement, and deletion.
- Before-and-after field values, including ID changes when a task is replaced.
- Server-recorded change time and the project/task involved.

Expand an activity row to see the details. Filter by a project and choose **Last 7 days** or **All tracked history**. The log initially shows 50 matching entries; **Show more activity** reveals additional entries.

Submission and approval events are derived from their existing recorded receipts, so actual earlier receipt times can appear without inventing earlier project edits. A submission is one recorded update; approval or automatic completion is another. These counts describe workflow updates, not a count of fields edited or tasks completed.

Generic edits are labelled **Workspace** because this take-home has no authenticated editor identity. Submission names and reviewer names come from their form records.

## Downloadable update

**Download 7-day summary** generates a Markdown file from fresh project data and the last 168 hours of recorded activity. It includes every project, its attention signals, field changes, submission times relative to the original deadlines, and the history coverage statement. The download always covers the whole workspace, even when the on-screen search or history filter is narrowed.

No email or Slack messages are sent. Carlos can read the page or share the downloaded text himself.

For terminal use:

```sh
curl -s http://localhost:3001/api/activity
curl -s 'http://localhost:3001/api/report?timeZone=America%2FVancouver'
```

The browser requests its local timezone for the download; the route defaults to `America/Vancouver` when no timezone is supplied. Invalid timezone names return 400. The report and UI share the same summary rules.

## What the history can and cannot show

The log states when project edit tracking began. Edits from earlier phases, changes made directly through Later's API, and changes from other unconnected clients are not reconstructed. A blank history means no updates were recorded, not that no work happened. Failed or partially completed operations may be missing from the confirmed-change log.

Events are stored in `.local/activity.json`, excluded from Git, and survive a server restart. `ACTIVITY_FILE=/absolute/path/activity.json` can isolate verification history. Writes use a single-process queue and a temporary file followed by rename. A logging failure returns a saved-change warning and does not retry an upstream write or claim it failed.

Deleted/reset projects can retain historical entries under their old IDs; the log labels projects that are no longer available. The current summaries only list projects that exist in the live API. No old project data is restored into that API.
