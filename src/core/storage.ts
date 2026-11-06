import { z } from 'zod';
import {
  scenarioSchema,
  runReportSchema,
  type RunReport,
  type Scenario,
} from './types.js';
import { defaultScenario } from './scenarios.js';

export const savedStateLimits = { scenarios: 100, runs: 20 } as const;
const storageSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(scenarioSchema).max(savedStateLimits.scenarios),
  runs: z.array(runReportSchema).max(savedStateLimits.runs),
});
export interface SavedState {
  scenarios: Scenario[];
  runs: RunReport[];
  warning: string | null;
}
export const storageKey = 'short-stack.workbench.v1';
export function loadState(storage: Pick<Storage, 'getItem'>): SavedState {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw)
      return {
        scenarios: [structuredClone(defaultScenario)],
        runs: [],
        warning: null,
      };
    const saved = storageSchema.parse(JSON.parse(raw));
    return {
      scenarios: saved.scenarios.length
        ? saved.scenarios
        : [structuredClone(defaultScenario)],
      runs: saved.runs,
      warning: null,
    };
  } catch {
    return {
      scenarios: [structuredClone(defaultScenario)],
      runs: [],
      warning:
        'Saved data could not be read. Loaded the default scenario; invalid data will be replaced when you save or run.',
    };
  }
}
export function saveState(
  storage: Pick<Storage, 'setItem'>,
  scenarios: Scenario[],
  runs: RunReport[],
) {
  const data = storageSchema.parse({
    version: 1,
    scenarios,
    runs: runs.slice(0, savedStateLimits.runs),
  });
  storage.setItem(storageKey, JSON.stringify(data));
}
