# Archived verification evidence

These files capture local Windows/Ollama experiments from 2026-11-06. Start with [the final comparison and human approval results](windows-panky-human-approval/README.md).

Scripts are historical snapshots, not supported application entry points. Results and raw provider traces are retained together to distinguish model behavior from integration failures. Formatting and linting exclude this directory to preserve the recorded snapshots. New experiments should use new directories rather than overwrite these results.

The successful prototype used `panky-qwen3:4b` with application-owned operation IDs. Original production tools were unchanged at that checkpoint. The browser approval tests used disposable local accounts and databases; no live account credentials or sessions are recorded. Command logs remain local under the repository's existing `*.log` ignore rule.
