import { useState } from 'react';
import type { RunMode } from '../core/types.js';
import type { WorkbenchProps } from './contracts.js';
import { ScenarioForm } from './ScenarioForm.js';
import { ToolInspector } from './ToolInspector.js';
import { RunReportView } from './RunReportView.js';
import { exportJson } from './download.js';
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
            <RunReportView run={report} previous={previous} />
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
