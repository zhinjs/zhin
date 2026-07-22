import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toRegisteredAgentTool } from '../../src/plugin-runtime/agent-host-installer.js';

const zodLikeSchema = {
  shape: {
    game: { _def: { typeName: 'ZodString' } },
    count: { _def: { typeName: 'ZodOptional', innerType: { _def: { typeName: 'ZodNumber' } } } },
  },
  safeParse(value: unknown) {
    const input = (value ?? {}) as { game?: unknown };
    if (typeof input.game !== 'string') {
      return {
        success: false as const,
        error: { issues: [{ path: ['game'], message: 'Required' }] },
      };
    }
    return { success: true as const, data: input };
  },
};

describe('toRegisteredAgentTool', () => {
  it('converts zod-like inputSchema to catalog parameters', () => {
    const tool = toRegisteredAgentTool({
      name: 'lottery_history',
      description: 'Query historical lottery draws',
      inputSchema: zodLikeSchema,
      source: 'lottery',
      execute: () => 'ok',
    });

    expect(tool.name).toBe('lottery_history');
    expect(tool.source).toBe('lottery');
    expect(tool.parameters.required).toEqual(['game']);
    expect(tool.parameters.properties).toMatchObject({
      game: { type: 'string' },
      count: { type: 'number' },
    });
  });

  it('validates args through zod-like safeParse before execute', async () => {
    const tool = toRegisteredAgentTool({
      name: 'lottery_history',
      description: 'Query historical lottery draws',
      inputSchema: zodLikeSchema,
      execute: (input) => `ok:${String(input.game)}`,
    });

    await expect(tool.execute({})).resolves.toBe('Error: game: Required');
    await expect(tool.execute({ game: 'ssq' })).resolves.toBe('ok:ssq');
  });

  it('preserves types, optional fields, and validation errors from Zod 4', async () => {
    const tool = toRegisteredAgentTool({
      name: 'search',
      description: 'Search records',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().optional(),
        mode: z.enum(['fast', 'safe']),
      }),
      execute: (input) => input,
    });

    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
        mode: { type: 'string', enum: ['fast', 'safe'] },
      },
      required: ['query', 'mode'],
    });
    await expect(tool.execute({ query: '', mode: 'fast' })).resolves.toContain('query:');
  });

  it('passes args through when inputSchema is not zod-like', async () => {
    const tool = toRegisteredAgentTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: (input) => input,
    });

    await expect(tool.execute({ text: 'hi' })).resolves.toEqual({ text: 'hi' });
  });
});
