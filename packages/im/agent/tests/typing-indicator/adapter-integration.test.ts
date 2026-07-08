import { describe, it, expect } from 'vitest';
import {
  PLATFORM_FEATURES,
  buildTypingSendContent,
} from '../../src/typing-indicator/adapter-integration.js';

describe('buildTypingSendContent', () => {
  it('QQ 群聊应附带 reply 引用', () => {
    const content = buildTypingSendContent('qq', {
      platform: 'qq',
      endpointId: 'zhin',
      sessionId: 'qq:zhin:group:g1#u1',
      messageId: 'msg-trigger',
      sceneType: 'group',
      groupId: 'g1',
    }, '正在处理中...');

    expect(content).toEqual([
      { type: 'reply', data: { id: 'msg-trigger' } },
      { type: 'text', data: { text: '正在处理中...' } },
    ]);
  });

  it('QQ 群聊无 messageId 时应跳过发送', () => {
    expect(buildTypingSendContent('qq', {
      platform: 'qq',
      endpointId: 'zhin',
      sessionId: 'qq:zhin:group:g1#u1',
      sceneType: 'group',
      groupId: 'g1',
    }, '正在处理中...')).toBeNull();
  });
});

describe('PLATFORM_FEATURES', () => {
  it('icqq 支持 reaction', () => {
    expect(PLATFORM_FEATURES.icqq?.supportsReaction).toBe(true);
    expect(PLATFORM_FEATURES.icqq?.defaultType).toBe('reaction');
  });

  it('qq 默认 message', () => {
    expect(PLATFORM_FEATURES.qq?.supportsReaction).toBe(false);
    expect(PLATFORM_FEATURES.qq?.defaultType).toBe('message');
  });
});
