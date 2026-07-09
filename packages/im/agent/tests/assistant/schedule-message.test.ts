import { describe, expect, it } from 'vitest';
import { buildScheduleTurnMessage } from '../../src/assistant/schedule-message.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('buildScheduleTurnMessage', () => {
  it('creates synthetic message with source id and reply without mutating source', async () => {
    const reply = async () => 'reply-id';
    const source = mockCommMessage({ senderId: 'u1' });
    (source as { $id?: string }).$id = 'msg-42';
    (source as { $reply?: typeof reply }).$reply = reply;
    const originalExtra = { foo: 'bar' };
    source.extra = { ...originalExtra };

    const synthetic = buildScheduleTurnMessage({ sourceMessage: source });

    expect(synthetic.$id).toBe('msg-42');
    expect(synthetic.$sender.id).toBe('u1');
    expect(typeof synthetic.$reply).toBe('function');
    await expect(synthetic.$reply!('hello')).resolves.toBe('reply-id');
    expect(source.extra).toEqual(originalExtra);
    expect(synthetic.extra).toBeUndefined();
  });
});
