import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
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

  const errors = [...Value.Errors(tool.parameters, toolCall.arguments)];
  if (errors.length > 0) {
    throw new ToolCallValidationError(
      `Invalid arguments for tool ${toolCall.name}: ${errors[0]?.message ?? 'validation failed'}`,
      toolCall.name,
      errors,
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

/** Minimal string tool schema helper for tests and builtins. */
export function stringParamTool(name: string, description: string, required: string[] = []) {
  const properties: Record<string, ReturnType<typeof Type.String>> = {};
  for (const key of required) {
    properties[key] = Type.String();
  }
  return {
    name,
    description,
    parameters: Type.Object(properties, { required }),
  } satisfies LlmTool;
}

export { Type, Value };
