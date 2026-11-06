import type { RunReport, ToolTrace } from '../core/types.js';
import { CodeBlock, StatusBadge, elapsed } from './presentation.js';
import { exportJson } from './download.js';

function Trace({ trace, index }: { trace: ToolTrace; index: number }) {
  return (
    <details className="trace-step">
      <summary>
        <span className={`trace-number ${trace.status}`}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <strong>{trace.name}</strong>
        <span className="trace-duration">{elapsed(trace.durationMs)}</span>
        <StatusBadge status={trace.status} />
      </summary>
      <div className="trace-payload">
        <div>
          <h4>Arguments</h4>
          <CodeBlock value={trace.input} />
        </div>
        <div>
          <h4>Result</h4>
          <CodeBlock value={trace.output} />
        </div>
      </div>
    </details>
  );
}

export function RunReportView({
  run,
  previous,
}: {
  run: RunReport;
  previous: RunReport | undefined;
}) {
  return (
    <section className="panel report-panel" aria-labelledby="report-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Verified against application state</p>
          <h2 id="report-title">
            Run report <StatusBadge status={run.status} />
          </h2>
        </div>
        <button
          className="button-secondary"
          type="button"
          onClick={() => exportJson(run, `deedspan-${run.id}.json`)}
        >
          Export JSON <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="report-metadata">
        <span>{run.scenario.name}</span>
        <span>{run.mode === 'scripted' ? 'Scripted demo' : run.model}</span>
        <span>{elapsed(run.durationMs)}</span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
      </div>
      {run.regression && (
        <div className="regression-note">
          Regression enabled: draft creation was deliberately routed to the
          wrong project.
        </div>
      )}
      {previous && (
        <p className="comparison-note">
          Previous run of this scenario: <strong>{previous.status}</strong> →
          this run: <strong>{run.status}</strong>.{' '}
          {previous.mode !== run.mode || previous.model !== run.model
            ? 'Execution mode or model changed.'
            : 'Same execution mode and model.'}
        </p>
      )}
      {run.error && (
        <p className="error-message" role="alert">
          {run.error}
        </p>
      )}
      <div className="assertion-list">
        {run.assertions.map((assertion, index) => (
          <div
            className={`assertion ${assertion.passed ? 'passed' : 'failed'}`}
            key={`${assertion.name}-${index}`}
          >
            <span className="assertion-icon" aria-hidden="true">
              {assertion.passed ? '✓' : '×'}
            </span>
            <div>
              <strong>{assertion.name}</strong>
              <p>
                Expected <code>{assertion.expected}</code>
                <span aria-hidden="true"> · </span>Observed{' '}
                <code>{assertion.actual}</code>
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="section-divider">
        <h3>Execution trace</h3>
        <span>
          {run.traces.length} tool {run.traces.length === 1 ? 'call' : 'calls'}
        </span>
      </div>
      {run.traces.length ? (
        <div className="trace-list">
          {run.traces.map((trace, index) => (
            <Trace trace={trace} index={index} key={trace.id} />
          ))}
        </div>
      ) : (
        <p className="empty-inline">No tools were called in this run.</p>
      )}
      {run.agentMessage && (
        <div className="agent-message">
          <p className="eyebrow">
            {run.mode === 'scripted' ? 'Script response' : 'Agent response'}
          </p>
          <p>{run.agentMessage}</p>
          <small>
            The response is recorded for context. It does not determine whether
            the task passed.
          </small>
        </div>
      )}
      <details className="evidence-details">
        <summary>Inspect recorded evidence</summary>
        <h4>Prompt</h4>
        <p className="recorded-prompt">{run.scenario.prompt}</p>
        <h4>Fixture</h4>
        <code>{run.scenario.fixture}</code>
        <h4>Discovered tools</h4>
        <CodeBlock value={run.tools} />
        <div className="trace-payload">
          <div>
            <h4>Starting state</h4>
            <CodeBlock value={run.initialState} />
          </div>
          <div>
            <h4>Final state</h4>
            <CodeBlock value={run.finalState} />
          </div>
        </div>
      </details>
    </section>
  );
}
