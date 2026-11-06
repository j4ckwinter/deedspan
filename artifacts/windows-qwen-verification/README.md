# Windows backend and live Qwen verification

Verified on 2026-11-06 against commit `fa7430d3b69b10db6cdc532708bc84bd15b36256`. No application source changes were made.

Backend checks pass after example dependency setup. The two live-model tasks fail before approval. Neither task creates a draft.

## Environment

- Windows, Node.js `v24.20.0`, Ollama `0.40.14`.
- Tested model: `qwen3:4b-instruct-2507-q4_K_M`, 4.0B parameters, Q4_K_M quantization.
- Full model digest: `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
- Local endpoint: `http://127.0.0.1:11434/v1`.
- Model defaults: temperature 0.7, top_k 20, top_p 0.8, repeat_penalty 1. No sampling overrides or seed were supplied.
- `panky-qwen3:4b` is also installed but was not tested. See `models.json` for its identity.
- `model-show.json` records the installed template, parameters, and model metadata. `ollama-version.json` records the server version.

## Backend results

| Check                                             | Result                     |
| ------------------------------------------------- | -------------------------- |
| `npm test`, before example setup                  | 33 passed, 0 failed        |
| `npm test --prefix examples/drafts`, before setup | 2 passed, 1 failed to load |
| `npm run example:install`                         | Completed successfully     |
| `npm test --prefix examples/drafts`, after setup  | 3 passed, 0 failed         |
| `npm test`, after setup                           | 33 passed, 0 failed        |

The initial example failure was `ERR_MODULE_NOT_FOUND` for `deedspan` in `tests/tools.test.ts`. The example's `node_modules` directory was absent. The documented installer built and installed the SDK tarball, resolving the failure. This was an environment prerequisite, not a model failure. Setup also printed an npm warning about an unapproved esbuild install script; the backend checks subsequently passed. Frontend builds were not part of this verification.

The passing tests cover backend approval, idempotent retries, audit correlation, persistence, access denial and the controlled-response model integration. They do not prove live-model reliability.

## Live runs

The one-off `run.mjs` uses the application's `executeTask`, `registerDraftTools`, installed SDK, real model proxy and real SQLite backend on isolated ephemeral loopback ports. It uses the prompt and instructions from `scripts/run-drafts-agent.ts`. It captures raw Ollama requests and responses in `trace.jsonl` and outcomes in `results.json`.

Approval is assigned to a separate authenticated test operator through the backend API, with the same approval-then-retry sequence as the existing CLI. The operator checks the exact title/project and absence of a new draft before approval. No approval tool is exposed to Qwen. Neither run reached this operator step. Human browser approval was not exercised.

| Title                                   | Marketing discovery                       | Approval requested | New drafts | Successful retrieval | Result               |
| --------------------------------------- | ----------------------------------------- | ------------------ | ---------- | -------------------- | -------------------- |
| Windows Qwen launch notes 2026-11-06    | Yes, after correcting an invalid argument | No                 | 0          | No                   | Failed, 8.14 seconds |
| Windows Qwen autumn campaign 2026-11-06 | Yes                                       | No                 | 0          | No                   | Failed, 2.63 seconds |

Both runs made two `create_draft` calls without `operationId`. SDK validation rejected all four calls before a draft request reached the backend. The first run initially passed an unsupported `projectId` argument to `search_projects`, then recovered. The second run attempted `get_draft` with `id: "marketing"`, which returned HTTP 404. Both final model messages acknowledged failure but incorrectly suggested the application might be responsible for the missing ID.

## Failure classification

`boundary-check.json` confirms that all 10 Ollama responses were HTTP 200 and every outbound request included `operationId` in the required creation schema. All four raw Ollama creation calls omitted that field. The proxy did not strip it. The system instructions and tool description also explicitly told the model to generate and reuse a UUID.

This evidence places the observed failure at the model/provider output boundary, rather than in Deedspan transport or persistence. It demonstrates a limitation of this installed model/provider configuration on these two prompts. It does not isolate model weights from Ollama's template or inference implementation, or establish a general failure rate. No alternate model, template, or prompt was tested.

The live acceptance check remains failed. Approval, exactly-one creation and successful retrieval were not reached, so those live-model claims remain unverified. The backend rejected invalid calls and persisted no drafts. Application servers started for the experiment were stopped; the existing Ollama service was left running. The disposable database was removed after retaining the API state and audit evidence.

## Evidence files

- `results.json`: per-run model messages, tool traces, draft snapshots, approvals, calls and events.
- `trace.jsonl`: raw model requests/responses and application responses with timestamps and call IDs.
- `boundary-check.json`: required-field and raw-response comparison.
- `models.json`, `model-show.json`, `ollama-version.json`: installed model and runtime identity.
- `backend-*.log`, `setup.log`: local command output. These logs are ignored by the repository's existing `*.log` rule.
- `run.mjs`: experiment driver. Rerunning replaces `results.json` and appends to `trace.jsonl`; copy the evidence directory before rerunning to preserve this baseline.
