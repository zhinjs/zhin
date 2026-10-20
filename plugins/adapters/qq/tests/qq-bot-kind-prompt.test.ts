import { describe, expect, it } from 'vitest';
import {
  parseQqBotKindAnswer,
  qqCommandSessionKey,
} from '../src/qq-bot-kind-prompt.js';

describe('parseQqBotKindAnswer', () => {
  it('识别 public/private 与中文', () => {
    expect(parseQqBotKindAnswer('public')).toBe('public');
    expect(parseQqBotKindAnswer('PRIVATE')).toBe('private');
    expect(parseQqBotKindAnswer('公域')).toBe('public');
    expect(parseQqBotKindAnswer('私域')).toBe('private');
    expect(parseQqBotKindAnswer('1')).toBe('public');
    expect(parseQqBotKindAnswer('2')).toBe('private');
    expect(parseQqBotKindAnswer('maybe')).toBeUndefined();
  });
});

describe('qqCommandSessionKey', () => {
  it('从 CommandMessage 拼会话键', () => {
    expect(
      qqCommandSessionKey({
        conversation: {
          endpoint: { adapter: 'sandbox', id: 'bot' },
          kind: 'private',
          id: 'u1',
        },
        sender: 'u1',
      }),
    ).toBe('sandbox\0bot\0private\0u1\0u1');
  });

  it('缺字段时返回 undefined', () => {
    expect(qqCommandSessionKey({})).toBeUndefined();
    expect(qqCommandSessionKey(undefined)).toBeUndefined();
  });
});
