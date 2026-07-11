/**
 * Zod object schema → ToolParametersSchema for authoring tools.
 */

import type { ToolParametersSchema } from '../orchestrator/types.js';

function zodFieldToJsonSchema(z: unknown): Record<string, unknown> {
  const zod = z as { _def?: { typeName?: string; innerType?: unknown; type?: unknown; element?: unknown; description?: string; values?: string[] } };
  if (!zod || !zod._def) return { type: 'string' };
  const def = zod._def;
  const typeName = def.typeName;

  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    const inner = def.innerType ?? def.type;
    return zodFieldToJsonSchema(inner);
  }
  if (typeName === 'ZodString') {
    const out: Record<string, unknown> = { type: 'string' };
    if (def.description) out.description = def.description;
    return out;
  }
  if (typeName === 'ZodNumber') {
    const out: Record<string, unknown> = { type: 'number' };
    if (def.description) out.description = def.description;
    return out;
  }
  if (typeName === 'ZodBoolean') {
    const out: Record<string, unknown> = { type: 'boolean' };
    if (def.description) out.description = def.description;
    return out;
  }
  if (typeName === 'ZodEnum') {
    return { type: 'string', enum: def.values };
  }
  if (typeName === 'ZodArray') {
    return { type: 'array', items: zodFieldToJsonSchema(def.type ?? def.element) };
  }
  return { type: 'string' };
}

export function zodObjectToParameters(schema: unknown): ToolParametersSchema {
  const result: ToolParametersSchema = {
    type: 'object',
    properties: {},
    required: [],
  };
  const s = schema as { shape?: Record<string, unknown> };
  if (!s?.shape) return result;
  const required: string[] = [];
  for (const [key, value] of Object.entries(s.shape)) {
    const zodValue = value as { _def?: { typeName?: string } };
    const props = result.properties ?? {};
    props[key] = zodFieldToJsonSchema(zodValue) as ToolParametersSchema['properties'] extends Record<string, infer P> ? P : never;
    result.properties = props;
    const typeName = zodValue?._def?.typeName;
    if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') {
      required.push(key);
    }
  }
  if (required.length > 0) result.required = required;
  return result;
}

export function parseWithZodSchema<T>(schema: unknown, args: Record<string, unknown>): { ok: true; data: T } | { ok: false; error: string } {
  const s = schema as { safeParse?: (v: unknown) => { success: boolean; data?: T; error?: { errors?: Array<{ path?: (string | number)[]; message?: string }> } } };
  if (!s?.safeParse) {
    return { ok: true, data: args as T };
  }
  const parsed = s.safeParse(args);
  if (!parsed.success) {
    const msg = parsed.error?.errors?.map((e) => `${e.path?.join('.') ?? 'root'}: ${e.message ?? 'invalid'}`).join('; ') ?? 'Invalid arguments';
    return { ok: false, error: msg };
  }
  return { ok: true, data: parsed.data as T };
}

export function parseConfigWithZodSchema(schema: unknown, config: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  return parseWithZodSchema<Record<string, unknown>>(schema, (config ?? {}) as Record<string, unknown>);
}
