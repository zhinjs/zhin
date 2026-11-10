import { describe, expect, it } from 'vitest';
import {
  decodeSatoriContent,
  formatSatoriOutbound,
  mapGuildEmojiNotice,
  satoriMessageCreateParams,
  withSatoriReferrer,
  type SatoriEventBody,
} from '../src/protocol.js';

describe('satori element codec', () => {
  it('encodes at, emoji and img instead of plain text', () => {
    expect(formatSatoriOutbound([
      { type: 'mention', data: { target: 'user-1', name: 'Alice' } },
      { type: 'at', data: { id: 'user-2', role: 'admin', type: 'all' } },
      { type: 'emoji', data: { id: 'smile', name: 'Smile' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png?x=1&y=2' }, name: 'A "pic"' } },
    ])).toBe(
      '<at id="user-1" name="Alice"/>'
      + '<at id="user-2" role="admin" type="all"/>'
      + '<emoji id="smile" name="Smile"/>'
      + '<img src="https://example.com/a.png?x=1&amp;y=2" title="A &quot;pic&quot;"/>',
    );
  });

  it('encodes @all and escapes text inside a segment list', () => {
    expect(formatSatoriOutbound([
      { type: 'mention', data: { target: 'all' } },
      'a<b&c',
    ])).toBe('<at type="all"/>a&lt;b&amp;c');
  });

  it('leaves a raw string payload untouched', () => {
    expect(formatSatoriOutbound('<at id="already"/>')).toBe('<at id="already"/>');
  });

  it('decodes at, img and emoji, including paired tags and entities', () => {
    expect(decodeSatoriContent(
      'hi <at id="user-1" name="A &amp; B"/> <img src="base64://aGk=" title="pic"/>'
      + '<emoji id="smile" name="Smile"></emoji> <at type="here">online</at>',
    )).toEqual([
      { type: 'text', data: { text: 'hi ' } },
      { type: 'mention', data: { target: 'user-1', name: 'A & B' } },
      { type: 'text', data: { text: ' ' } },
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=' }, name: 'pic' } },
      { type: 'emoji', data: { id: 'smile', name: 'Smile' } },
      { type: 'text', data: { text: ' ' } },
      { type: 'mention', data: { target: 'here', type: 'here' } },
      { type: 'text', data: { text: 'online' } },
    ]);
  });

  it('round-trips mention, emoji and media elements', () => {
    const payload = [
      { type: 'mention', data: { target: 'user-1', name: 'Alice' } },
      { type: 'emoji', data: { id: 'smile', name: 'Smile' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' }, name: 'pic' } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' }, duration: 3 } },
    ];
    expect(decodeSatoriContent(formatSatoriOutbound(payload))).toEqual([
      { type: 'mention', data: { target: 'user-1', name: 'Alice' } },
      { type: 'emoji', data: { id: 'smile', name: 'Smile' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' }, name: 'pic' } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' }, duration: 3 } },
    ]);
  });
});

describe('satori referrer', () => {
  it('returns the source referrer unchanged only inside the inbound turn', () => {
    const referrer = {
      type: 'im.message.receive_v1',
      event: { message: { message_id: 'xxxxxxxx', thread_id: 'thread-1' } },
    };
    expect(satoriMessageCreateParams('ch-1', 'later')).toEqual({
      channel_id: 'ch-1',
      content: 'later',
    });
    withSatoriReferrer(referrer, () => {
      expect(satoriMessageCreateParams('ch-1', 'reply')).toEqual({
        channel_id: 'ch-1',
        content: 'reply',
        referrer,
      });
    });
    expect(satoriMessageCreateParams('ch-1', 'after').referrer).toBeUndefined();
  });
});

describe('satori guild emoji events', () => {
  it.each([
    ['guild-emoji-added', 'notice.group.emoji_added'],
    ['guild-emoji-updated', 'notice.group.emoji_updated'],
    ['guild-emoji-deleted', 'notice.group.emoji_deleted'],
  ] as const)('maps %s to %s', (type, name) => {
    const body: SatoriEventBody = {
      type,
      sn: 4,
      timestamp: 1_700_000_000_000,
      login: { platform: 'test', user: { id: 'bot-1' } },
      guild: { id: 'guild-1' },
      emoji: { id: 'emoji-1', name: 'smile' },
      operator: { id: 'user-1', name: 'alice' },
    };
    expect(mapGuildEmojiNotice(body, 'satori-bot')).toMatchObject({
      type: 'notice',
      name,
      endpointId: 'satori-bot',
      value: 'smile',
      actor: { id: 'user-1', name: 'alice' },
      timestamp: 1_700_000_000_000,
      metadata: expect.objectContaining({
        type,
        emoji: { id: 'emoji-1', name: 'smile' },
      }),
    });
    expect(mapGuildEmojiNotice(body, 'satori-bot')?.conversation).toBeUndefined();
  });

  it('ignores a guild emoji event without an emoji id', () => {
    expect(mapGuildEmojiNotice({
      type: 'guild-emoji-added',
      emoji: { id: '' },
    }, 'satori-bot')).toBeUndefined();
    expect(mapGuildEmojiNotice({ type: 'message-created' }, 'satori-bot')).toBeUndefined();
  });
});
