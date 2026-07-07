import { describe, it, expect } from 'vitest';
import { matchRouteRule, normalizeMatchRules, resolveRoutedAgentName } from '../../src/routing/route-matcher.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../../src/config/types.js';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    $adapter: 'sandbox',
    $endpoint: 'b1',
    $sender: { id: 'u1' },
    $channel: { id: 'c1', type: 'private' },
    $content: [{ type: 'text', data: { text: 'hi' } }],
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

  it('有图且存在 vision.agent.md 时命中 vision', () => {
    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
      vision: {
        provider: 'p',
        model: 'vl',
        priority: 100,
        match: { hasMedia: ['image'] },
      },
    }, {
      message: makeMessage({
        $content: [{ type: 'image', data: { url: 'https://x/img.png' } }],
      }),
      contentText: '',
      discoveredAgentNames: new Set(['vision']),
    });
    expect(name).toBe('vision');
  });

  it('无 vision 文件时跳过 route', () => {
    const name = resolveRoutedAgentName({
      zhin: { provider: 'p', model: 'm' },
      vision: {
        provider: 'p',
        model: 'vl',
        priority: 100,
        match: { hasMedia: ['image'] },
      },
    }, {
      message: makeMessage({
        $content: [{ type: 'image', data: { url: 'https://x/img.png' } }],
      }),
      contentText: '',
      discoveredAgentNames: new Set(),
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

    const privateMsg = makeMessage({ $endpoint: '717505091' });
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
      $endpoint: '717505091',
      $channel: { id: '129043431', type: 'group' },
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

  it('endpoint 可通过 endpointIds 别名命中', () => {
    const groupMsg = makeMessage({
      $endpoint: 'internal-key',
      $channel: { id: '129043431', type: 'group' },
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
      endpointIds: ['717505091', 'internal-key'],
    });
    expect(name).toBe('reviewer');
  });
});
