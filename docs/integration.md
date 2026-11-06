# Integrate application actions

Deedspan describes, validates, authorizes and executes tools. Your application owns users, permissions, transactions, approval decisions and saved data. Your agent runtime owns model requests and decides when to call a tool.

## Install a preview tarball

Build the archive in the SDK checkout with `npm pack`. In your application's directory, install that archive and Zod:

```sh
npm install /absolute/path/to/deedspan-0.1.0-preview.1.tgz zod
```

Use Node.js 24 or newer for the examples. Core tools do not require React. `deedspan/react` is an optional entry point for React 19 integrations. The package is ESM; use `import` from a module or TypeScript project configured for ESM.

## Register and discover

```ts
import { ToolRegistry } from 'deedspan';
import { z } from 'zod';

const tools = new ToolRegistry();
tools.register({
  name: 'search_products',
  description: 'Find products by name. Arguments: {"query":"notebook"}.',
  input: z.object({ query: z.string().min(1) }).strict(),
  authorize: () => session.canReadInventory,
  execute: ({ query }, { callId }) => inventory.search(session, query, callId),
});

const descriptors = tools.list();
const trace = await tools.call('search_products', { query: 'notebook' });
```

`session` and `inventory` represent your application. Do not accept a user identity or permissions from model arguments. Check access again at the backend or domain boundary that owns the data, including on retries. A browser-side callback cannot protect an API on its own.

Tool inputs must be object schemas. Add `.strict()` to reject unknown properties; Zod's default object behavior otherwise strips them. Use an empty strict object for a tool with no arguments, and state `Call with exactly {}` in its description. Descriptions and examples help models, but validation remains authoritative.

Handlers may be asynchronous. Inputs and results must be JSON serializable: avoid functions, bigint, circular references, non-finite numbers and class instances with hidden state. Parse remote responses at the application boundary before relying on their fields.

## Connect a model

The SDK does not choose a model or send model requests. For an OpenAI-compatible function-calling API, map descriptors into its tool format:

```ts
const modelTools = tools.list().map(({ name, description, inputSchema }) => ({
  type: 'function' as const,
  function: { name, description, parameters: inputSchema },
}));
```

When the model returns a function call, parse its JSON arguments as `unknown`, call `tools.call(name, input)`, and append the returned `trace.output` to the conversation as a tool result associated with the model's tool-call ID. That provider ID differs from Deedspan's execution trace ID. Preserve the assistant's tool-call message before appending tool results. Continue until the model stops or your configured limits are reached.

Treat `trace.status === 'error'` as a failed tool call. Validation, authorization and handler exceptions are returned as error traces rather than thrown by `call()`. A successful trace means the handler returned successfully; its result may still be a domain outcome such as `rejected`, `conflict` or `confirmation_required`. Check that result before claiming the requested action happened.

Set turn, call and network timeout limits in the agent runtime. Do not silently execute a mutation or retrieve a result to compensate for a missing model call when measuring agent behavior. Verify the outcome against saved application state, rather than the model's final prose.

## Preserve application authority

For a write that needs approval, store the exact request as a pending application operation and expose approval through a separate user control. After approval, notify the agent or resume its task; returning the old pending result alone does not tell it approval occurred. Rejected and stale requests must remain harmless even if the model ignores instructions and retries them.

Use an application-owned operation ID for idempotency. Persist it with the intended inputs before a retryable write, and reject reuse with different inputs. Apply competing writes through a database transaction and domain constraints. Deedspan's `context.callId` identifies one attempt; it is not an idempotency key, credential or proof of consent.

For a narrowly defined task, the application can bind values the model need not invent, such as an exact title or operation ID. Keep discovery and selection meaningful, and validate retrieved saved state independently. If task state lives only in memory, document that restarting the process does not restore it automatically.

## Explain failures with traces

Pass `context.callId` to the application and record it alongside its operation ID and saved outcome. `tools.call()` returns input/output snapshots for the caller. An `onTrace` observer receives metadata-only payloads by default; `capture: 'full'` opts into recording arguments and outputs. Consider whether those values contain private information before saving them.

Observer errors do not turn completed writes into failures. The SDK does not persist telemetry or retry actions automatically. Keep domain audit records and SDK attempt traces separate but correlated so you can tell a rejected argument from a denied action, an exhausted stock level, or a completed write whose response was lost.

## Optional browser registration

`connectWebMCP(tools)` registers tools when the browser exposes a supported experimental model-context API. Check its returned status and dispose the connection on teardown. An unsupported browser leaves the local registry usable. Native browser registration is separate from supplying descriptors to your own server-side model runtime.

`useRegisteredTool` from `deedspan/react` registers for a component's lifetime. Keep the registry and tool definition identities stable when appropriate; the hook unregisters and registers when those dependencies change. Neither browser registration nor React integration grants application permissions.
