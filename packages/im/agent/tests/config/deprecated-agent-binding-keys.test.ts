import { describe, it, expect, vi } from 'vitest';
import { findDeprecatedAgentBindingKeys } from '../../src/config/index.js';

describe('findDeprecatedAgentBindingKeys', () => {
  it('lists priority / match per agent and ignores everything else', () => {
    expect(findDeprecatedAgentBindingKeys({
      zhin: { provider: 'p', model: 'm' },
      vision: { provider: 'p', model: 'v', priority: 10, match: { hasMedia: ['image'] } },
      planner: { provider: 'p', model: 'x', match: [{ scene: 'group' }] },
    }).map(({ agent, key }) => `${agent}.${key}`)).toEqual([
      'vision.priority',
      'vision.match',
      'planner.match',
    ]);
    expect(findDeprecatedAgentBindingKeys(undefined)).toEqual([]);
    expect(findDeprecatedAgentBindingKeys([])).toEqual([]);
  });

  it('AIService accepts the fields with a deprecation warning', async () => {
    const warn = vi.fn();
    vi.resetModules();
    vi.doMock('@zhin.js/logger', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@zhin.js/logger')>();
      return {
        ...actual,
        getLogger: (name: string) => {
          const logger = actual.getLogger(name);
          return new Proxy(logger, {
            get: (target, prop, receiver) => (prop === 'warn' ? warn : Reflect.get(target, prop, receiver)),
          });
        },
      };
    });
    try {
      const { AIService } = await import('../../src/service.js');
      const service = new AIService({
        agents: {
          zhin: { priority: 1 },
          vision: { match: { hasMedia: ['image'] } },
        },
      } as never);
      expect(service.getBindingRegistry().getBinding('vision')).toMatchObject({ name: 'vision', mcpServers: [] });
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.startsWith('ai.agents.zhin.priority 已弃用'))).toBe(true);
      expect(messages.some((m) => m.startsWith('ai.agents.vision.match 已弃用'))).toBe(true);
    } finally {
      vi.doUnmock('@zhin.js/logger');
      vi.resetModules();
    }
  });
});
