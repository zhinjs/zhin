import { describe, expect, it } from 'vitest';
import { channelKey, messageFromCommandInput } from '../src/index.js';

const conversation = {
  endpoint: { id: 'root/test', adapter: 'test' },
  kind: 'group',
  id: 'room-1',
};

describe('messageFromCommandInput', () => {
  it('reads the structured runtime sender, so different players stay different players', () => {
    const alice = messageFromCommandInput({ conversation, sender: { id: 'alice', name: 'Alice' } });
    const bob = messageFromCommandInput({ conversation, sender: { id: 'bob' } });

    expect(alice.$sender).toEqual({ id: 'alice', name: 'Alice' });
    expect(bob.$sender).toEqual({ id: 'bob', name: 'bob' });
    expect(channelKey(alice)).toBe(channelKey(bob));
  });

  it('still accepts a bare sender id string', () => {
    const message = messageFromCommandInput({ conversation, sender: 'carol' });

    expect(message.$sender.id).toBe('carol');
  });

  it('preserves the operation locale without sharing it across players', () => {
    expect(messageFromCommandInput({ conversation, sender: 'alice', locale: 'en' }).locale).toBe('en');
    expect(messageFromCommandInput({ conversation, sender: 'bob', locale: 'zh-CN' }).locale).toBe('zh-CN');
    expect(messageFromCommandInput({ conversation, sender: 'carol' }).locale).toBe('zh-CN');
  });
});
