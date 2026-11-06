import { type ToolRegistry } from 'deedspan';
import { z } from 'zod';
import {
  createDraftSchema,
  createDraftResultSchema,
  type CreateDraftInput,
} from './contracts.js';

export type DraftRequest = (
  path: string,
  body?: unknown,
  callId?: string,
) => Promise<unknown>;
export function registerDraftTools(tools: ToolRegistry, request: DraftRequest) {
  registerProjectTool(tools, request);
  tools.register({
    name: 'create_draft',
    description:
      'Request a draft in a project. Generate a UUID operationId and reuse it with identical input on retries. If confirmation_required, ask the user to approve the exact operation in the application, then retry. Never approve on their behalf.',
    input: createDraftSchema,
    execute: (input, context) => request('/drafts', input, context.callId),
  });
  registerGetDraftTool(tools, request);
}

export function registerDraftTaskTools(
  tools: ToolRegistry,
  request: DraftRequest,
  taskInput: Pick<CreateDraftInput, 'operationId' | 'title'>,
) {
  const task = createDraftSchema
    .pick({ operationId: true, title: true })
    .parse(taskInput);
  let draftId: string | undefined;
  registerProjectTool(tools, request);
  tools.register({
    name: 'create_draft',
    description:
      "Request this task's draft in a project. The application supplies the exact title and operation ID and reuses them on retries. If confirmation_required, ask the user to approve the exact operation in the application, then retry. Never approve on their behalf.",
    input: createDraftSchema.pick({ projectId: true }),
    execute: async (input, context) => {
      const result = createDraftResultSchema.parse(
        await request('/drafts', { ...input, ...task }, context.callId),
      );
      if (result.operationId !== task.operationId)
        throw new Error('Draft response belongs to a different task');
      if (result.status === 'completed') {
        if (!result.draftId)
          throw new Error('Completed draft response must include a draft ID');
        draftId = result.draftId;
      }
      return result;
    },
  });
  tools.register({
    name: 'get_draft',
    description:
      'Retrieve the saved draft for this task after create_draft completes. The application supplies the saved draft ID.',
    input: z.object({}).strict(),
    execute: (_input, context) => {
      if (!draftId)
        throw new Error(
          'Complete create_draft for this task before retrieving it',
        );
      return request(
        `/drafts/${encodeURIComponent(draftId)}`,
        undefined,
        context.callId,
      );
    },
  });
}

function registerProjectTool(tools: ToolRegistry, request: DraftRequest) {
  const empty = z.object({}).strict();
  tools.register({
    name: 'search_projects',
    description: 'List projects accessible to the signed-in user.',
    input: empty,
    execute: (_input, context) =>
      request('/projects', undefined, context.callId),
  });
}

function registerGetDraftTool(tools: ToolRegistry, request: DraftRequest) {
  tools.register({
    name: 'get_draft',
    description: 'Retrieve a persisted draft by ID to verify the outcome.',
    input: z.object({ id: z.string() }).strict(),
    execute: ({ id }, context) =>
      request(`/drafts/${encodeURIComponent(id)}`, undefined, context.callId),
  });
}
