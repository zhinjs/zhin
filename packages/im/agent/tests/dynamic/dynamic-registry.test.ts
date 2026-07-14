import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDynamicTurnOverrides,
  registerDynamicResolver,
  resetDynamicRegistryForTests,
} from '../../src/dynamic/dynamic-registry.js';

const tool = (name: string) => ({
  name,
  description: name,
  parameters: { type: 'object' as const, properties: {} },
  execute: async () => 'ok',
});

describe('dynamic-registry', () => {
  beforeEach(() => {
    resetDynamicRegistryForTests();
  });

  it('denies tools and merges instructions', async () => {
    registerDynamicResolver({
      pluginName: 'demo',
      resolve: async () => ({
        deniedToolNames: ['bash'],
        additionalInstructions: 'Tenant-specific rule.',
      }),
    });
    const result = await applyDynamicTurnOverrides({
      tools: [tool('bash'), tool('read_file')],
      ctx: {
        sessionId: 's1',
        userId: 'u1',
        adapter: 'test',
        commMessage: { $adapter: 'test' } as never,
      },
    });
    expect(result.tools.map((t) => t.name)).toEqual(['read_file']);
    expect(result.additionalInstructions).toContain('Tenant-specific');
  });
});
