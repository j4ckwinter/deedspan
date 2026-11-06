# Live model comparison and browser approval

On 2026-11-06, `panky-qwen3:4b` passed both tasks with the isolated application-owned operation-ID prototype. Both tasks passed first with a separate test operator, then again with the user's browser approvals. The unchanged production tools still require model-generated UUIDs; this result does not mean the production workflow has been fixed.

## Comparison

| Model/configuration                                         | Passed tasks | Failure or result                                                                         |
| ----------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Stock Qwen, original tools                                  | 0/2          | Omitted operationId                                                                       |
| Stock Qwen, explicit UUID in prompt                         | 0/2          | Corrupted UUIDs, wrong project ID; second run later timed out                             |
| Panky Qwen, original tools                                  | 0/2          | Discovered Marketing but used title slugs as UUIDs, then stopped after promising to retry |
| Stock Qwen, application-owned IDs                           | 0/2          | Skipped discovery, used Marketing instead of marketing; first run also corrupted title    |
| Panky Qwen, application-owned IDs, test operator            | 2/2          | Discovery, approval gate, exactly one saved draft, model retrieval                        |
| Panky Qwen, application-owned IDs, user approval in browser | 2/2          | Same outcome, user confirmed both approvals                                               |

Each row uses the two original titles. These small samples establish observed outcomes, not general reliability rates. Separate directories preserve each experiment's prompts, tool schemas, raw model replies, traces and failures.

## Verified browser outcomes

| Title                                   | Operation ID                         | Saved draft ID                       |
| --------------------------------------- | ------------------------------------ | ------------------------------------ |
| Windows Qwen launch notes 2026-11-06    | 5ac7e937-843d-4a1c-8252-824e5adfb896 | 2a3e214f-9056-46fb-a432-88de6a6c4bb9 |
| Windows Qwen autumn campaign 2026-11-06 | 769363a3-635a-4505-ad21-be3d6ac7461d | eb0a2d9c-c071-4648-8b6d-648284f4f071 |

For each task, the model called search_projects, selected the discovered marketing ID, and requested the exact draft title. The backend returned confirmation_required with no saved draft. The runner checked the pending title/project and unchanged draft list, then waited for an approved audit event. The user signed in and approved both requests through the existing browser application, and confirmed this in chat.

The browser's approval handler also saved the draft. The runner then retried the same operation, receiving the same draft ID. Each operation has one approval event, one completion event and exactly one new saved draft, despite the browser save and runner retry. The model subsequently called get_draft with the saved ID. The runner checked the title/project/count and read the record through a separate SQLite connection. The final audit check compared the full retrieved draft with the saved API record.

The model initiates a request that requires approval. The runner and application manage the approval pause and retry. As in the original CLI, the model does not receive the intermediate confirmation_required response, so these runs do not prove that the model itself asks a conversational approval question or independently resumes after approval.

## What changed in the prototype

Only files under artifacts were added. The experimental tool registration omits operationId from the model-facing create_draft schema and generates a UUID within a task-scoped map keyed by project ID and title. Repeated identical calls in that task reuse the UUID. The request still reaches the unchanged backend with its required UUID; authorization, exact-input approval and persistence validation remain intact. Instructions say that the application manages IDs.

This design is deliberately limited to one verification task at a time. A production implementation must define durable task/operation identity, preserve retries across restarts, and distinguish a deliberate second same-title draft from retrying the first. A task-local map alone does not solve those requirements. The browser's production registration and the existing CLI have not been changed.

## Model and environment

- Windows, Node.js v24.20.0, Ollama 0.40.14.
- Successful model: panky-qwen3:4b, 4.0B, Q4_K_M.
- Digest: 3547714a163b3e5d027e072e8b73d5baf4c5d08b33c3be0dc544e1e89f047ab4.
- Parent model: qwen3:4b-instruct-2507-q4_K_M, digest 0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0.
- Application commit: fa7430d3b69b10db6cdc532708bc84bd15b36256.
- Sampling settings were not overridden. Installed defaults are temperature 0.7, top_k 20, top_p 0.8 and repeat_penalty 1.

Panky is a custom configuration of the same base model, not an independent model family. Its template uses JSON serialization for functions and arguments and asks for one function call at a time. The installed metadata also reports different runner labels. The experiment does not isolate which configuration difference accounts for better behavior; it must not be attributed solely to model weights or solely to the template.

## Evidence and cleanup

This directory contains environment.json, results.json, trace.jsonl, audit-check.json, run.mjs and tools.mjs. The adjacent windows-panky-comparison directory contains the custom model's full template and metadata. windows-qwen-owned-id and windows-panky-owned-id contain the prototype comparison and test-operator results. Earlier baseline evidence remains unchanged.

The temporary browser server and model proxy were closed after both tasks finished. The disposable SQLite database was removed after saving evidence. The existing Ollama service was left running. The backend tests from the baseline remain 33 root tests and 3 example tests passed; they were not rerun because application source did not change.

The next implementation should introduce application-owned operation identity with an explicit lifecycle, retain the backend's approval and idempotency checks, and repeat these live checks through the production CLI. Stock Qwen still has a separate project-discovery/copying limitation in this configuration.

## Independent review

A fresh-context, read-only reviewer verified the prototype evidence and returned: prototype outcome verified, with a material qualification about model approval behavior. The qualification and browser-save attribution are documented above. The reviewer also confirmed that recorded Panky traces show discovery before creation, although the driver's assertion only checks that discovery occurred somewhere. The model used the Node tool registry and HTTP backend adapter, not browser WebMCP transport. The task-scoped ID map is suitable for these distinct-title experiments but is not a durable production identity design. No production defect was established by this review.
