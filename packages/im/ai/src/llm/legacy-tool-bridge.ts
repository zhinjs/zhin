import { z } from 'zod';
import type { AgentTool as LegacyAgentTool } from '../types.js';
import type { LlmTool } from './types/tool.js';
import { jsonSchemaToZod } from './json-schema-zod.js';

export { jsonSchemaToZod, jsonSchemaToTypeBox } from './json-schema-zod.js';

export function convertLegacyTool(tool: LegacyAgentTool): LlmTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToZod(tool.parameters),
    preExecutable: tool.preExecutable,
  };
}

export function convertLegacyTools(tools: LegacyAgentTool[]): LlmTool[] {
  return tools.map(convertLegacyTool);
}

export type ToolParametersSchema = z.ZodObject<z.ZodRawShape>;
