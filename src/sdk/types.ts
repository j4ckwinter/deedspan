import { z } from 'zod';

export const toolDescriptorSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(4000),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
export const toolTraceSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  status: z.enum(['success', 'error']),
  durationMs: z.number(),
});
export type ToolTrace = z.infer<typeof toolTraceSchema>;

export interface ToolClient {
  list(): ToolDescriptor[] | Promise<ToolDescriptor[]>;
  call(name: string, input: unknown): Promise<ToolTrace>;
}
