import type { z } from 'zod';

/** Zod tool definition for the LLM engine (ADR 0019). */
export interface LlmTool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  /**
   * JSON Schema sent to the provider for this tool's input. When set it is used
   * as written (enum, anyOf, nullable, integer, format and bounds survive);
   * `parameters` still validates the arguments. When absent, `parameters` is
   * converted to JSON Schema by the AI SDK.
   */
  inputJsonSchema?: Record<string, unknown>;
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
