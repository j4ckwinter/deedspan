import type { Scenario } from './types.js';

export const defaultScenario: Scenario = {
  id: 'launch-notes',
  name: 'Create launch notes',
  fixture: 'launch-notes-v1',
  prompt: 'Create November launch notes in the Marketing project.',
  expected: {
    title: 'November launch notes',
    projectId: 'marketing',
    count: 1,
  },
};
