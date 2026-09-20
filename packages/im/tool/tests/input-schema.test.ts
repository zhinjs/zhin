import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  isToolInputSchema,
  parseToolInputSchema,
  toolInputSchemaToParameters,
} from '../src/input-schema.js';
import { defineAgentTool } from '../src/definition.js';

describe('Tool input schema', () => {
  it('projects a Zod 4 object through its public JSON Schema operation', () => {
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

  it('normalizes a JSON object schema without changing its keywords', () => {
    const schema = {
      type: 'object' as const,
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    };

    expect(toolInputSchemaToParameters(schema)).toEqual(schema);
  });

  it('rejects the removed Zod 3 structural representation', () => {
    const schema = {
      shape: { query: { _def: { typeName: 'ZodString' } } },
    };

    expect(isToolInputSchema(schema)).toBe(false);
    expect(() => toolInputSchemaToParameters(schema as never)).toThrow(
      'Agent Tool inputSchema must produce an object JSON Schema',
    );
  });

  it('rejects malformed object JSON Schema instead of repairing it', () => {
    expect(isToolInputSchema({
      type: 'object',
      properties: {},
      required: ['query', 1],
    })).toBe(false);
  });

  it('rejects executable schemas whose public projection is not an object', () => {
    expect(() => defineAgentTool({
      description: 'Invalid scalar input',
      inputSchema: z.string(),
      execute: () => 'unused',
    })).toThrow('Agent Tool inputSchema must be an object JSON Schema or executable schema');
  });

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
