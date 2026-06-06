import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool as LegacyAgentTool, JsonSchema } from '../types.js';
import type { LlmTool } from './types/tool.js';

function jsonSchemaPropertyToTypeBox(prop: JsonSchema): TSchema {
  switch (prop.type) {
    case 'string':
      return Type.String({ description: prop.description });
    case 'number':
    case 'integer':
      return Type.Number({ description: prop.description });
    case 'boolean':
      return Type.Boolean({ description: prop.description });
    case 'array':
      return prop.items
        ? Type.Array(jsonSchemaPropertyToTypeBox(prop.items), { description: prop.description })
        : Type.Array(Type.Unknown(), { description: prop.description });
    case 'object':
      return jsonSchemaToTypeBox(prop);
    default:
      return Type.Unsafe(prop);
  }
}

export function jsonSchemaToTypeBox(schema: JsonSchema): TSchema {
  if (schema.type === 'object') {
    const properties: Record<string, TSchema> = {};
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      properties[key] = jsonSchemaPropertyToTypeBox(prop);
    }
    return Type.Object(properties, {
      required: schema.required,
      description: schema.description,
    });
  }
  return jsonSchemaPropertyToTypeBox(schema);
}

export function convertLegacyTool(tool: LegacyAgentTool): LlmTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToTypeBox(tool.parameters),
    preExecutable: tool.preExecutable,
  };
}

export function convertLegacyTools(tools: LegacyAgentTool[]): LlmTool[] {
  return tools.map(convertLegacyTool);
}
