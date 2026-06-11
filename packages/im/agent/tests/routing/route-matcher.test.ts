import { describe, it, expect } from 'vitest';
import { resolveRoutedAgentName } from '../../src/routing/route-matcher.js';
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
});
