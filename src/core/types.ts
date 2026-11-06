import { z } from 'zod';

import { toolDescriptorSchema, toolTraceSchema } from 'short-stack';
export { toolDescriptorSchema, toolTraceSchema } from 'short-stack';
export type { ToolDescriptor, ToolTrace } from 'short-stack';

export const snapshotSchema = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  drafts: z.array(
    z.object({ id: z.string(), title: z.string(), projectId: z.string() }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const scenarioInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(4000),
  expected: z.object({
    title: z.string().trim().min(1).max(200),
    projectId: z.enum(['marketing', 'engineering']),
    count: z.number().int().min(0).max(100),
  }),
});
export const scenarioSchema = scenarioInputSchema.extend({
  id: z.string().min(1),
  fixture: z.literal('launch-notes-v1'),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export const runModeSchema = z.enum(['scripted', 'model']);
export type RunMode = z.infer<typeof runModeSchema>;
export const assertionResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  expected: z.string(),
  actual: z.string(),
});
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export const runReportSchema = z.object({
  id: z.string(),
  scenario: scenarioSchema,
  startedAt: z.string(),
  durationMs: z.number(),
  mode: runModeSchema,
  model: z.string(),
  tools: z.array(toolDescriptorSchema),
  initialState: snapshotSchema,
  finalState: snapshotSchema,
  traces: z.array(toolTraceSchema),
  assertions: z.array(assertionResultSchema),
  agentMessage: z.string(),
  error: z.string().nullable(),
  status: z.enum(['passed', 'failed', 'error']),
  regression: z.boolean(),
});
export type RunReport = z.infer<typeof runReportSchema>;
export const functionCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string().max(32000),
  }),
});
export const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(64000).nullable(),
  tool_calls: z.array(functionCallSchema).max(12).optional(),
  tool_call_id: z.string().optional(),
});
export type AgentMessage = z.infer<typeof messageSchema>;
export const agentRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(80),
  tools: z.array(toolDescriptorSchema).max(40),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export const agentReplySchema = z.object({
  content: z.string().nullable(),
  tool_calls: z.array(functionCallSchema).max(12).optional(),
});
export type AgentReply = z.infer<typeof agentReplySchema>;
export type AgentStep = (
  request: AgentRequest,
  signal?: AbortSignal,
) => Promise<AgentReply>;
