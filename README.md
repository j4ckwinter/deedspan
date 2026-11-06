# Short Stack

A local workbench for exposing application actions to agents and checking that they complete tasks correctly.

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

The source SDK is exported from `src/sdk/index.ts`; it is not published to npm yet.

```ts
import { z } from 'zod';
import { ToolRegistry, connectWebMCP } from './src/sdk/index.js';

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

The registry validates inputs with Zod, generates JSON Schemas, checks authorization per call, and captures JSON snapshots of inputs and results. Tool arguments and results must be JSON serializable. React integrations can use `useRegisteredTool` from `src/sdk/react.ts`.

`connectWebMCP` registers the tools with `document.modelContext` when the experimental browser API is available, with a legacy navigator fallback. Unsupported browsers keep the local registry usable and show that native WebMCP is unavailable. The adapter removes only its own registrations. `createNativeToolClient(context, origin)` can inspect and call existing same-origin native tools; the bundled workbench uses its own registry directly.

WebMCP is experimental. Browser/API compatibility must be checked against the browser you intend to support. Remote MCP, arbitrary-site connections, and production analytics are outside this first release.

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

| Command            | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `npm run check`    | ESLint, Prettier, strict TypeScript, and unit/integration tests. |
| `npm run format`   | Format source and configuration.                                 |
| `npm run lint:fix` | Apply available ESLint fixes.                                    |
| `npm run build`    | Type-check and build the React application.                      |
| `npm start`        | Serve the built application and model proxy locally.             |
| `npm run test:e2e` | Run browser workflow tests.                                      |

Install the test browser once with `npx playwright install chromium`. Browser tests start an isolated server on port 3100. They exercise scenario creation, reset/rerun, regression detection, persistence, and the model flow using a controlled response fixture. A separate browser test enables experimental WebMCP and verifies native tool discovery and execution against the application. Unit tests cover validation, authorization, native adapter lifecycle, cancellation, run limits, and model-proxy boundaries. Controlled model responses test plumbing; they do not establish real model reliability.

GitHub Actions runs checks, builds, and browser tests. Make focused Conventional Commits at working milestones after the relevant checks pass.

`PRODUCT_DIRECTION.md` remains ignored. The minimatch override pins affected transitive versions to 11.0.5 for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Remove it once upstream dependencies select patched versions themselves.
