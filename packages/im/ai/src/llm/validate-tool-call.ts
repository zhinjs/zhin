import { z } from 'zod';
import type { LlmTool, ParsedToolCall } from './types/tool.js';

export class ToolCallValidationError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ToolCallValidationError';
  }
}

export function validateToolCall(tools: LlmTool[], toolCall: ParsedToolCall): ParsedToolCall {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) {
    throw new ToolCallValidationError(`Unknown tool: ${toolCall.name}`, toolCall.name);
  }

  const parsed = tool.parameters.safeParse(toolCall.arguments);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ToolCallValidationError(
      `Invalid arguments for tool ${toolCall.name}: ${first?.message ?? 'validation failed'}`,
      toolCall.name,
      parsed.error.issues,
    );
  }

  return toolCall;
}

export function toolCallFromContentBlock(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ParsedToolCall {
  return { id, name, arguments: args };
}

export function stringParamTool(name: string, description: string, required: string[] = []): LlmTool {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of required) {
    shape[key] = z.string();
  }
  return {
    name,
    description,
    parameters: z.object(shape),
  };
}

export { z };
