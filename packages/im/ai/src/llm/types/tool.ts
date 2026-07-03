import type { z } from 'zod';

/** Zod tool definition for the LLM engine (ADR 0019). */
export interface LlmTool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  /** IM layer: run before agentLoop without model invocation */
  preExecutable?: boolean;
  /** Anthropic advanced tool use: defer schema from context until referenced */
  deferLoading?: boolean;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
