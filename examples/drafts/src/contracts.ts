import { z } from 'zod';

export const createDraftSchema = z
  .object({
    operationId: z.uuid(),
    projectId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const projectSchema = z.object({ id: z.string(), name: z.string() });
export const projectsSchema = z.array(projectSchema);
export const draftSchema = z.object({
  id: z.uuid(),
  project_id: z.string(),
  title: z.string(),
  version: z.number().int().positive(),
});
export const draftsSchema = z.array(draftSchema);
export const updateDraftSchema = z
  .object({
    operationId: z.uuid(),
    draftId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export const updateOperationSchema = z.object({
  id: z.uuid(),
  user_id: z.string(),
  project_id: z.string(),
  draft_id: z.uuid(),
  expected_version: z.number().int().positive(),
  previous_title: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'approved', 'completed', 'rejected', 'conflict']),
  result_version: z.number().int().positive().nullable(),
});
export const updateOperationsSchema = z.array(updateOperationSchema);
export const updateDraftResultSchema = z.object({
  operationId: z.uuid(),
  status: z.enum([
    'confirmation_required',
    'completed',
    'rejected',
    'conflict',
  ]),
  draftId: z.uuid(),
  version: z.number().int().positive().nullable(),
});
export const operationSchema = z.object({
  id: z.uuid(),
  user_id: z.string(),
  project_id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'approved', 'completed']),
  draft_id: z.uuid().nullable(),
});
export const operationsSchema = z.array(operationSchema);
export const createDraftResultSchema = z.object({
  operationId: z.uuid(),
  status: z.enum(['confirmation_required', 'completed']),
  draftId: z.uuid().nullable(),
});
export const sessionSchema = z.object({
  csrf: z.string().min(1),
  user: z.object({ id: z.string(), name: z.string() }),
});
export type SessionResponse = z.infer<typeof sessionSchema>;
export const errorSchema = z.object({ error: z.string() });
