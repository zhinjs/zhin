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

/** Points the model at the discovery meta-tools when they are available. */
function unknownToolMessage(tools: LlmTool[], name: string): string {
  const names = new Set(tools.map((t) => t.name));
  const hints: string[] = [];
  if (names.has('discover')) hints.push('use `discover` to search for tools');
  if (names.has('load_tool')) hints.push('call `load_tool` with an exact name from the results');
  return hints.length > 0
    ? `Unknown tool: ${name}. It is not available in this turn; ${hints.join(', then ')}.`
    : `Unknown tool: ${name}`;
}

/** Long enough to show the model where its JSON broke, short enough for a tool result. */
const MAX_QUOTED_INPUT = 500;

function quoteInput(raw: string): string {
  return raw.length > MAX_QUOTED_INPUT ? `${raw.slice(0, MAX_QUOTED_INPUT)}… (truncated, ${raw.length} chars)` : raw;
}

export function validateToolCall(tools: LlmTool[], toolCall: ParsedToolCall): ParsedToolCall {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) {
    throw new ToolCallValidationError(unknownToolMessage(tools, toolCall.name), toolCall.name);
  }

  if (toolCall.inputError) {
    // Quote what the model sent: "missing field" errors against `{}` would only confuse it.
    throw new ToolCallValidationError(
      `Invalid arguments for tool ${toolCall.name}: not a valid JSON object (${toolCall.inputError.message}). `
        + `Received: ${quoteInput(toolCall.inputError.raw)}. Call the tool again with a JSON object matching its schema.`,
      toolCall.name,
      toolCall.inputError,
    );
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
