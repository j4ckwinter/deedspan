import { type ToolRegistry } from 'deedspan';
import { z } from 'zod';
import { createDraftSchema } from './contracts.js';

export type DraftRequest = (
  path: string,
  body?: unknown,
  callId?: string,
) => Promise<unknown>;
export function registerDraftTools(tools: ToolRegistry, request: DraftRequest) {
  const empty = z.object({}).strict();
  tools.register({
    name: 'search_projects',
    description: 'List projects accessible to the signed-in user.',
    input: empty,
    execute: (_input, context) =>
      request('/projects', undefined, context.callId),
  });
  tools.register({
    name: 'create_draft',
    description:
      'Request a draft in a project. Generate a UUID operationId and reuse it with identical input on retries. If confirmation_required, ask the user to approve the exact operation in the application, then retry. Never approve on their behalf.',
    input: createDraftSchema,
    execute: (input, context) => request('/drafts', input, context.callId),
  });
  tools.register({
    name: 'get_draft',
    description: 'Retrieve a persisted draft by ID to verify the outcome.',
    input: z.object({ id: z.string() }).strict(),
    execute: ({ id }, context) =>
      request(`/drafts/${encodeURIComponent(id)}`, undefined, context.callId),
  });
}
