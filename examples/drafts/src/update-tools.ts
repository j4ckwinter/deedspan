import { type ToolRegistry } from 'deedspan';
import { z } from 'zod';
import {
  draftsSchema,
  draftSchema,
  updateDraftSchema,
  updateDraftResultSchema,
  type UpdateDraftInput,
} from './contracts.js';
import { type DraftRequest } from './tools.js';

const querySchema = z.string().trim().min(1).max(200);

async function search(request: DraftRequest, query: string, callId: string) {
  const drafts = draftsSchema.parse(
    await request('/drafts', undefined, callId),
  );
  return drafts.filter((draft) =>
    draft.title.toLowerCase().includes(query.toLowerCase()),
  );
}

export function registerDraftUpdateTools(
  tools: ToolRegistry,
  request: DraftRequest,
) {
  tools.register({
    name: 'search_drafts',
    description:
      'Find accessible drafts by title, including their current versions.',
    input: z.object({ query: querySchema }).strict(),
    execute: ({ query }, context) => search(request, query, context.callId),
  });
  tools.register({
    name: 'update_draft',
    description:
      'Request a title change to a discovered draft at its current version. Reuse the exact operation ID and input on retries. If confirmation_required, ask the user to approve in the application, then retry. Never approve on their behalf. Rejected or conflicting requests must not be retried as new operations without a new user decision.',
    input: updateDraftSchema,
    execute: async (input, context) =>
      updateDraftResultSchema.parse(
        await request('/draft-updates', input, context.callId),
      ),
  });
  tools.register({
    name: 'get_updated_draft',
    description: 'Retrieve a draft to verify its saved title and version.',
    input: z.object({ id: z.uuid() }).strict(),
    execute: async ({ id }, context) =>
      draftSchema.parse(
        await request(
          `/drafts/${encodeURIComponent(id)}`,
          undefined,
          context.callId,
        ),
      ),
  });
}

export function registerDraftUpdateTaskTools(
  tools: ToolRegistry,
  request: DraftRequest,
  taskInput: Pick<UpdateDraftInput, 'operationId' | 'title'> & {
    query: string;
  },
) {
  const task = updateDraftSchema
    .pick({ operationId: true, title: true })
    .extend({ query: querySchema })
    .strict()
    .parse(taskInput);
  let discovered: z.infer<typeof draftsSchema> = [];
  let selected: UpdateDraftInput | undefined;
  let completed: { id: string; version: number } | undefined;
  tools.register({
    name: 'search_drafts',
    description:
      'Find accessible drafts matching this task. The application supplies the title search. Use a returned ID to request the update.',
    input: z.object({}).strict(),
    execute: async (_input, context) => {
      discovered = await search(request, task.query, context.callId);
      return discovered;
    },
  });
  tools.register({
    name: 'update_draft',
    description:
      "Request the update for a discovered draft ID. The application supplies the new title, operation ID and discovered version, preserving them on retries. When confirmation_required, wait for user approval then call again with the same ID. Stop on rejected or conflict. Never approve on the user's behalf.",
    input: z.object({ id: z.uuid() }).strict(),
    execute: async ({ id }, context) => {
      if (selected && selected.draftId !== id)
        throw new Error('This task already selected a different draft');
      if (!selected) {
        const draft = discovered.find((candidate) => candidate.id === id);
        if (!draft)
          throw new Error('Discover this draft before requesting an update');
        selected = {
          operationId: task.operationId,
          title: task.title,
          draftId: draft.id,
          expectedVersion: draft.version,
        };
      }
      const result = updateDraftResultSchema.parse(
        await request('/draft-updates', selected, context.callId),
      );
      if (
        result.operationId !== task.operationId ||
        result.draftId !== selected.draftId
      )
        throw new Error('Update response belongs to a different task');
      if (result.status === 'completed') {
        if (result.version !== selected.expectedVersion + 1)
          throw new Error('Completed update has an unexpected version');
        completed = { id: result.draftId, version: result.version };
      }
      return result;
    },
  });
  tools.register({
    name: 'get_updated_draft',
    description:
      'Verify the updated draft after update_draft completes. The application supplies the ID and checks the saved title and version. Call with no arguments.',
    input: z.object({}).strict(),
    execute: async (_input, context) => {
      if (!completed)
        throw new Error('Complete the update before retrieving it');
      const draft = draftSchema.parse(
        await request(
          `/drafts/${encodeURIComponent(completed.id)}`,
          undefined,
          context.callId,
        ),
      );
      if (
        draft.id !== completed.id ||
        draft.title !== task.title ||
        draft.version !== completed.version
      )
        throw new Error('Saved draft no longer matches the completed update');
      return draft;
    },
  });
}
