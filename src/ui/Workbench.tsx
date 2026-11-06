import { useState } from 'react';
import type { FormEvent } from 'react';
import { scenarioInputSchema } from '../core/types.js';
import type {
  RunMode,
  RunReport,
  Scenario,
  ScenarioInput,
  ToolDescriptor,
  ToolTrace,
} from '../core/types.js';
import type { WorkbenchProps } from './contracts.js';
import './styles.css';

function StackMark() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
    >
      <path d="m4 8 10-5 10 5-10 5L4 8Z" fill="currentColor" />
      <path
        d="m4 14 10 5 10-5M4 20l10 5 10-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="code-block">
      <code>{JSON.stringify(value, null, 2) ?? 'No value returned'}</code>
    </pre>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      {status === 'success'
        ? 'Completed'
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function elapsed(value: number) {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(1)} s`;
}

function ScenarioForm({
  initial,
  onSave,
  onClose,
}: {
  initial: Scenario | undefined;
  onSave: (input: ScenarioInput) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    initial ? `${initial.name} copy` : 'Create launch notes',
  );
  const [prompt, setPrompt] = useState(
    initial?.prompt ?? 'Create November launch notes in the Marketing project.',
  );
  const [title, setTitle] = useState(
    initial?.expected.title ?? 'November launch notes',
  );
  const [projectId, setProjectId] = useState<string>(
    initial?.expected.projectId ?? 'marketing',
  );
  const [count, setCount] = useState(initial?.expected.count ?? 1);
  const [error, setError] = useState<string | null>(null);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = scenarioInputSchema.safeParse({
      name,
      prompt,
      expected: { title, projectId, count },
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    try {
      onSave(parsed.data);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save scenario.',
      );
    }
  }
  return (
    <section
      className="panel scenario-editor"
      aria-labelledby="new-scenario-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Reusable test</p>
          <h2 id="new-scenario-title">Save a new scenario</h2>
        </div>
        <button type="button" className="button-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
      <form onSubmit={save}>
        <label>
          Scenario name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Task prompt
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Expected application state</legend>
          <p className="field-help">
            These assertions are checked independently. They are never given to
            the agent.
          </p>
          <label>
            Expected draft title
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Expected project
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="marketing">Marketing</option>
                <option value="engineering">Engineering</option>
              </select>
            </label>
            <label>
              Expected draft count
              <input
                required
                type="number"
                min="0"
                max="100"
                value={count}
                onChange={(event) => setCount(event.target.valueAsNumber)}
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button-primary" type="submit">
            Save scenario
          </button>
        </div>
      </form>
    </section>
  );
}

function ToolInspector({
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

function exportJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Report({
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
          onClick={() => exportJson(run, `short-stack-${run.id}.json`)}
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

export function Workbench(props: WorkbenchProps) {
  const [mode, setMode] = useState<RunMode>('scripted');
  const [regression, setRegression] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const scenario = props.scenarios.find(
    (item) => item.id === props.selectedScenarioId,
  );
  const runs = [...props.runs].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const report = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const previous = report
    ? runs
        .slice(runs.indexOf(report) + 1)
        .find((run) => run.scenario.id === report.scenario.id)
    : undefined;
  const passedCount = props.runs.filter(
    (run) => run.status === 'passed',
  ).length;
  function run() {
    setSelectedRunId(null);
    props.onRun(mode, regression);
  }
  return (
    <div className="workbench">
      <aside className="sidebar">
        <a
          className="brand"
          href="#workspace"
          aria-label="Short Stack workspace"
        >
          <StackMark />
          <span>
            short stack<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>Local workspace</strong>
            <small>Agent reliability lab</small>
          </div>
          <span className="local-dot" />
        </div>
        <div className="sidebar-heading">
          <h2>Scenarios</h2>
          <span>{props.scenarios.length}</span>
        </div>
        <nav aria-label="Saved scenarios" className="scenario-nav">
          {props.scenarios.map((item) => (
            <button
              key={item.id}
              className={`scenario-link ${item.id === props.selectedScenarioId ? 'active' : ''}`}
              type="button"
              disabled={props.running}
              onClick={() => {
                props.onSelectScenario(item.id);
                setShowEditor(false);
              }}
              aria-current={
                item.id === props.selectedScenarioId ? 'true' : undefined
              }
            >
              <span className="scenario-icon" aria-hidden="true">
                ▤
              </span>
              <span>{item.name}</span>
            </button>
          ))}
        </nav>
        <button
          className="new-scenario"
          type="button"
          disabled={props.running}
          onClick={() => setShowEditor(true)}
        >
          <span aria-hidden="true">＋</span> New scenario
        </button>
        <div className="sidebar-bottom">
          <div className="connection-label">
            <span className="local-dot" /> In-page tools
          </div>
          <p>{props.webmcpStatus}</p>
          <span className="version-label">LOCAL FIRST · v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Playground</strong>
          </div>
          <span className="environment-pill">
            <span className="local-dot" /> Disposable fixtures
          </span>
        </header>
        <main id="workspace" className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Build confidence, one task at a time</p>
              <h1>
                Does your agent <em>actually</em> deliver?
              </h1>
              <p className="page-description">
                Run a real workflow. Inspect every call. Verify what changed.
              </p>
            </div>
            <div className="run-summary">
              <strong>
                {props.runs.length
                  ? `${passedCount}/${props.runs.length}`
                  : '—'}
              </strong>
              <span>saved runs passed</span>
            </div>
          </div>
          {props.error && (
            <div className="error-message global-error" role="alert">
              {props.error}
            </div>
          )}
          {showEditor && !props.running && (
            <ScenarioForm
              initial={scenario}
              onSave={props.onSaveScenario}
              onClose={() => setShowEditor(false)}
            />
          )}
          <div className="workspace-grid">
            <section
              className="panel task-panel"
              aria-labelledby="task-heading"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">01 / Define the task</p>
                  <h2 id="task-heading">
                    {scenario?.name ?? 'Choose a scenario'}
                  </h2>
                </div>
                {scenario && (
                  <div className="scenario-actions">
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() =>
                        exportJson(scenario, `scenario-${scenario.id}.json`)
                      }
                    >
                      Export scenario
                    </button>
                    <button
                      type="button"
                      className="button-quiet delete-scenario"
                      disabled={props.running || props.scenarios.length <= 1}
                      onClick={() => props.onDeleteScenario(scenario.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {scenario ? (
                <>
                  <div className="task-prompt">
                    <span className="prompt-mark" aria-hidden="true">
                      ↳
                    </span>
                    <p>{scenario.prompt}</p>
                  </div>
                  <div className="expectation">
                    <span className="eyebrow">Success looks like</span>
                    <p>
                      <strong>
                        {scenario.expected.count}{' '}
                        {scenario.expected.count === 1 ? 'draft' : 'drafts'}
                      </strong>{' '}
                      titled “{scenario.expected.title}” in{' '}
                      <strong>
                        {props.snapshot.projects.find(
                          (project) =>
                            project.id === scenario.expected.projectId,
                        )?.name ?? scenario.expected.projectId}
                      </strong>
                      .
                    </p>
                    <small>
                      Checked against state, independently of the agent.
                    </small>
                  </div>
                </>
              ) : (
                <div className="empty-inline">
                  Create a scenario with a task and an expected outcome to
                  begin.
                </div>
              )}
              <div className="run-settings">
                <label>
                  Execution mode
                  <select
                    value={mode}
                    disabled={props.running}
                    onChange={(event) =>
                      setMode(
                        event.target.value === 'model' ? 'model' : 'scripted',
                      )
                    }
                  >
                    <option value="scripted">
                      Scripted demo · no model required
                    </option>
                    <option value="model">Model · {props.modelLabel}</option>
                  </select>
                </label>
                <p className="field-help">
                  {mode === 'scripted'
                    ? 'Deterministic demo, not AI. Prompt format: “Create [title] in the [project] project.”'
                    : 'The configured model chooses tools and arguments. A running model endpoint is required.'}
                </p>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={regression}
                    disabled={props.running}
                    onChange={(event) => setRegression(event.target.checked)}
                  />
                  <span>
                    <strong>Introduce a regression</strong>
                    <small>Save the draft in the wrong project.</small>
                  </span>
                  <span className="toggle-visual" aria-hidden="true" />
                </label>
              </div>
              <div className="run-footer">
                <small>Each run resets the demo to a clean fixture.</small>
                {props.running ? (
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={props.onCancel}
                  >
                    Cancel run
                  </button>
                ) : (
                  <button
                    className="button-primary"
                    type="button"
                    disabled={!scenario}
                    onClick={run}
                  >
                    <span aria-hidden="true">▶</span> Run scenario
                  </button>
                )}
              </div>
              {props.running && (
                <div className="running-indicator" role="status">
                  <span className="spinner" /> Executing task and recording tool
                  calls…
                </div>
              )}
            </section>
            <section
              className="panel app-panel"
              aria-labelledby="live-app-heading"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">02 / Watch the application</p>
                  <h2 id="live-app-heading">
                    Draftboard <span className="mini-badge">DEMO APP</span>
                  </h2>
                </div>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={props.running}
                  onClick={props.onReset}
                >
                  Reset
                </button>
              </div>
              <div className="app-browser-bar">
                <span />
                <span />
                <span />
                <code>local / draftboard</code>
                <span className="live-label">LIVE</span>
              </div>
              <div className="project-board">
                {props.snapshot.projects.map((project) => {
                  const drafts = props.snapshot.drafts.filter(
                    (draft) => draft.projectId === project.id,
                  );
                  return (
                    <div className="project-column" key={project.id}>
                      <div className="project-heading">
                        <span className={`project-dot ${project.id}`} />
                        <h3>{project.name}</h3>
                        <span>{drafts.length}</span>
                      </div>
                      {drafts.length ? (
                        drafts.map((draft) => (
                          <article className="draft-card" key={draft.id}>
                            <span className="draft-icon" aria-hidden="true">
                              ▤
                            </span>
                            <h4>{draft.title}</h4>
                            <span className="draft-status">Draft</span>
                            <code>{draft.id}</code>
                          </article>
                        ))
                      ) : (
                        <div className="empty-project">
                          <span aria-hidden="true">＋</span>
                          <p>No drafts yet</p>
                          <small>Created drafts appear here.</small>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="app-caption">
                Real application state. Shared by the UI and registered tools.
              </p>
            </section>
          </div>
          <section
            className="panel tools-panel"
            aria-labelledby="tools-heading"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">The callable surface</p>
                <h2 id="tools-heading">
                  Registered tools{' '}
                  <span className="count-badge">{props.tools.length}</span>
                </h2>
              </div>
              <span className="subtle-label">Inspect or call manually</span>
            </div>
            <p className="panel-description">
              Manual calls use the same validation and permissions as scenario
              runs. They can change the demo state.
            </p>
            <div className="tool-grid">
              {props.tools.map((tool) => (
                <ToolInspector
                  key={tool.name}
                  tool={tool}
                  disabled={props.running}
                  onCall={props.onManualCall}
                />
              ))}
            </div>
            {props.tools.length === 0 && (
              <p className="empty-inline">
                No tools registered. Connect an application to discover its
                actions.
              </p>
            )}
          </section>
          <div className="results-heading">
            <div>
              <p className="eyebrow">03 / Verify the outcome</p>
              <h2>Evidence, not “done.”</h2>
            </div>
            {runs.length > 0 && (
              <label className="history-select">
                Run history
                <select
                  value={report?.id ?? ''}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                >
                  {runs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.status.toUpperCase()} · {item.scenario.name} ·{' '}
                      {new Date(item.startedAt).toLocaleTimeString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {report ? (
            <Report run={report} previous={previous} />
          ) : (
            <section className="panel empty-report">
              <div className="empty-report-icon" aria-hidden="true">
                ✓
              </div>
              <h3>Your first run starts here.</h3>
              <p>
                Run the launch-notes scenario to see tool calls and verified
                outcomes.
                <br />
                Then introduce a regression and watch the assertions catch it.
              </p>
              <span className="subtle-label">
                No model or API key needed for the scripted demo.
              </span>
            </section>
          )}
          <footer className="workspace-footer">
            <span>short stack.</span>
            <p>Expose actions. Verify outcomes. Catch regressions.</p>
            <span>Built for the agentic web</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
