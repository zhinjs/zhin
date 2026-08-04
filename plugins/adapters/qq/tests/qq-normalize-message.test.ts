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

describe('normalizeQqMessage mentioned detection (unified mentions check)', () => {
  const BOT_MENTION = {
    bot: true,
    id: '17DCE6AF658774F3582FF7D516A0C084',
    is_you: true,
    member_openid: '17DCE6AF658774F3582FF7D516A0C084',
    member_role: 'member',
    scope: 'single',
    username: 'zhin',
  };

  it('群消息 @ 当前机器人（is_you: true）→ mentioned', () => {
    const result = normalizeQqMessage({
      message_id: '10',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1', username: 'Cc' },
      raw_message: '你主人欺负我怎么办',
      mentions: [BOT_MENTION],
    });
    expect(result!.channelKind).toBe('group');
    expect(result!.mentioned).toBe(true);
  });

  it('群消息无 mentions（GROUP_MESSAGE_CREATE 非 @）→ 不置 mentioned', () => {
    const result = normalizeQqMessage({
      message_id: '11',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1', username: 'Cc' },
      raw_message: '随便聊聊',
    });
    expect(result!.channelKind).toBe('group');
    expect(result!.mentioned).toBeUndefined();
  });

  it('群消息只 @ 了普通用户 → 不置 mentioned', () => {
    const result = normalizeQqMessage({
      message_id: '12',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1', username: 'Cc' },
      raw_message: '@某人 看一下',
      mentions: [{ id: 'u-other', member_openid: 'open-u-other', member_role: 'member' }],
    });
    expect(result!.mentioned).toBeUndefined();
  });

  it('群消息 @ 另一个机器人（bot:true 无 is_you）→ 不置 mentioned', () => {
    const result = normalizeQqMessage({
      message_id: '12b',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1', username: 'Cc' },
      raw_message: '@别的机器人 在吗',
      mentions: [{ id: 'OTHER_BOT_OPENID', bot: true, member_openid: 'OTHER_BOT_OPENID' }],
    });
    expect(result!.channelKind).toBe('group');
    expect(result!.mentioned).toBeUndefined();
  });

  it('频道 AT 事件 mentions[].bot（无 is_you）→ mentioned（兼容回退）', () => {
    const result = normalizeQqMessage({
      message_id: '13',
      message_type: 'guild',
      channel_id: 'ch-1',
      guild_id: 'guild-1',
      author: { id: 'u-1', username: 'Bob' },
      raw_message: '频道 @ 机器人',
      mentions: [{ id: 'bot-1', bot: true }],
    });
    expect(result!.channelKind).toBe('channel');
    expect(result!.mentioned).toBe(true);
  });

  it('私聊无 mentions → 不置 mentioned', () => {
    const result = normalizeQqMessage({
      message_id: '14',
      author: { user_openid: 'open-u-9', username: 'Carol' },
      message: 'private',
    });
    expect(result!.channelKind).toBe('private');
    expect(result!.mentioned).toBeUndefined();
  });
});

describe('normalizeQqMessage canonical segments extraction', () => {
  it('文本 + at + 图片附件 → canonical Segment[]', () => {
    const result = normalizeQqMessage({
      message_id: '20',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1', username: 'Cc' },
      raw_message: '看图',
      message: [
        { type: 'at', data: { user_id: 'BOT_ID', username: 'zhin' } },
        { type: 'text', data: { text: '看图' } },
        { type: 'image', data: { url: 'https://cdn.example/a.jpg', name: 'a.jpg', size: 1024 } },
      ],
      mentions: [{ id: 'BOT_ID', bot: true, is_you: true, member_openid: 'BOT_ID' }],
    });
    expect(result!.segments).toEqual([
      { type: 'mention', data: { target: 'BOT_ID', name: 'zhin' } },
      { type: 'text', data: { text: '看图' } },
      {
        type: 'image',
        data: {
          media: {
            kind: 'url',
            value: 'https://cdn.example/a.jpg',
            mime_type: 'image/jpeg',
            file_name: 'a.jpg',
            size: 1024,
          },
        },
      },
    ]);
    expect(result!.content).toBe('看图');
  });

  it('语音/视频/文件附件 → audio/video/file 段', () => {
    const result = normalizeQqMessage({
      message_id: '21',
      message_type: 'group',
      group_openid: 'open-g-1',
      author: { member_openid: 'open-u-1' },
      message: [
        { type: 'audio', data: { url: 'https://cdn.example/a.amr' } },
        { type: 'video', data: { url: 'https://cdn.example/v.mp4' } },
        { type: 'file', data: { url: 'https://cdn.example/f.zip', name: 'f.zip' } },
      ],
    });
    expect(result!.segments).toEqual([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/a.amr', mime_type: 'audio/mpeg' } } },
      { type: 'video', data: { media: { kind: 'url', value: 'https://cdn.example/v.mp4', mime_type: 'video/mp4' } } },
      {
        type: 'file',
        data: {
          media: { kind: 'url', value: 'https://cdn.example/f.zip', file_name: 'f.zip' },
          name: 'f.zip',
        },
      },
    ]);
  });

  it('face / reply 段；纯文本消息不挂 segments 字段', () => {
    const withFace = normalizeQqMessage({
      message_id: '22',
      author: { user_openid: 'open-u-1' },
      message: [
        { type: 'face', data: { id: 14 } },
        { type: 'reply', data: { id: 'm-9' } },
      ],
    });
    expect(withFace!.segments).toEqual([
      { type: 'face', data: { id: 14 } },
      { type: 'reply', data: { message_id: 'm-9' } },
    ]);

    const textOnly = normalizeQqMessage({
      message_id: '23',
      author: { user_openid: 'open-u-1' },
      message: [{ type: 'text', data: { text: 'hi' } }],
    });
    expect(textOnly!.segments).toEqual([{ type: 'text', data: { text: 'hi' } }]);

    const stringMessage = normalizeQqMessage({
      message_id: '24',
      author: { user_openid: 'open-u-1' },
      message: 'plain',
    });
    expect(stringMessage!.segments).toBeUndefined();
  });
});
