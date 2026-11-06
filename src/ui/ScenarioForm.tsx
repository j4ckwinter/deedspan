import { useState, type FormEvent } from 'react';
import { defaultScenario } from '../core/scenarios.js';
import {
  scenarioInputSchema,
  type Scenario,
  type ScenarioInput,
} from '../core/types.js';

export function ScenarioForm({
  initial,
  onSave,
  onClose,
}: {
  initial: Scenario | undefined;
  onSave: (input: ScenarioInput) => void;
  onClose: () => void;
}) {
  const source = initial ?? defaultScenario;
  const [name, setName] = useState(
    initial ? `${initial.name} copy` : source.name,
  );
  const [prompt, setPrompt] = useState(source.prompt);
  const [title, setTitle] = useState(source.expected.title);
  const [projectId, setProjectId] = useState<string>(source.expected.projectId);
  const [count, setCount] = useState(source.expected.count);
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
