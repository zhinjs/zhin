import type { TSchema } from '@sinclair/typebox';

/** TypeBox tool definition for the LLM engine (ADR 0009). */
export interface LlmTool {
  name: string;
  description: string;
  parameters: TSchema;
  /** IM layer: run before agentLoop without model invocation */
  preExecutable?: boolean;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
