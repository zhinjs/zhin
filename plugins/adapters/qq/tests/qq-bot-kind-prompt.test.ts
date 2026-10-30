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
        sender: { id: 'u1' },
      }),
    ).toBeTruthy();
  });

  it('缺字段时返回 undefined', () => {
    expect(qqCommandSessionKey({})).toBeUndefined();
    expect(qqCommandSessionKey(undefined)).toBeUndefined();
  });
});


it('pins reply parsing to the flow language and keys every canonical identity dimension', () => {
  expect(parseQqBotKindAnswer('公域', 'en')).toBeUndefined();
  expect(parseQqBotKindAnswer('PRIVATE', 'en')).toBe('private');
  const message = { sender: { id: 'alice' }, conversation: { endpoint: { adapter: 'qq', id: 'bot' },
    kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'thread' } };
  const key = qqCommandSessionKey(message);
  expect(key).toBeTruthy();
  for (const other of [
    { ...message, sender: { id: 'bob' } },
    { ...message, conversation: { ...message.conversation, threadId: 'other-thread' } },
    { ...message, conversation: { ...message.conversation, parent: { kind: 'channel', id: 'other-guild' } } },
    { ...message, conversation: { ...message.conversation, endpoint: { adapter: 'qq', id: 'other-bot' } } },
    { ...message, conversation: { ...message.conversation, endpoint: { adapter: 'other-platform', id: 'bot' } } },
    { ...message, conversation: { ...message.conversation, kind: 'private' } },
    { ...message, conversation: { ...message.conversation, id: 'other-room' } },
  ]) expect(qqCommandSessionKey(other)).not.toBe(key);
  expect(qqCommandSessionKey({ ...message, sender: {} })).toBeUndefined();
  expect(qqCommandSessionKey({ ...message, sender: { id: '  ' } })).toBeUndefined();
});
