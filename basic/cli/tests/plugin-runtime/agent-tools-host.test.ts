import { describe, expect, it } from 'vitest';
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
