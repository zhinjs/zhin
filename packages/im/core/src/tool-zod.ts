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

import type { Tool, ToolContext, ToolParametersSchema } from './types.js';

type MaybePromise<T> = T | Promise<T>;

function zodFieldToJsonSchema(z: any): Record<string, unknown> {
  if (!z || !z._def) return { type: 'string' };
  const def = z._def;
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

function zodToJsonSchema(schema: any): ToolParametersSchema {
  const result: ToolParametersSchema = {
    type: 'object',
    properties: {} as ToolParametersSchema['properties'],
    required: [],
  };
  if (!schema || !schema.shape) return result;
  const shape = schema.shape;
  const properties = result.properties as Record<string, any>;
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as any;
    properties[key] = zodFieldToJsonSchema(zodValue);
    const typeName = zodValue?._def?.typeName;
    if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') {
      required.push(key);
    }
  }
  result.required = required.length > 0 ? required : undefined;
  return result;
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
  execute: (args: T, context?: ToolContext) => MaybePromise<any>,
  options?: CreateToolFromZodOptions
): Tool {
  if (!schema?.safeParse) {
    throw new Error('createToolFromZod: schema must be a Zod object schema (e.g. z.object({ ... })). Install zod: pnpm add zod');
  }
  const parameters = zodToJsonSchema(schema);
  return {
    name,
    description,
    parameters,
    execute: async (args: Record<string, any>, context?: ToolContext) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const msg = parsed.error.errors?.map((e: any) => `${e.path?.join('.') ?? 'root'}: ${e.message}`).join('; ') ?? 'Invalid arguments';
        return `Error: ${msg}`;
      }
      return execute(parsed.data as T, context);
    },
    tags: options?.tags,
    keywords: options?.keywords,
    source: options?.source,
    hidden: options?.hidden,
    kind: options?.kind,
  };
}

