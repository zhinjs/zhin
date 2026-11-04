import { describe, it, expect } from 'vitest';
import { buildTypingSendContent } from '../../src/typing-indicator/adapter-integration.js';

const options = {
  platform: 'any',
  endpointKey: 'zhin',
  sessionId: 'any:zhin:group:g1#u1',
  messageId: 'msg-trigger',
  sceneType: 'group' as const,
  groupId: 'g1',
};

describe('buildTypingSendContent (driven by delivery.proactive, not the platform name)', () => {
  it('quotes the trigger message where the Endpoint forbids unsolicited messages', () => {
    expect(buildTypingSendContent({ needsReply: true }, options, '正在处理中...')).toEqual([
      { type: 'reply', data: { id: 'msg-trigger' } },
      { type: 'text', data: { text: '正在处理中...' } },
    ]);
  });

  it('skips sending when a quote is required but there is no trigger message', () => {
    const { messageId: _omit, ...withoutMessage } = options;
    expect(buildTypingSendContent({ needsReply: true }, withoutMessage, '正在处理中...')).toBeNull();
  });

  it('sends plain text when the capability is absent or not required', () => {
    const plain = [{ type: 'text', data: { text: 'x' } }];
    expect(buildTypingSendContent({ needsReply: false }, options, 'x')).toEqual(plain);
    expect(buildTypingSendContent(undefined, options, 'x')).toEqual(plain);
  });
});
