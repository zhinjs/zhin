import { z } from 'zod';
import type { AgentTool } from '../types.js';
import type { LlmTool } from './types/tool.js';
import { jsonSchemaToZod, toolInputJsonSchema } from './json-schema-zod.js';

export { jsonSchemaToZod, toolInputJsonSchema } from './json-schema-zod.js';

/**
 * `@zhin.js/ai` AgentTool → LlmTool for agentLoop transport. The provider gets the
 * tool's JSON Schema as written (`inputJsonSchema`); the zod form validates arguments.
 */
export function agentToolToLlmTool(tool: AgentTool): LlmTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToZod(tool.parameters),
    inputJsonSchema: toolInputJsonSchema(tool.parameters),
    preExecutable: tool.preExecutable,
  };
}

export function agentToolsToLlmTools(tools: AgentTool[]): LlmTool[] {
  return tools.map(agentToolToLlmTool);
}

export type ToolParametersSchema = z.ZodObject<z.ZodRawShape>;
