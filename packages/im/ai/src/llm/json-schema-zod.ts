/**
 * Tool JSON Schema → zod, for validating tool-call arguments (`validateToolCall`)
 * and for the AI SDK's own input check. What the provider sees is the original
 * JSON Schema (see `toolInputJsonSchema` and `LlmTool.inputJsonSchema`), so this
 * conversion only has to agree with it on which values are valid.
 *
 * Kept: required/optional, enum, const, anyOf/oneOf, type arrays such as
 * `["string","null"]`, `nullable: true`, `integer`, string/number/array bounds
 * and descriptions. `format` and `pattern` are not enforced here (the provider
 * still sees them); `allOf`, `$ref` and other keywords accept any value.
 */
import { z } from 'zod';
import type { JsonSchema } from '../types.js';

type Schema = Record<string, unknown>;

const isRecord = (value: unknown): value is Schema =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function literal(value: unknown): z.ZodTypeAny {
  if (value === null) return z.null();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return z.literal(value);
  return z.unknown();
}

function union(options: z.ZodTypeAny[]): z.ZodTypeAny {
  if (options.length === 0) return z.never();
  if (options.length === 1) return options[0]!;
  return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function forType(type: string, schema: Schema): z.ZodTypeAny {
  switch (type) {
    case 'string': {
      let s = z.string();
      const min = num(schema.minLength);
      const max = num(schema.maxLength);
      if (min !== undefined) s = s.min(min);
      if (max !== undefined) s = s.max(max);
      return s;
    }
    case 'number':
    case 'integer': {
      let n = type === 'integer' ? z.number().int() : z.number();
      const min = num(schema.minimum);
      const max = num(schema.maximum);
      const gt = num(schema.exclusiveMinimum);
      const lt = num(schema.exclusiveMaximum);
      if (min !== undefined) n = n.min(min);
      if (max !== undefined) n = n.max(max);
      if (gt !== undefined) n = n.gt(gt);
      if (lt !== undefined) n = n.lt(lt);
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      let a = z.array(isRecord(schema.items) ? schemaToZod(schema.items) : z.unknown());
      const min = num(schema.minItems);
      const max = num(schema.maxItems);
      if (min !== undefined) a = a.min(min);
      if (max !== undefined) a = a.max(max);
      return a;
    }
    case 'object':
      return objectToZod(schema);
    default:
      return z.unknown();
  }
}

function schemaToZod(schema: Schema): z.ZodTypeAny {
  let out: z.ZodTypeAny;
  if (schema.const !== undefined) {
    out = literal(schema.const);
  } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum;
    out = values.every((v) => typeof v === 'string')
      ? z.enum(values as [string, ...string[]])
      : union(values.map(literal));
  } else if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const options = ((schema.anyOf ?? schema.oneOf) as unknown[]).filter(isRecord);
    out = options.length > 0 ? union(options.map(schemaToZod)) : z.unknown();
  } else if (Array.isArray(schema.type)) {
    out = union(schema.type.filter((t): t is string => typeof t === 'string').map((t) => forType(t, schema)));
  } else if (typeof schema.type === 'string') {
    out = forType(schema.type, schema);
  } else if (isRecord(schema.properties)) {
    out = objectToZod(schema);
  } else {
    out = z.unknown();
  }
  if (schema.nullable === true) out = out.nullable();
  return typeof schema.description === 'string' && schema.description ? out.describe(schema.description) : out;
}

function objectToZod(schema: Schema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(isRecord(schema.properties) ? schema.properties : {})) {
    const field = isRecord(prop) ? schemaToZod(prop) : z.unknown();
    shape[key] = required.includes(key) ? field : field.optional();
  }
  return z.object(shape);
}

export function jsonSchemaToZod(schema: JsonSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema?.type === 'object' || isRecord(schema?.properties)) return objectToZod(schema);
  return z.object({});
}

/**
 * The JSON Schema sent to the provider for a tool's input: the tool's own schema,
 * unchanged except that the root is always an object (`type: object`, `properties`).
 * Copied so later edits to the tool cannot change a request in flight.
 */
export function toolInputJsonSchema(schema: JsonSchema | undefined): Record<string, unknown> {
  const copy = isRecord(schema) ? structuredClone(schema) as Schema : {};
  delete copy.$schema;
  if (copy.type !== 'object') copy.type = 'object';
  if (!isRecord(copy.properties)) copy.properties = {};
  return copy;
}

/**
 * Gemini requires a `type` on every schema node and rejects the untyped `{}`
 * that means "any value" in JSON Schema. Give untyped leaves a `string` type
 * (keeping their description); nodes with enum/const/anyOf/oneOf/allOf/properties/items
 * already carry enough for the Google SDK's OpenAPI conversion.
 */
export function geminiCompatibleSchema(schema: unknown, isRoot = true): unknown {
  if (Array.isArray(schema)) return schema.map((item) => geminiCompatibleSchema(item, false));
  if (!isRecord(schema)) return schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && isRecord(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, geminiCompatibleSchema(v, false)]));
    } else if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      out[key] = geminiCompatibleSchema(value, false);
    } else {
      out[key] = value;
    }
  }
  const typed = out.type !== undefined || out.enum !== undefined || out.const !== undefined
    || out.anyOf !== undefined || out.oneOf !== undefined || out.allOf !== undefined
    || out.properties !== undefined || out.items !== undefined || out.$ref !== undefined;
  if (!typed && !isRoot) out.type = 'string';
  return out;
}
