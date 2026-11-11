import { describe, expect, it } from 'vitest';
import {
  mapSatoriFriendRequest,
  normalizeSatoriGuildRoles,
  readSatoriFriend,
  satoriReactionParams,
  withSatoriGuildRoles,
} from '../src/protocol.js';

describe('satori guild roles', () => {
  it('keeps GuildRole objects and coerces legacy string ids', () => {
    expect(normalizeSatoriGuildRoles([
      'role-1',
      { id: 'role-2', name: 'Admin', color: 1 },
      { name: 'missing-id' },
      3,
    ])).toEqual([
      { id: 'role-1' },
      { id: 'role-2', name: 'Admin' },
    ]);
    expect(withSatoriGuildRoles({
      user: { id: 'user-1' },
      nick: 'Alice',
      roles: ['role-1', { id: 'role-2', name: 'Admin' }],
    })).toEqual({
      user: { id: 'user-1' },
      nick: 'Alice',
      roles: [{ id: 'role-1' }, { id: 'role-2', name: 'Admin' }],
    });
  });
});

describe('satori friend resource', () => {
  it('reads { user, nick } and ignores a bare user object', () => {
    expect(readSatoriFriend({
      user: { id: 'user-1', name: 'alice', avatar: 'a' },
      nick: 'Ali',
    })).toEqual({
      user: { id: 'user-1', name: 'alice', avatar: 'a' },
      nick: 'Ali',
    });
    expect(readSatoriFriend({ id: 'legacy', name: 'old' })).toBeUndefined();
  });

  it('maps friend-request onto request.friend.add', async () => {
    const calls: Array<{ messageId: string; approve: boolean; comment?: string }> = [];
    const request = mapSatoriFriendRequest({
      type: 'friend-request',
      timestamp: 20,
      user: { id: 'user-9', name: 'neo' },
      message: { id: 'req-9', content: 'add me' },
    }, 'satori-bot', {
      approve: async (messageId, comment) => { calls.push({ messageId, approve: true, ...(comment !== undefined ? { comment } : {}) }); },
      reject: async (messageId, comment) => { calls.push({ messageId, approve: false, ...(comment !== undefined ? { comment } : {}) }); },
    });
    expect(request).toMatchObject({
      type: 'request',
      name: 'request.friend.add',
      endpointId: 'satori-bot',
      actor: { id: 'user-9', name: 'neo' },
      comment: 'add me',
      conversation: { kind: 'private', id: 'user-9' },
    });
    await request?.$approve('ok');
    await request?.$reject('no');
    expect(calls).toEqual([
      { messageId: 'req-9', approve: true, comment: 'ok' },
      { messageId: 'req-9', approve: false, comment: 'no' },
    ]);
  });

  it('still admits a friend request that has no message id, and refuses to approve it', async () => {
    const request = mapSatoriFriendRequest({
      type: 'friend-request',
      user: { id: 'user-9' },
    }, 'satori-bot', {
      approve: async () => undefined,
      reject: async () => undefined,
    });
    expect(request?.name).toBe('request.friend.add');
    await expect(request?.$approve()).rejects.toThrow(/message\.id/);
  });
});

describe('satori reaction params', () => {
  it('uses emoji_id for create, delete, clear and list', () => {
    expect(satoriReactionParams('create', { channelId: 'ch', messageId: 'm', emojiId: 'smile' })).toEqual({
      channel_id: 'ch',
      message_id: 'm',
      emoji_id: 'smile',
    });
    expect(satoriReactionParams('delete', {
      channelId: 'ch',
      messageId: 'm',
      emojiId: 'smile',
      userId: 'user-1',
    })).toEqual({
      channel_id: 'ch',
      message_id: 'm',
      emoji_id: 'smile',
      user_id: 'user-1',
    });
    expect(satoriReactionParams('clear', { channelId: 'ch', messageId: 'm', emojiId: 'smile' })).toEqual({
      channel_id: 'ch',
      message_id: 'm',
      emoji_id: 'smile',
    });
    expect(satoriReactionParams('clear', { channelId: 'ch', messageId: 'm' })).toEqual({
      channel_id: 'ch',
      message_id: 'm',
    });
    expect(satoriReactionParams('list', { channelId: 'ch', messageId: 'm', emojiId: 'smile', next: 'p2' })).toEqual({
      channel_id: 'ch',
      message_id: 'm',
      emoji_id: 'smile',
      next: 'p2',
    });
    for (const method of ['create', 'delete', 'clear', 'list'] as const) {
      expect(satoriReactionParams(method, { channelId: 'ch', messageId: 'm', emojiId: 'smile' })).not.toHaveProperty('emoji');
    }
  });
});
