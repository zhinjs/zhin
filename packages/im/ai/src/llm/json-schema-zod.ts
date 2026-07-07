import { z } from 'zod';
import type { JsonSchema } from '../types.js';

function jsonSchemaPropertyToZod(prop: JsonSchema): z.ZodTypeAny {
  switch (prop.type) {
    case 'string':
      return prop.description ? z.string().describe(prop.description) : z.string();
    case 'number':
    case 'integer':
      return prop.description ? z.number().describe(prop.description) : z.number();
    case 'boolean':
      return prop.description ? z.boolean().describe(prop.description) : z.boolean();
    case 'array':
      return z.array(
        prop.items ? jsonSchemaPropertyToZod(prop.items) : z.unknown(),
      );
    case 'object':
      return jsonSchemaToZod(prop);
    default:
      return z.unknown();
  }
}

export function jsonSchemaToZod(schema: JsonSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema.type === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      let field = jsonSchemaPropertyToZod(prop);
      if (!schema.required?.includes(key)) {
        field = field.optional();
      }
      shape[key] = field;
    }
    return z.object(shape);
  }
  return z.object({});
}
