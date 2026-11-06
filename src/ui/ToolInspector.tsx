import { useState, type FormEvent } from 'react';
import type { ToolDescriptor, ToolTrace } from '../core/types.js';
import type { WorkbenchProps } from './contracts.js';
import { CodeBlock, StatusBadge, elapsed } from './presentation.js';

export function ToolInspector({
  tool,
  disabled,
  onCall,
}: {
  tool: ToolDescriptor;
  disabled: boolean;
  onCall: WorkbenchProps['onManualCall'];
}) {
  const [input, setInput] = useState('{}');
  const [result, setResult] = useState<ToolTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function call(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    let args: unknown;
    try {
      args = JSON.parse(input);
    } catch {
      setError('Enter valid JSON arguments before running the tool.');
      return;
    }
    setBusy(true);
    try {
      setResult(await onCall(tool.name, args));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Tool execution failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="tool-card">
      <summary>
        <span className="tool-symbol" aria-hidden="true">
          ƒ
        </span>
        <span>
          <strong>{tool.name}</strong>
          <small>{tool.description}</small>
        </span>
        <span className="disclosure-arrow" aria-hidden="true">
          ↗
        </span>
      </summary>
      <div className="tool-body">
        <h4>Input schema</h4>
        <CodeBlock value={tool.inputSchema} />
        <form
          onSubmit={(event) => {
            void call(event);
          }}
        >
          <label>
            Arguments for {tool.name}
            <textarea
              className="code-input"
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={disabled || busy}
              spellCheck={false}
            />
          </label>
          <button
            className="button-secondary"
            type="submit"
            disabled={disabled || busy}
          >
            {busy ? 'Calling…' : `Call ${tool.name}`}
          </button>
        </form>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="manual-result" role="status">
            <div className="inline-heading">
              <StatusBadge status={result.status} />
              <span>{elapsed(result.durationMs)}</span>
            </div>
            <CodeBlock value={result.output} />
          </div>
        )}
      </div>
    </details>
  );
}
