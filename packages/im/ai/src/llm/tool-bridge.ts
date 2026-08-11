import { z } from 'zod';
import type { AgentTool } from '../types.js';
import type { LlmTool } from './types/tool.js';
import { jsonSchemaToZod } from './json-schema-zod.js';

export { jsonSchemaToZod } from './json-schema-zod.js';

/** `@zhin.js/ai` AgentTool → pi LlmTool for agentLoop transport. */
export function agentToolToLlmTool(tool: AgentTool): LlmTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToZod(tool.parameters),
    preExecutable: tool.preExecutable,
  };
}

export function agentToolsToLlmTools(tools: AgentTool[]): LlmTool[] {
  return tools.map(agentToolToLlmTool);
}

export type ToolParametersSchema = z.ZodObject<z.ZodRawShape>;
