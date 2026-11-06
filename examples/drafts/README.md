# Independent drafts application

This application installs Deedspan as a package. `example:install` builds a tarball and installs it without changing the example manifest; rerun it after SDK changes. The manifest’s local dependency also supports linked development with `npm install --prefix examples/drafts`. Its authenticated API and SQLite database own the projects, permissions, approvals and drafts; browser tools call that API.

From the repository root:

```sh
npm run example:install
DRAFTS_PASSWORD='choose-a-local-password' npm run dev --prefix examples/drafts
```

In PowerShell, set `$env:DRAFTS_PASSWORD = 'choose-a-local-password'` first, then run `npm run dev --prefix examples/drafts`. See the [Windows guide](../../README.md#windows-and-powershell) for the model workflow.

Open http://127.0.0.1:3101 and sign in as `alice` (Marketing access) or `bob` (Engineering access), using the password you configured. The server requires at least 12 characters. Password hashes are seeded once, so changing the environment variable does not change existing accounts. To start over, stop the server and remove only this example's `.data/drafts.sqlite` database.

Request a draft, review its exact title and project, and approve it. The application retries the same operation after approval. The saved draft, completed event and SDK call metadata let you check the result independently. Sign out to try the other account. The API enforces access even if a caller bypasses the browser SDK.

`DRAFTS_PORT` changes the port; `DRAFTS_DB` changes the SQLite path. Sessions are in memory and expire after one hour; restarting requires signing in again, while drafts, approvals and audit records persist. This is a loopback development example, not a deployable authentication service. There is no account provisioning or login rate limiting.

## Agent tools

`search_projects`, `create_draft` and `get_draft` use the installed SDK. Native WebMCP registration is attempted when supported by the browser. Tool registration does not grant permissions: API requests require the application's session and write requests require its CSRF token and matching Origin.

Each draft request supplies a UUID `operationId`. Reusing that ID with the same user and input returns the same result. Different input is rejected. A pending operation must be approved through the application's approval UI before creation. Approval is bound to that user and exact stored input. There is no approval tool. This models explicit consent within the application; it does not prove that a human, rather than an agent with arbitrary browser access, clicked the button.

SDK trace IDs are sent as `X-Tool-Call-Id`. `/api/calls` records those IDs alongside operation IDs and HTTP outcomes. `/api/events` records confirmation, approval and completion, including the persisted draft ID. Events and calls are visible only to their owning user. SDK observers use metadata-only capture by default; the application does not persist draft titles or result payloads in its audit tables. Draft content remains in the application database.

The real-model harness runs from the repository root with `npm run example:agent`; see the root README for configuration. Model verification requires an available compatible model endpoint. Direct SDK calls and scripted tests alone do not establish model reliability.

For one-draft agent tasks, `registerDraftTaskTools(registry, request, { operationId, title })` binds an application-owned UUID and the validated task title. The model supplies only `projectId` to `create_draft`; it cannot override the title or operation ID. The caller must persist those values before the first request and reuse them when resuming the same task. The CLI does this with a saved task file and `--resume`. A new task gets a new UUID even when its title matches an earlier task. Backend approval and idempotency rules are the same for both registrations.

The task's `get_draft` tool takes an empty object and uses the ID from its completed creation response. It rejects calls before completion and rejects model-supplied IDs. A fresh registration after restart must replay `create_draft` to recover the saved ID from the existing operation before retrieving. This keeps task identity durable in the backend and saved task file rather than asking the model to copy opaque IDs. The browser's general-purpose `registerDraftTools` keeps its original explicit title and ID inputs.

The CLI requires successful Marketing discovery before any creation attempt, including after a resume. From the repository root, `npm run model:check -- --model panky-qwen3:4b` runs repeatable checks against an isolated backend with explicitly labeled automated approvals. See the root README for custom titles, local endpoint settings and evidence output.

## Updating an existing draft

After creating a draft, use **Update a draft** to find it by title. Select the record and request a new title. The approval shows the old title, new title, project, and version. Approve to apply and retrieve the saved change, or reject to leave the draft unchanged. Approved requests remain visible for retry if a write is interrupted.

`registerDraftUpdateTools` exposes `search_drafts`, `update_draft`, and `get_updated_draft` through the same SDK. Approval and rejection remain application controls, not tools. Updates use a separate persisted operation with an immutable draft ID, expected version, and title. Replays return the original outcome; changing input under the same operation ID fails. Rejection is final. If another update changes the record before approval or execution, the request ends in a conflict without overwriting that change. Existing databases acquire version 1 for existing drafts on startup.

`registerDraftUpdateTaskTools(registry, request, { operationId, title, query })` binds the search and replacement title for an agent task. The model discovers matching drafts, selects an ID, retries after approval, and retrieves with no arguments. The registration retains the first selected version across retries and verifies the saved title/version on retrieval. This update task adapter keeps its selection in memory; it does not provide the creation CLI's saved-task/resume interface. The general update API can replay a persisted exact request after restart.

From the repository root, run two isolated local-model trials:

```sh
npm run model:check:update -- --model panky-qwen3:4b
```

Each trial seeds an existing draft and an unrelated record, then checks discovery, approval before mutation, one version increment, and model-issued retrieval. The test operator approves automatically; this is not a human approval test. Optional positional arguments replace the two default new titles. `--ollama` accepts a loopback HTTP origin and `--output` selects an evidence directory. Reports retain model identity, raw responses, traces, approval, and final state under ignored `artifacts/model-checks/` by default. Rejection and conflict behavior are covered separately by API and browser tests.

For bounded negative model checks, add `--scenario rejected` or `--scenario stale`. Rejection tells the model the request was denied and requires it to stop without further tool calls, returning `{"status":"rejected"}`. Stale checks approve the request, apply a separately approved competing edit, and require the model to observe `conflict` by retrying the saved request once, then stop with `{"status":"conflict"}`. The report separates `backendSafety` from `modelBehavior`: a model can fail to follow the protocol while the application still prevents the blocked write. Both decisions are performed by an automated test operator. Omitting the flag retains the approved workflow.

## Checks

```sh
npm test --prefix examples/drafts
npm run build --prefix examples/drafts
```

API tests use temporary databases and ephemeral ports. They cover direct access denial, cross-user resource isolation, origin and CSRF checks, exact-input approval, idempotent retries, audit correlation, and persistence through a second database connection. The package smoke test in the repository root installs the packed SDK into an external temporary consumer.
