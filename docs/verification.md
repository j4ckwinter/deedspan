# Preview verification evidence

This records local Windows verification on 2026-11-06 for the `0.1.0-preview.1` developer preview. The archive manifest identifies the final source commit and package hash. These are local results, not a claim that hosted CI ran or that a third-party human adopted the SDK.

## Success criteria

| Requirement                                               | Evidence                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and use the public package outside its repository | `npm run test:package` verifies runtime, declarations, package contents and optional React. `npm run test:consumer` copies the separate inventory app outside the checkout, installs a real tarball, rejects a symlink install, and runs build/tests/demo. |
| Discover and execute a useful action with a real agent    | Both installed Qwen configurations discovered inventory tools, searched for a product, reserved two notebooks and retrieved the saved reservation. Raw model calls, SDK traces and database state agreed.                                                  |
| Application remains authoritative                         | Draft tests cover exact approvals, rejection, stale versions, retries and access checks. Inventory tests bypass the SDK to check authority, race two processes against finite stock, and replay durable operations without decrementing twice.             |
| Failures are understandable                               | SDK validation errors are distinct from application audit outcomes, connected by attempt and operation IDs. Negative-model reports separate backend safety from model compliance.                                                                          |
| Integration is reproducible and documented                | An independent agent used public docs and packed declarations to build inventory. Missing discovery/model-mapping documentation was added to the public guide. CI includes the external-consumer check.                                                    |

## Deterministic checks

The root lint, formatting, type check and 41 tests passed. The draft example's 12 tests and build passed. The inventory consumer's eight tests, build and deterministic demo passed in a temporary directory outside the SDK repository. The root production build, package smoke test and all five browser tests passed, including native WebMCP discovery/execution. Final archive installation is checked with `npm run test:consumer -- <archive.tgz>` after packaging.

Inventory tests include actual competing child processes and actual model-runner subprocesses against a controlled local provider. They verify rejection of redirects and unsafe endpoint components, failure on turn exhaustion even after a write, and retention of final state on failure. They do not use fake SDK implementations.

## Live negative checks

Ollama version: `0.40.14`.

| Configuration                   | Digest                                                             | Rejected approval                   | Stale record                                              |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------- |
| `panky-qwen3:4b`                | `3547714a163b3e5d027e072e8b73d5baf4c5d08b33c3be0dc544e1e89f047ab4` | 2/2 model and backend checks passed | 2/2 model and backend checks passed                       |
| `qwen3:4b-instruct-2507-q4_K_M` | `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0` | 2/2 model and backend checks passed | 0/2 model checks passed; 2/2 backend safety checks passed |

Stock Qwen's stale trials returned the requested conflict status without making the required backend retry. The verifier rejected that unsupported conclusion. Only the separately approved competing edit persisted; the blocked task did not complete. The model's omission is preserved as a limitation rather than hidden by a weaker assertion or an automatic retry.

Decisions were automated test-operator actions, not human approvals. The raw local reports are under `artifacts/model-checks/update-eMVePn`, `update-FmEHyI`, `update-4JF78r`, and `update-CSEzpB` respectively.

## Live inventory integration

Both installed configurations completed one bounded inventory task using the installed preview SDK: search, reserve exactly two, retrieve, then terminate. Each recovered from an invalid operation-ID argument before reserving under the original task ID. One reservation persisted, notebook stock changed from five to three, pencil stock stayed at twenty, and the write audit matched the successful SDK trace.

An initial custom-model trial failed because the tool description did not state that search was literal substring matching. The plural query `recycled notebooks` returned no result for `Recycled notebook`; the model accurately stopped. Clarifying the existing search semantics with a short-keyword example resolved this in the subsequent checks. No search logic or verification gate was weakened.

Local evidence is in `artifacts/model-checks/inventory-preview`: `0f47fdc9-d9a3-497e-b3e3-8cf9d922b5bf` is the retained failure; `1d0f8e66-1304-4798-943e-665bfa66178b` and `d53cddb8-e8c5-444c-ae37-99baacadc240` are the successful custom and stock runs. `ollama-metadata.json` records installed model identity. The raw files remain local and ignored by Git; the commands and application sources reproduce the checks.

## Limits

These bounded trials establish observable integration behavior, not a universal success rate. Model responses can still require correction. The consumer exercise used an independent agent rather than an external human developer. Application authentication remains a local example. The preview is prepared locally without npm publication, deployment or a push to the remote repository.
