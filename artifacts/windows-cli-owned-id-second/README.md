# Production CLI operation-ID verification

Verified on 2026-11-06 after the experiment checkpoint commit `7d6d489`. The implementation moves operation-ID ownership into the CLI and persists each task before inference. `--resume` reloads the same ID; a new invocation gets a fresh ID even for the same title. The existing SQLite backend and approval UI are unchanged.

## Automated evidence

The integration test uses a real SQLite file and HTTP backend with controlled model responses. It proves the following sequence:

1. Start task A, persist its file before inference, reach pending approval, exit from a noninteractive terminal with no draft saved.
2. Approve A, close and reopen the backend on the same origin/database, resume A and retrieve one saved draft.
3. Resume A again without duplication.
4. Start and complete task B with the same title and a distinct task ID; two drafts now exist.
5. Resume A after B, still with two drafts and the original A manifest unchanged.

Invalid task files, mismatched origins, and a title supplied together with --resume fail before inference. Tool tests verify that the model cannot override the bound ID and that changed input encounters the backend's conflict check.

Independent review caught an implementation bug where resuming A after B counted B against A's old snapshot. The fix identifies A's completed result by its operation ID, independently checks its saved draft, and requires retrieval. The new A-after-B regression passes. The reviewer approved the corrected diff with no remaining actionable findings.

## Live-model evidence, including failures

All live trials used the actual CLI in separate subprocesses. A separate authenticated test operator supplied approval; these new trials did not ask the user to approve again. The preceding human-approval experiment remains evidence for the unchanged browser flow.

| Evidence directory | Task | Observation |
| --- | --- | --- |
| windows-cli-owned-id | Windows CLI launch notes 2026-11-06 | CLI pause, approval, process resume, creation and retrieval passed. Model skipped project discovery. This was an intermediate tool-order revision. |
| windows-cli-owned-id | Windows CLI autumn campaign 2026-11-06 | Pending request used marketing; after approval the new process's model used Marketing and failed. No second draft. |
| windows-cli-owned-id-final | Windows Qwen launch notes 2026-11-06 | After restoring original tool order and prototype wording, model changed title to Windows Qwen launch notes 2026-_11_06. Exact-title check stopped before approval. |
| windows-cli-owned-id-second | Windows Qwen autumn campaign 2026-11-06 | Final CLI passed: discovery, pending approval with no draft, new process resume using the same operation ID, exactly one persisted draft, model retrieval. |

The final successful operation ID is `efe4140f-0499-41b4-ac78-aa23bfa24360`; draft ID is `960d4123-c650-432b-b772-9bac48aaa623`. Independent SQLite read matched the API draft. Raw model calls and task manifests are retained with results, including failed attempts. These observations do not establish reliable completion of arbitrary prompts.

Model: `panky-qwen3:4b`, digest `3547714a163b3e5d027e072e8b73d5baf4c5d08b33c3be0dc544e1e89f047ab4`, Ollama `0.40.14`, Node `v24.20.0`, Windows. Installed parameters were used without overrides. Runtime metadata is in environment.json; the installed template is retained in the earlier windows-panky-comparison archive. Metadata for failed directories was copied from the successful trial in the same session after those runners exited early.

The generated task files contain only disposable test state. Each experiment closed its HTTP servers and removed its temporary database. Retained task files point to now-stopped ephemeral origins and are evidence, not resumable live tasks.
