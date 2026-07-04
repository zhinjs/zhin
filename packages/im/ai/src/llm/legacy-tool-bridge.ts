import { z } from 'zod';
import type { AgentTool as LegacyAgentTool } from '../types.js';
import type { LlmTool } from './types/tool.js';
import { jsonSchemaToZod } from './json-schema-zod.js';

export { jsonSchemaToZod, jsonSchemaToTypeBox } from './json-schema-zod.js';

/** `@zhin.js/ai` AgentTool → pi LlmTool for agentLoop transport. */
export function agentToolToLlmTool(tool: LegacyAgentTool): LlmTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToZod(tool.parameters),
    preExecutable: tool.preExecutable,
  };
}

export function agentToolsToLlmTools(tools: LegacyAgentTool[]): LlmTool[] {
  return tools.map(agentToolToLlmTool);
}

export type ToolParametersSchema = z.ZodObject<z.ZodRawShape>;
