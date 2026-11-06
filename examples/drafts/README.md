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

## Checks

```sh
npm test --prefix examples/drafts
npm run build --prefix examples/drafts
```

API tests use temporary databases and ephemeral ports. They cover direct access denial, cross-user resource isolation, origin and CSRF checks, exact-input approval, idempotent retries, audit correlation, and persistence through a second database connection. The package smoke test in the repository root installs the packed SDK into an external temporary consumer.
