# Short Stack

A TypeScript SDK for exposing application actions to agents, with validation, application-owned access checks, and execution traces. The repository includes a local workbench and a separate persistent draft application.

The first workflow is a React draft application: find a project, create a draft, and retrieve it. The workbench records tool calls and checks the saved application state independently of the agent's answer. A built-in regression deliberately saves drafts in the wrong project, so you can see a successful tool call fail an outcome assertion.

## Run locally

Use Node.js 24 or newer and npm.

```sh
nvm use
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Select the launch-notes scenario and run it in **scripted demo** mode. Enable the wrong-project regression and rerun to see the project assertion fail. Each scenario run resets the disposable demo drafts. Scenarios and the latest 20 reports are saved in this browser's local storage; demo drafts themselves live only in memory.

Scripted mode is a deterministic demonstration, not model inference. It accepts `Create [title] in the [Marketing or Engineering] project.` and follows the tools without consulting the expected assertions. Use it to explore tracing and regression checks without credentials or downloads.

## Use a real model

The server supports an OpenAI-compatible chat-completions endpoint with function calling. Its default endpoint is a local Ollama server. Install Ollama separately, then run a tool-capable model, for example:

```sh
ollama pull qwen3:8b
ollama serve
```

If Ollama is already running, only the pull command is needed. Copy `.env.example` to `.env` and set `MODEL_NAME` to the installed model. Restart `npm run dev`, then choose model mode in the workbench.

For another compatible provider, configure `MODEL_BASE_URL` (including `/v1` where required), `MODEL_NAME`, and optionally `MODEL_API_KEY`. Credentials stay on the Node server. Model mode sends the scenario prompt, tool descriptions, arguments, and results to that provider. It never receives the expected outcome assertions. Compatibility and task reliability depend on the selected model; no model weights are bundled.

The server binds to loopback and rejects cross-origin API requests. This release is a local development tool; it has no multi-user authentication or production authorization service.

## Register application tools

The SDK has compiled JavaScript and TypeScript declarations, with core (`short-stack`) and React (`short-stack/react`) entry points. It is not published to npm. Build a tarball locally and install the resulting file in another application:

```sh
npm pack --pack-destination /tmp
# In your application:
npm install /tmp/short-stack-0.0.0.tgz
```

`npm run test:package` verifies an actual tarball installation outside this repository, including runtime behavior and TypeScript declarations. The core package does not require React.

```ts
import { z } from 'zod';
import { ToolRegistry, connectWebMCP } from 'short-stack';

const tools = new ToolRegistry();
const unregister = tools.register({
  name: 'search_products',
  description: 'Search products by name',
  input: z.object({ query: z.string().min(1) }).strict(),
  execute: ({ query }) => searchProducts(query),
  authorize: () => currentUser.canSearch,
});

const trace = await tools.call('search_products', { query: 'notebook' });
const connection = await connectWebMCP(tools);

// On application teardown:
connection.dispose();
unregister();
```

`searchProducts` and `currentUser` represent your application's existing function and access check. Execute the same checks in the backend that owns protected data; browser callbacks do not replace server authorization.

The registry validates inputs with Zod, generates JSON Schemas, checks authorization per call, and captures JSON snapshots of inputs and results. Tool arguments and results must be JSON serializable. React integrations can use `useRegisteredTool` from `short-stack/react`.

Tool handlers and authorization callbacks receive `(input, context)`. `context.callId` matches the returned trace ID; pass it to your backend to correlate an attempt with its operation and saved result. It is diagnostic metadata, not an identity, permission, or idempotency key.

```ts
const tools = new ToolRegistry({
  onTrace: (trace) => recordTelemetry(trace),
  capture: 'metadata',
});
```

`recordTelemetry` is your telemetry sink. Observer payloads omit inputs and outputs by default (`null`); use `capture: 'full'` only when those values are appropriate to record. `call()` still returns the full result so an agent can continue its task. Observer failures do not change execution success or trigger retries. The SDK does not persist or transmit telemetry itself. The local workbench deliberately retains full traces for debugging.

`connectWebMCP` registers the tools with `document.modelContext` when the experimental browser API is available, with a legacy navigator fallback. Unsupported browsers keep the local registry usable and show that native WebMCP is unavailable. The adapter removes only its own registrations. `createNativeToolClient(context, origin)` can inspect and call existing same-origin native tools; the bundled workbench uses its own registry directly.

WebMCP is experimental. Browser/API compatibility must be checked against the browser you intend to support. Remote MCP, arbitrary-site connections, and production analytics are outside this first release.

## Persistent application integration

The [separate drafts application](examples/drafts/README.md) owns authentication, project permissions, approvals and SQLite persistence. Its browser tools use the installed SDK to call its existing backend.

```sh
npm run example:install
DRAFTS_PASSWORD='choose-a-local-password' npm run dev --prefix examples/drafts
```

Open <http://127.0.0.1:3101>. Sign in as `alice` with that password, request a draft, and approve its exact title and project. Sign in as `bob` to verify that Marketing drafts are inaccessible. The example preserves drafts across server restarts; it is a local reference integration, not production authentication infrastructure.

`example:install` installs an actual SDK tarball. Rerun it after SDK changes. To check the example, run `npm test --prefix examples/drafts` and `npm run build --prefix examples/drafts`. Root browser tests exercise both applications and require the example dependencies to be installed first.

### Exercise a real model

Keep the example server running. In another terminal, start the workbench with `npm run dev`, configured with the model endpoint described above. Then, from the repository root:

```sh
DRAFTS_PASSWORD='choose-a-local-password' npm run example:agent -- 'Agent integration draft'
```

The harness signs in as Alice, uses the same tool registrations as the browser, and asks the configured model to find Marketing, create a draft and retrieve it. When prompted, refresh the example browser, approve the displayed operation, and press Enter in the terminal. Approval is never exposed as an agent tool. The harness checks the persisted draft independently, requires a successful retrieval call, and exits unsuccessfully if the model's claims do not match the database-backed API.

Use an otherwise idle local example during this check. The run creates persistent data and sends tool inputs and outputs to the configured model provider. `DRAFTS_ORIGIN` and `WORKBENCH_ORIGIN` override the local application URLs. No model is bundled; live inference and external developer adoption remain validation steps requiring an available model and another developer.

## Scenarios and reports

A scenario contains a natural-language task and independent expectations for draft title, project, and count. The fixture is `launch-notes-v1`: Marketing and Engineering projects with no drafts. Reports include the prompt, model or scripted identity, tool schemas, initial/final snapshots, calls, errors, timings, and assertions.

Save a scenario in the workbench and export its JSON to rerun it from the command line:

```sh
npm run scenario:run -- path/to/scenario.json
npm run scenario:run -- --regression
npm run scenario:run -- --output
```

The CLI runs scripted mode and exits nonzero on a failed assertion or execution error. Omit the path to use the bundled launch-notes scenario. `--output` also writes `scenario-report.json`. A report export contains the full evidence; its nested `scenario` is the scenario input format.

The runner limits turns and tool calls, prevents concurrent scenarios on the same demo, and stops new calls after cancellation. An already-started application mutation cannot be undone by cancelling. Repeated runs start fresh; they do not replay production writes. Use repeated model runs to assess reliability rather than treating one successful run as a success rate.

## Development checks

Run `npm run example:install` after `npm ci` before checking the whole repository; the integration harness uses the example’s installed SDK.

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run check`        | ESLint, Prettier, strict TypeScript, and unit/integration tests. |
| `npm run format`       | Format source and configuration.                                 |
| `npm run lint:fix`     | Apply available ESLint fixes.                                    |
| `npm run build`        | Build the SDK, type-check, and build the React workbench.        |
| `npm run test:package` | Install and verify the packed SDK outside the repository.        |
| `npm start`            | Serve the built application and model proxy locally.             |
| `npm run test:e2e`     | Run browser workflow tests.                                      |

Install the test browser once with `npx playwright install chromium`. Browser tests start isolated servers on ports 3100 and 3102. The persistent example uses an in-memory test database. They exercise scenario creation, reset/rerun, regression detection, persistence, and the model flow using a controlled response fixture. A separate browser test enables experimental WebMCP and verifies native tool discovery and execution against the application. Unit tests cover validation, authorization, native adapter lifecycle, cancellation, run limits, and model-proxy boundaries. Controlled model responses test plumbing; they do not establish real model reliability.

GitHub Actions runs checks, builds, and browser tests. Make focused Conventional Commits at working milestones after the relevant checks pass.

`PRODUCT_DIRECTION.md` remains ignored. The minimatch override pins affected transitive versions to 11.0.5 for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Remove it once upstream dependencies select patched versions themselves.
