# Developer preview

Deedspan `0.1.0-preview.1` is an installable local preview for developers who want agents to use existing application actions. It includes the core TypeScript SDK, optional React integration, experimental browser registration, declarations, and integration documentation. It is not published to npm.

## Try the public API

From the SDK source checkout:

```sh
npm ci
npm run preview:pack
```

The command prints an archive path under `artifacts/developer-preview/` and writes a manifest with its SHA-256, npm integrity value, source revision, and whether the source tree was dirty. Install that archive in your own application:

```sh
npm install /absolute/path/to/deedspan-0.1.0-preview.1.tgz zod@4.6.7
```

Follow the [integration guide](integration.md) to register tools, expose their schemas to a model, execute calls, and correlate traces with application operations. No model or provider client is bundled. Your application still owns authorization, approval, transactions, durable operation IDs and persistence.

To verify the exact generated archive from the source checkout, run `npm run test:consumer -- /absolute/path/to/deedspan-0.1.0-preview.1.tgz`. The [verification record](verification.md) describes the checks and observed model limitations.

## Reference applications

The source checkout includes two separate applications:

- `examples/drafts`: browser approval, exact-input creation and updates, idempotent retries, rejection, stale-version conflicts, persisted results and audit events.
- `examples/inventory`: a Node application with finite stock, atomic reservations, concurrent-writer checks, buyer/viewer permissions, durable replay and model-driven discovery/reservation/retrieval.

Both use the installed public SDK. The inventory application was built by an independent agent restricted to the public docs and packed declarations. That exercise revealed missing discovery/model-wiring documentation, which the integration guide now supplies. This is evidence of a reproducible consumer integration, not a claim of external human adoption.

From the source checkout:

```sh
npm run example:install
npm run example:install:inventory
npm run check
npm test --prefix examples/drafts
npm run build --prefix examples/drafts
npm run test:package
npm run test:consumer
npx playwright install chromium
npm run test:e2e
```

`test:package` installs the SDK outside the repository and checks its runtime, declarations, contents and optional React entry point. `test:consumer` copies the inventory application to a temporary directory outside the repository, installs the tarball rather than a symlink, and runs its build, tests and demo. These checks do not require Ollama. Linux and Windows CI are configured to run both; local results do not establish a remote CI run's status.

## Model checks

With Ollama running locally and the example dependencies installed:

```sh
npm run model:check:update -- --model panky-qwen3:4b
npm run model:check:update -- --model panky-qwen3:4b --scenario rejected
npm run model:check:update -- --model panky-qwen3:4b --scenario stale
```

These commands use disposable databases and automated test-operator decisions. Rejected/stale reports distinguish backend safety from model compliance. The model must stop after rejection; for stale records, it must observe the actual conflict before reporting it. An accurate-sounding answer without that call fails verification.

For inventory, set `MODEL_NAME` to an installed model and run `npm run model --prefix examples/inventory`. PowerShell example:

```powershell
$env:MODEL_NAME = 'panky-qwen3:4b'
npm run model --prefix examples/inventory
```

The inventory runner saves requests, responses, tool traces and the final database state. It requires real model-issued discovery, reservation and retrieval, plus termination within the run limits. A claimed success without the saved state cannot pass.

## Scope

The core registry is model-independent. A successful tool trace means the handler returned, not that every domain request succeeded. Domain results such as rejected approval or insufficient stock must be handled by the caller.

The reference applications use local demonstration authentication. Replace that with your application's identity service before deploying them. Native WebMCP is experimental and optional; unsupported browsers retain local registry use. Remote MCP, a hosted model gateway, production authentication, deployment, npm publication and external developer adoption are outside this local preview.

Preserve model identity, prompts and raw evidence when comparing model behavior. Repeated success in these constrained workflows does not imply general model reliability. Keep deterministic application and package tests as the regression gate; run live inference deliberately rather than making routine CI depend on an installed model.
