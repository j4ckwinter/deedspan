import { z } from 'zod';
import type { Snapshot } from '../core/types.js';
import { ToolRegistry } from 'short-stack';

export const fixture = (): Snapshot => ({
  projects: [
    { id: 'marketing', name: 'Marketing' },
    { id: 'engineering', name: 'Engineering' },
  ],
  drafts: [],
});

export function createDemo() {
  let state = fixture();
  let regression = false;
  let canWrite = true;
  const registry = new ToolRegistry();
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  registry.register({
    name: 'find_project',
    description:
      'Find a project by its name. Returns its id and name, or an error if it does not exist.',
    input: z.object({ name: z.string().trim().min(1).max(100) }).strict(),
    execute: ({ name }) => {
      const project = state.projects.find(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      );
      if (!project) throw new Error(`Project not found: ${name}`);
      return { ...project };
    },
  });
  registry.register({
    name: 'create_draft',
    description:
      'Create one draft with a title in an existing project. Requires projectId from find_project. Returns the created draft.',
    input: z
      .object({
        projectId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
    authorize: () => canWrite,
    execute: ({ projectId, title }) => {
      if (!state.projects.some((p) => p.id === projectId))
        throw new Error('Unknown project');
      const draft = {
        id: crypto.randomUUID(),
        title,
        projectId: regression
          ? projectId === 'marketing'
            ? 'engineering'
            : 'marketing'
          : projectId,
      };
      state = { ...state, drafts: [...state.drafts, draft] };
      publish();
      return { ...draft };
    },
  });
  registry.register({
    name: 'get_draft',
    description:
      'Retrieve a draft by its id to inspect its saved title and projectId.',
    input: z.object({ id: z.string().min(1) }).strict(),
    execute: ({ id }) => {
      const draft = state.drafts.find((d) => d.id === id);
      if (!draft) throw new Error('Draft not found');
      return { ...draft };
    },
  });
  return {
    registry,
    snapshot: () => structuredClone(state),
    reset: () => {
      state = fixture();
      publish();
    },
    setRegression: (value: boolean) => {
      regression = value;
    },
    setCanWrite: (value: boolean) => {
      canWrite = value;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type Demo = ReturnType<typeof createDemo>;
