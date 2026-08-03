import { describe, expect, it } from 'vitest';
import { normalizeQqMessage } from '../src/ws.js';

describe('normalizeQqMessage channel kind detection', () => {
  it('detects group when message_type is "group"', () => {
    const result = normalizeQqMessage({
      message_id: '1',
      message_type: 'group',
      group_id: 'g-100',
      user_id: 'u-1',
      raw_message: 'hi',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('group');
    expect(result!.channelId).toBe('g-100');
  });

  it('detects group via group_openid when message_type is absent', () => {
    const result = normalizeQqMessage({
      message_id: '2',
      group_openid: 'open-g-200',
      author: { member_openid: 'open-u-1', username: 'Alice' },
      message: 'hello from group',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('group');
    expect(result!.channelId).toBe('open-g-200');
  });

  it('detects group via group_id when message_type is absent', () => {
    const result = normalizeQqMessage({
      message_id: '3',
      group_id: 'g-300',
      user_id: 'u-2',
      raw_message: 'test',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('group');
    expect(result!.channelId).toBe('g-300');
  });

  it('detects guild channel when message_type is "guild"', () => {
    const result = normalizeQqMessage({
      message_id: '4',
      message_type: 'guild',
      channel_id: 'ch-1',
      guild_id: 'guild-1',
      user_id: 'u-3',
      raw_message: 'guild msg',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('channel');
    expect(result!.channelId).toBe('ch-1');
  });

  it('detects guild channel via guild_id + channel_id when message_type is absent', () => {
    const result = normalizeQqMessage({
      message_id: '5',
      channel_id: 'ch-2',
      guild_id: 'guild-2',
      author: { id: 'u-4', username: 'Bob' },
      raw_message: 'guild no type',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('channel');
    expect(result!.channelId).toBe('ch-2');
  });

  it('detects direct message when message_type is "guild" with sub_type "direct"', () => {
    const result = normalizeQqMessage({
      message_id: '6',
      message_type: 'guild',
      sub_type: 'direct',
      guild_id: 'guild-3',
      user_id: 'u-5',
      raw_message: 'dm',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('direct');
    expect(result!.channelId).toBe('guild-3');
  });

  it('defaults to private when no group/guild indicators are present', () => {
    const result = normalizeQqMessage({
      message_id: '7',
      user_id: 'u-6',
      raw_message: 'private msg',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('private');
    expect(result!.channelId).toBe('u-6');
  });

  it('defaults to private via author.user_openid when message_type is absent', () => {
    const result = normalizeQqMessage({
      message_id: '8',
      author: { user_openid: 'open-u-8', username: 'Carol' },
      message: 'private openid',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('private');
    expect(result!.channelId).toBe('open-u-8');
  });

  it('prefers group_openid over group_id for channelId', () => {
    const result = normalizeQqMessage({
      message_id: '9',
      group_id: 'g-fallback',
      group_openid: 'open-g-primary',
      user_id: 'u-9',
      raw_message: 'both ids',
    });
    expect(result).not.toBeNull();
    expect(result!.channelKind).toBe('group');
    expect(result!.channelId).toBe('g-fallback');
  });
});
