import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createToolFromZod,
  parseToolInputSchema,
  toolInputSchemaToParameters,
} from '../src/tool-zod.js';

describe('toolInputSchemaToParameters', () => {
  it('converts a real Zod 4 object schema without losing field types', () => {
    const parameters = toolInputSchemaToParameters(z.object({
      name: z.string().describe('Display name'),
      count: z.number().int(),
      enabled: z.boolean().optional(),
      mode: z.enum(['fast', 'safe']),
      tags: z.array(z.string()),
      limit: z.number().default(3),
    }));

    expect(parameters.required).toEqual(['name', 'count', 'mode', 'tags']);
    expect(parameters.properties).toMatchObject({
      name: { type: 'string', description: 'Display name' },
      count: { type: 'integer' },
      enabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['fast', 'safe'] },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number', default: 3 },
    });
  });

  it('keeps JSON Schema input unchanged at the shared boundary', () => {
    const schema = {
      type: 'object' as const,
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    };

    expect(toolInputSchemaToParameters(schema)).toEqual(schema);
  });

  it('supports the legacy Zod 3 structural shape', () => {
    const schema = {
      shape: {
        query: { _def: { typeName: 'ZodString' } },
        count: {
          _def: {
            typeName: 'ZodOptional',
            innerType: { _def: { typeName: 'ZodNumber' } },
          },
        },
      },
    };

    expect(toolInputSchemaToParameters(schema)).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['query'],
    });
  });
});

describe('parseToolInputSchema', () => {
  it('formats Zod 4 issues and returns parsed defaults', () => {
    const schema = z.object({ name: z.string(), limit: z.number().default(3) });

    expect(parseToolInputSchema(schema, {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('name:'),
    });
    expect(parseToolInputSchema(schema, { name: 'Ada' })).toEqual({
      ok: true,
      data: { name: 'Ada', limit: 3 },
    });
  });
});

describe('createToolFromZod', () => {
  it('uses the shared conversion and validation path', async () => {
    const execute = vi.fn(({ count }: { count: number }) => count * 2);
    const tool = createToolFromZod(
      'double',
      'Double a number',
      z.object({ count: z.number() }),
      execute,
    );

    expect(tool.parameters.properties.count).toMatchObject({ type: 'number' });
    await expect(tool.execute({ count: '2' })).resolves.toContain('count:');
    await expect(tool.execute({ count: 2 })).resolves.toBe(4);
    expect(execute).toHaveBeenCalledOnce();
  });
});
