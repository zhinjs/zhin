import { describe, it, expect } from 'vitest';
import { matchRouteRule, normalizeMatchRules, resolveRoutedAgentName } from '../../src/routing/route-matcher.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../../src/config/types.js';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    clientAdapter: 'sandbox',
    endpointId: 'b1',
    sender: { id: 'u1' },
    conversation: { endpoint: { adapter: 'sandbox', id: 'b1' }, id: 'c1', kind: 'private' },
    content: 'hi',
    segments: [{ type: 'text', data: { text: 'hi' } }],
    ...overrides,
  } as any;
}

describe('resolveRoutedAgentName', () => {
  it('无命中时返回 zhin', () => {
    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
    }, {
      message: makeMessage(),
      contentText: 'hello',
      discoveredAgentNames: new Set(['vision']),
    });
    expect(name).toBe(DEFAULT_ZHIN_AGENT_NAME);
  });

  it('ADR 0031 数组 match 不会误命中私聊', () => {
    const rules = normalizeMatchRules([
      { endpoint: '717505091', sceneId: '129043431', kind: 'group' },
    ] as never);
    expect(rules).toEqual([{
      endpoint: '717505091',
      sceneId: '129043431',
      scene: 'group',
    }]);

    const privateMsg = makeMessage({ endpointId: '717505091' });
    expect(matchRouteRule(rules[0]!, {
      message: privateMsg,
      contentText: '你好',
      discoveredAgentNames: new Set(['reviewer']),
    })).toBe(false);

    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
      reviewer: {
        provider: 'p',
        model: 'm',
        priority: 100,
        match: [{ endpoint: '717505091', sceneId: '129043431', kind: 'group' }] as never,
      },
    }, {
      message: privateMsg,
      contentText: '你好',
      discoveredAgentNames: new Set(['reviewer']),
    });
    expect(name).toBe(DEFAULT_ZHIN_AGENT_NAME);
  });

  it('ADR 0031 数组 match 可命中指定群', () => {
    const groupMsg = makeMessage({
      endpointId: '717505091',
      conversation: { endpoint: { adapter: 'sandbox', id: '717505091' }, id: '129043431', kind: 'group' },
    });
    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
      reviewer: {
        provider: 'p',
        model: 'm',
        priority: 100,
        match: [{ endpoint: '717505091', sceneId: '129043431', kind: 'group' }] as never,
      },
    }, {
      message: groupMsg,
      contentText: 'review this',
      discoveredAgentNames: new Set(['reviewer']),
    });
    expect(name).toBe('reviewer');
  });

  it('endpoint 可通过 endpointKeys 别名命中', () => {
    const groupMsg = makeMessage({
      endpointId: 'internal-key',
      conversation: { endpoint: { adapter: 'sandbox', id: 'internal-key' }, id: '129043431', kind: 'group' },
    });
    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
      reviewer: {
        provider: 'p',
        model: 'm',
        priority: 100,
        match: [{ endpoint: '717505091', sceneId: '129043431', kind: 'group' }] as never,
      },
    }, {
      message: groupMsg,
      contentText: 'review',
      discoveredAgentNames: new Set(['reviewer']),
      endpointKeys: ['717505091', 'internal-key'],
    });
    expect(name).toBe('reviewer');
  });

  it('快捷字段缺失时使用 canonical conversation endpoint', () => {
    const message = makeMessage({ clientAdapter: undefined, endpointId: undefined });
    expect(matchRouteRule({ adapter: 'sandbox', endpoint: 'b1' }, {
      message,
      contentText: 'review',
      discoveredAgentNames: new Set(),
    })).toBe(true);
  });
});
