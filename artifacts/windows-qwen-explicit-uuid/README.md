# Explicit UUID comparison

On 2026-11-06, both tasks failed again. Supplying an operation UUID in the prompt did not resolve the workflow failure. The model included the field but did not copy the supplied value correctly.

## Method

Compared against `../windows-qwen-verification` at application commit `fa7430d3b69b10db6cdc532708bc84bd15b36256`. Used the same two titles, system instructions, registered tools, proxy, backend and separate test-operator approval procedure. No application source changed.

The only model-facing change was appending this sentence to each user prompt, with a fresh valid UUID for each task:

> Use {UUID} as the operationId for this draft operation and reuse it on retries.

The baseline system instruction to generate a UUID remained unchanged to isolate this user-prompt intervention. That instruction may compete with the supplied-value instruction; this experiment does not test every possible prompt formulation.

Confirmed unchanged model digest, Ollama version, template and parameters. Model `qwen3:4b-instruct-2507-q4_K_M`, digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`, Ollama `0.40.14`, Node.js `v24.20.0`, Windows. Sampling remained at the installed defaults with no fixed seed. These are two observations, not a reliability estimate.

## Results

| Task                                    | Observed behavior                                                                                                                                                     | Outcome                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Qwen launch notes 2026-11-06    | Skipped discovery. Truncated the supplied UUID, then generated an invalid replacement and finally a valid replacement. Used `Marketing` as the project ID throughout. | Validation rejected the first two calls; the backend denied the third for the incorrect project ID. Failed after 4.25 seconds.              |
| Windows Qwen autumn campaign 2026-11-06 | Skipped discovery. Inserted an underscore into the supplied UUID and used `Marketing` as the project ID.                                                              | Validation rejected the call. The next inference request hit the proxy's 60-second timeout, returning HTTP 502. Failed after 60.64 seconds. |

Neither run requested approval, created a draft or retrieved one. Both ended with zero new drafts and zero approval events.

The first supplied UUID was `9cc9f215-4568-4ed0-8f88-2be0c26020a3`; the first raw creation call used `9cc9f215-45-4ed0-8f88-2be0c26020a3`. The second supplied UUID was `8158fc1f-f44c-4bdf-88e5-de9c82d36c1e`; its raw creation call used `8158fc1f-f4_4c-4bdf-88e5-de9c82d36c1e`.

## Interpretation

The baseline omitted `operationId`. This intervention made it appear in the calls, but did not establish correct copying or stable reuse. Raw Ollama responses already contain the incorrect values; Deedspan did not alter them. The model also failed to discover the actual project ID, `marketing`.

Record the timeout separately from those argument errors. The trace proves the configured deadline expired; it does not establish why inference stalled. The second task's eventual recovery remains unknown because the request timed out.

The evidence does not support adopting this prompt addition as a fix. A useful next investigation is to compare the other installed model with the original prompts and unchanged tool schemas, then decide whether the application should own operation IDs. Neither change was performed here.

Human browser approval remains untested. The separate test operator was never invoked. The experiment's HTTP servers were closed and its disposable SQLite database was deleted. The original evidence directory remains intact. Backend tests were not repeated because no application code changed.

## Evidence

- `environment.json` and `model-show.json` record the runtime, model identity, template and parameters.
- `results.json` records tool traces, failures, draft snapshots and audit records.
- `trace.jsonl` records raw model requests/responses, the timeout and application responses.
- `comparison.json` checks that requests contain the supplied IDs and compares raw creation arguments and model configuration.
- `run.mjs` is the baseline driver with only the prompt addition and supplied-ID recording. Preserve this directory before rerunning: results are overwritten and traces are appended.
