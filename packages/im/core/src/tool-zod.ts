/**
 * Zod 工具适配层（可选）
 *
 * 使用 Zod 定义工具参数时可获得类型推断与校验。需安装 zod：
 *   pnpm add zod
 *
 * 用法：
 *   import { createToolFromZod } from '@zhin.js/core/tool-zod';
 *   import { z } from 'zod';
 *   const tool = createToolFromZod('my_tool', '描述', z.object({ id: z.string() }), async (args) => { ... });
 *   plugin.addTool(tool);
 */

import type { Tool, ToolParametersSchema } from './types.js';
import type { Message } from './message.js';

type MaybePromise<T> = T | Promise<T>;

type UnknownRecord = Record<string, unknown>;

interface ZodLikeParseError {
  readonly issues?: readonly ZodLikeIssue[];
  /** Zod 3 compatibility. Zod 4 renamed this field to `issues`. */
  readonly errors?: readonly ZodLikeIssue[];
}

interface ZodLikeIssue {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
}

interface ZodLikeSchema {
  readonly shape?: UnknownRecord | (() => UnknownRecord);
  readonly _def?: UnknownRecord;
  readonly description?: string;
  readonly toJSONSchema?: () => unknown;
  safeParse?: (value: unknown) => {
    readonly success: boolean;
    readonly data?: unknown;
    readonly error?: ZodLikeParseError;
  };
}

export type ToolSchemaParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getShape(schema: unknown): UnknownRecord | undefined {
  const shape = (schema as ZodLikeSchema | null)?.shape;
  if (typeof shape === 'function') {
    const value = shape();
    return isRecord(value) ? value : undefined;
  }
  return isRecord(shape) ? shape : undefined;
}

function acceptsUndefined(schema: unknown): boolean {
  const candidate = schema as ZodLikeSchema | null;
  if (typeof candidate?.safeParse === 'function') {
    try {
      return candidate.safeParse(undefined).success;
    } catch {
      // Fall through to structural compatibility for non-Zod lookalikes.
    }
  }
  const def = candidate?._def;
  const kind = def?.typeName ?? def?.type;
  return kind === 'ZodOptional'
    || kind === 'ZodDefault'
    || kind === 'optional'
    || kind === 'default';
}

function requiredFromShape(schema: unknown, fallback?: readonly string[]): string[] | undefined {
  const shape = getShape(schema);
  if (!shape) return fallback?.length ? [...fallback] : undefined;
  const required = Object.entries(shape)
    .filter(([, field]) => !acceptsUndefined(field))
    .map(([key]) => key);
  return required.length ? required : undefined;
}

function descriptionOf(schema: unknown, def: UnknownRecord): string | undefined {
  const description = (schema as ZodLikeSchema | null)?.description ?? def.description;
  return typeof description === 'string' ? description : undefined;
}

function zodFieldToJsonSchema(schema: unknown): UnknownRecord {
  const candidate = schema as ZodLikeSchema | null;
  const def = candidate?._def;
  if (!isRecord(def)) return { type: 'string' };

  const kind = def.typeName ?? def.type;
  if (kind === 'ZodOptional' || kind === 'ZodDefault' || kind === 'optional' || kind === 'default') {
    return zodFieldToJsonSchema(def.innerType ?? def.type);
  }

  const description = descriptionOf(schema, def);
  const withDescription = (type: string): UnknownRecord => description
    ? { type, description }
    : { type };

  if (kind === 'ZodString' || kind === 'string') return withDescription('string');
  if (kind === 'ZodNumber' || kind === 'number') return withDescription('number');
  if (kind === 'ZodBoolean' || kind === 'boolean') return withDescription('boolean');
  if (kind === 'ZodEnum' || kind === 'enum') {
    const values = Array.isArray(def.values)
      ? def.values
      : isRecord(def.entries)
        ? Object.values(def.entries)
        : [];
    return { ...withDescription('string'), enum: values };
  }
  if (kind === 'ZodArray' || kind === 'array') {
    return {
      ...withDescription('array'),
      items: zodFieldToJsonSchema(def.element ?? def.type),
    };
  }
  if (kind === 'ZodObject' || kind === 'object') {
    return toolInputSchemaToParameters(schema) as unknown as UnknownRecord;
  }
  return withDescription('string');
}

function isJsonObjectSchema(schema: unknown): schema is ToolParametersSchema {
  if (!isRecord(schema) || schema.type !== 'object') return false;
  return typeof (schema as ZodLikeSchema).safeParse !== 'function';
}

function fromNativeJsonSchema(schema: unknown): ToolParametersSchema | undefined {
  const candidate = schema as ZodLikeSchema | null;
  if (typeof candidate?.toJSONSchema !== 'function') return undefined;
  try {
    const converted = candidate.toJSONSchema();
    if (!isRecord(converted) || converted.type !== 'object') return undefined;
    return {
      ...converted,
      type: 'object',
      properties: isRecord(converted.properties)
        ? converted.properties as ToolParametersSchema['properties']
        : {},
      required: requiredFromShape(schema, Array.isArray(converted.required)
        ? converted.required.filter((key): key is string => typeof key === 'string')
        : undefined),
    } as ToolParametersSchema;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a JSON Schema or Zod object schema into the canonical Core tool
 * parameter schema. Zod remains an optional peer: this adapter uses only its
 * public instance methods and retains a structural fallback for Zod 3.
 */
export function toolInputSchemaToParameters(schema: unknown): ToolParametersSchema {
  if (isJsonObjectSchema(schema)) return schema;

  const native = fromNativeJsonSchema(schema);
  if (native) return native;

  const shape = getShape(schema);
  const properties: Record<string, unknown> = {};
  if (shape) {
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value);
    }
  }
  return {
    type: 'object',
    properties: properties as ToolParametersSchema['properties'],
    required: requiredFromShape(schema),
  };
}

/** Validate input with a Zod-like schema, or pass it through for JSON Schema. */
export function parseToolInputSchema<T>(schema: unknown, input: unknown): ToolSchemaParseResult<T> {
  const candidate = schema as ZodLikeSchema | null;
  if (typeof candidate?.safeParse !== 'function') {
    return { ok: true, data: input as T };
  }
  const parsed = candidate.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as T };

  const issues = parsed.error?.issues ?? parsed.error?.errors ?? [];
  const error = issues
    .map((issue) => `${(issue.path ?? []).join('.') || 'root'}: ${issue.message ?? 'invalid'}`)
    .join('; ');
  return { ok: false, error: error || 'Invalid arguments' };
}

export interface CreateToolFromZodOptions {
  tags?: string[];
  keywords?: string[];
  source?: string;
  hidden?: boolean;
  kind?: string;
}

/**
 * 从 Zod 模式创建 Tool，便于类型安全与校验。
 * 需要安装 zod：pnpm add zod。传入的 schema 应为 z.object({ ... })。
 */
export function createToolFromZod<T extends Record<string, any>>(
  name: string,
  description: string,
  schema: any,
  execute: (args: T, message?: Message<any>) => MaybePromise<any>,
  options?: CreateToolFromZodOptions
): Tool {
  if (!schema?.safeParse) {
    throw new Error('createToolFromZod: schema must be a Zod object schema (e.g. z.object({ ... })). Install zod: pnpm add zod');
  }
  const parameters = toolInputSchemaToParameters(schema);
  return {
    name,
    description,
    parameters,
    execute: async (args: Record<string, any>, message?: Message<any>) => {
      const parsed = parseToolInputSchema<T>(schema, args);
      if (!parsed.ok) return `Error: ${parsed.error}`;
      return execute(parsed.data, message);
    },
    tags: options?.tags,
    keywords: options?.keywords,
    source: options?.source,
    hidden: options?.hidden,
    kind: options?.kind,
  };
}
