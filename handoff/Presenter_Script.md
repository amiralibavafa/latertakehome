# Screen-sharing walkthrough and speaker script

Suggested length: **12-15 minutes**, followed by questions. The deck follows the same order. Use the deck to frame the decisions, then switch to the app for the feature demonstrations. Do not read every technical detail aloud; the technical breakdown is your reference for follow-up questions.

## Before the call

- Run `PORT=3001 npm start` or keep the already-running development server open.
- Open the app at http://localhost:3001 and the PowerPoint deck. Keep the terminal available with `npm run inspect:api` ready if they ask about discovery.
- Keep `.env`, private JSON files, and terminal environment output off screen.
- The starting view has seven projects and eighteen tasks. Activity and submissions begin empty after the requested reset. Do not present an empty history as proof that no work happened.
- For the live edit/submission demonstration, create a clearly named **Demo project** and a task due next week. This keeps the supplied projects intact. Remove the demo project after its review is complete.
- Have the one-page overview available. Do not suggest that a localhost address will work on the interviewer's computer.

## Slide 1 - Later Projects Workspace (20 seconds)

**Show:** the title slide.

**Say:**

“I built a local workspace on top of the provided Projects API. My starting point was that the four people have different workflows, but they share the same project data. I wanted one small foundation that made that data understandable, then a focused addition for each person.”

**Transition:** “I’ll start with that common need, then walk through the working flows and the decisions behind them.”

## Slide 2 - Four workflows, one shared foundation (45 seconds)

**Show:** the four-person comparison.

**Say:**

“Everyone needs to find the right project and understand its state, its tasks, who owns them, and when they are due. A simple interface is useful to all four people, not only Betty. Andy needs a dependable way for an event to update a task. Carlos needs a concise view of risk and change. Dan wants to ask questions in natural language.

“I separated the shared problem from those additions. That led me to one dashboard and one reusable integration layer, rather than four separate applications.”

**Transition:** “Before building the workflows, I had to learn what the API actually expected.”

## Slide 3 - What API discovery changed (50 seconds)

**Show:** the API discoveries slide. Optionally show the terminal inspection command if asked.

**Say:**

“The first useful discovery was pagination: the default list only returned five projects, even though there were seven. A dashboard that stopped there would look correct while hiding data. I made the adapter fetch every page before calculating totals.

“The write formats also had quirks. The project ID belongs in the URL. Completion uses yes or no strings. Normal writes do not update the project's timestamp, so I call touch separately. I captured these rules once in the adapter, so Betty, the webhook, and future tools do not each have to rediscover them.”

**Transition:** “With that shared API understanding in place, the first user-visible layer is intentionally simple.”

## Slide 4 - The common dashboard (60 seconds)

**Show in the app:** All projects; search for launch; expand the project; point to status, person, progress, and colored dates. Click a date to show its details.

**Say:**

“This is the shared foundation. Projects are searchable and expandable. A teammate can quickly see what the project is, what is complete, who owns each task, and which deadlines matter.

“Green means at least five calendar days away. Yellow means today through four days away. Red means an unfinished task is overdue. Completed tasks are excluded from the overdue count. I use local calendar days so a task due today does not suddenly become overdue at an arbitrary time of day.

“The totals come from the API data, and the page refreshes in the background. I kept the layout restrained because finding the next action matters more here than adding visual complexity.”

**Transition:** “Betty's controls build directly on that same structure.”

## Slide 5 - Betty: direct editing (60 seconds)

**Show in the app:** create Demo project; edit its description/status; add Demo review task; optionally complete then reopen it. Open Replace task to show its notice, then cancel.

**Say:**

“Betty can manage project details and status, add tasks, and complete or reopen them without using curl. Delete actions identify what will be removed and ask for confirmation.

“One API limit affected the design: I did not verify an in-place task-field update. Instead of silently deleting and recreating something under an Edit label, I made Replace task explicit. It explains that the task gets a new ID and that automation links may need updating. The new task is created before the old one is removed, and partial failures are surfaced.”

**Transition:** “The same completion operation is also what Andy needs behind an automation.”

## Slide 6 - Andy: submission and automation (90 seconds)

**Show in the app:** Submit work; select the Demo project/task; enter a name and notes; use Send for manager review. Open Submissions and show Pending review. Approve it with a reviewer name. Point back to the completed task.

**Say:**

“The employee submits once. With review mode, the app records the submission time and the original deadline, but leaves the task open. A manager's approval then marks it complete in Later. There is also an automatic-completion mode for the assignment's simpler trigger-to-completion case.

“The form and the webhook call the same service. Andy can connect a form trigger in n8n, Make, or Zapier to this endpoint. The stable event ID handles repeated delivery: the same event returns the same receipt instead of creating another submission.

“I also handle an uncertain result. If the connection is lost during completion, the app checks the current task before retrying the idempotent set-complete operation. A pending review cannot use that path to skip approval.”

**Be explicit:** “The local flow and webhook work. I have not activated an external cloud workflow. A cloud service would need a reachable URL rather than localhost.”

**Transition:** “Those receipts also create useful evidence for Carlos.”

## Slide 7 - Carlos: state, risk, and observed change (75 seconds)

**Show in the app:** Manager overview; a blocked or overdue project; filter the activity to Demo project; expand an edit; download the seven-day summary.

**Say:**

“Carlos gets a summary of every current project, with attention items first. The signals are explainable: a blocked status, unfinished overdue work, pending review, or a project marked completed while tasks remain open.

“The activity log shows field-level before-and-after values for confirmed changes through this app. The submission receipt compares the actual submission time with the deadline as it was when the work was submitted.

“I made the history boundary visible. I cannot reconstruct changes from before tracking began, or edits made directly through another client. Similarly, a stale timestamp is a reason to check in, not proof that progress stopped.

“The downloadable seven-day report uses the same rules as the UI. It gives Carlos another way to consume the information without needing an email or Slack integration for the local demo.”

**Transition:** “The assistant uses that same workspace data, with a different interaction style.”

## Slide 8 - Dan: Ask LLM with a fresh snapshot (90 seconds)

**Show in the app:** Ask LLM; ask “What's overdue?”; expand the sources. Ask “What changed in the last seven days?” after the demo edits. If useful, ask a question the workspace cannot answer.

**Say:**

“For each question, the backend fetches the current projects and reads the submission and activity records. It adds the current date, timezone, and deterministic calculations, writes a fresh JSON file, and supplies that exact file content to Gemini.

“The prompt treats descriptions and notes as untrusted data, not instructions. It asks for a structured answer with evidence paths into the JSON. The server validates those paths and rejects uncited or malformed responses. Unsupported questions get an explicit missing-data response.

“The key stays on the server and is excluded from browser files and the prompt. This is whole-snapshot grounding because the dataset is small; I did not add a vector database or claim that it is a retrieval-search system.

“This version is question-answering only. Chat-driven task creation is the deliberate gap in Dan's broader request. My next step would be a narrow creation tool with ambiguity handling and an explicit confirmation before a write.”

**Transition:** “The architecture behind these different interfaces is still small.”

## Slide 9 - Shared architecture (60 seconds)

**Show:** the architecture slide. Keep the app available for questions.

**Say:**

“The browser handles presentation and interaction. A local Node server serves the UI and exposes the routes. The shared adapter handles Later's HTTP requests, field mapping, validation, pagination, and timestamp behavior.

“Submissions, activity, reports, and chat are focused modules around that adapter. The report is deterministic. Only the chat route calls Gemini. This means the interface, webhook, and later LLM tools can reuse the same project operations.

“The app has no third-party npm runtime dependencies. I used Node's built-in HTTP server and fetch, browser-native JavaScript, and a small CSS layout. That reduced setup and kept the local demo easy to understand.”

**Transition:** “The important boundary is where each kind of data lives.”

## Slide 10 - Data ownership and state (45 seconds)

**Show:** the data-ownership slide.

**Say:**

“Later remains the source of truth for projects and tasks. I do not restore a private copy into its resettable API. The local JSON files only hold the extra metadata needed for submission review and observed history. The assistant context is regenerated, and chat messages stay in browser memory.

“That split also makes the reset limitation clear. If Later resets and IDs change, old receipts may remain as historical records, but they cannot approve or recreate a task that no longer exists.”

**Transition:** “Here is what I validated, and where I intentionally stopped.”

## Slide 11 - Verification and deliberate limits (50 seconds)

**Show:** the verification/limits slide.

**Say:**

“I used focused checks for the easy-to-miss behavior: the exact five-day boundary, daylight-saving changes, pagination, yes/no flags, duplicate events, partial replacement, restart recovery, history, and LLM evidence handling. There are forty checks, plus live API and browser verification.

“Passing those checks does not make this production-ready or prove every model sentence correct. The main limits are authenticated roles, multi-server consistency, a connected external automation, and chat-driven writes. I kept those visible rather than presenting them as finished features.”

**Transition:** “With more time, I would extend the working paths in this order.”

## Slide 12 - Next steps and close (30 seconds)

**Show:** the closing slide.

**Say:**

“My next priority would be a confirmed task-creation tool for Dan, followed by connecting one real form automation and improving review and concurrency behavior.

“The main decision was to solve the shared integration once, then add the smallest useful workflow for each person. That gives the team a usable starting point and makes the next additions easier to explain and implement. I'm happy to dig into any API quirk or tradeoff.”

## If they want a five-minute version

Use slides 1-2 for the premise, show the dashboard, do one submission and approval, show Carlos's resulting activity, ask the LLM what's overdue, then close with the shared adapter and the deliberate gaps. Skip detailed code unless asked.

## Questions to prepare for

**Why no React or Express?** The local interface and route set were small enough for browser JavaScript and Node's native HTTP server. That reduced setup. Frameworks would become more useful as routing, validation, and UI state grew.

**Is this RAG?** It is grounded question-answering using the complete current JSON dataset. It does not implement a retrieval index, embeddings, or vector search. The small dataset made full context simpler.

**Can references guarantee correct answers?** No. They verify that the cited data exists, not that every sentence interprets it perfectly. The model is instructed to stay within the JSON, and the user can inspect its evidence.

**Why local files?** They hold workflow metadata the API lacks. This is a single-machine prototype. A real multi-user system would need transactional storage and better concurrency handling.

**What happens if the API resets?** The UI refreshes live data. Old receipts/history stay historical, stale IDs cannot approve missing tasks, and external form mappings need updating.

**Why not complete Dan's write example?** I prioritized the requested JSON-grounded Q&A path and kept writes in explicit existing controls. A confirmed creation tool is the first extension, with person/project/date ambiguity resolved before execution.

**Did you use AI?** Yes. AI-assisted coding and preparation were allowed. I used them while validating the real API behavior and making the scope and limitations explicit. Be ready to explain the actual code and every choice shown here.

**What would you change first?** Confirmed chat task creation, one real external form connection, and durable multi-user review/state handling.

## Accuracy guardrails for the presentation

Do not claim an active Zapier/n8n/Make integration, authenticated manager roles, complete historical auditing, automatic email delivery, or chat-based writes. Do not claim the handoff/deck/reset work happened inside the original build clock. Do not show the key or include `.env`/`.local` in shared source.
