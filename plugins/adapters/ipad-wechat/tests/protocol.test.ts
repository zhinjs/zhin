import { describe, expect, it } from 'vitest';
import { planOutbound, projectInbound, resolveIpadWechatConfig } from '../src/protocol.js';
import { mediaSource } from '../src/client.js';
import { message } from './fake-sdk.js';

describe('resolveIpadWechatConfig', () => {
  it('applies defaults', () => {
    expect(resolveIpadWechatConfig({ id: 'bot' })).toEqual({
      id: 'bot', dataDir: 'data/ipad-wechat', loginTimeoutMs: 600_000, qrPollIntervalMs: 1_000,
      reconnect: true, ignoreSelfMessages: true, downloadImages: true,
    });
  });

  it('rejects invalid values', () => {
    expect(() => resolveIpadWechatConfig({ id: 'a b' })).toThrow(/endpoint id/u);
    expect(() => resolveIpadWechatConfig({ id: 'bot', qrPollIntervalMs: 50 })).toThrow(/qrPollIntervalMs/u);
    expect(() => resolveIpadWechatConfig({ id: 'bot', verification: { key: 'k', cert: 'c', publicOrigin: 'http://x' } }))
      .toThrow(/publicOrigin/u);
  });

  it('resolves verification defaults', () => {
    expect(resolveIpadWechatConfig({ id: 'bot', verification: { key: 'k.pem', cert: 'c.pem' } }).verification)
      .toEqual({ key: 'k.pem', cert: 'c.pem', host: '127.0.0.1', port: 8443, timeoutMs: 600_000 });
  });
});

describe('projectInbound', () => {
  it('maps a group text to the member sender', () => {
    const projection = projectInbound(message({ conversationId: '123@chatroom', senderId: '123@chatroom', groupSenderId: 'wxid_bob', body: 'hi' }));
    expect(projection).toEqual({
      conversation: { kind: 'group', id: '123@chatroom' }, senderId: 'wxid_bob', content: 'hi',
      segments: [{ type: 'text', data: { text: 'hi' } }],
    });
  });

  it('uses the downloaded file for images and a placeholder otherwise', () => {
    const image = message({ kind: 'image', body: '[image]', mediaHandle: 'opaque' });
    expect(projectInbound(image, { imagePath: '/tmp/a.jpg' }).segments)
      .toEqual([{ type: 'image', data: { media: { kind: 'path', value: '/tmp/a.jpg' } } }]);
    expect(projectInbound(image).content).toBe('[图片]');
    expect(projectInbound(message({ kind: 'voice', body: '[voice]', mediaHandle: 'h' })).content).toBe('[语音]');
  });
});

describe('planOutbound', () => {
  it('merges text and mentions, splitting at images', () => {
    const media = { kind: 'url', value: 'https://example.invalid/a.png' } as const;
    expect(planOutbound([
      { type: 'mention', data: { target: 'wxid_bob', name: 'Bob' } },
      { type: 'text', data: { text: ' hi' } },
      { type: 'image', data: { media } },
      'bye',
    ], true)).toEqual([
      { kind: 'text', text: '@Bob\u2005 hi', at: ['wxid_bob'] },
      { kind: 'image', media },
      { kind: 'text', text: 'bye', at: [] },
    ]);
  });

  it('does not send mention lists to private chats and drops reply markers', () => {
    expect(planOutbound([{ type: 'reply', data: { message_id: 'x' } }, { type: 'mention', data: { target: 'wxid_bob' } }, 'yo'], false))
      .toEqual([{ kind: 'text', text: '@wxid_bob\u2005yo', at: [] }]);
  });

  it('refuses segments it cannot send', () => {
    expect(() => planOutbound([{ type: 'audio', data: {} }], false)).toThrow(/unsupported/u);
  });
});

describe('mediaSource', () => {
  it('downloads URLs on this host through the outbound media fetch and normalizes base64', async () => {
    // The SDK uploads bytes from this host, so a URL is never handed to it (#1250 第 46 批).
    const fetchMedia = async () => ({ bytes: Buffer.from('png'), url: 'https://x.invalid/a.png' });
    await expect(mediaSource({ kind: 'url', value: 'https://x.invalid/a.png' }, undefined, fetchMedia)).resolves.toEqual(new Uint8Array(Buffer.from('png')));
    await expect(mediaSource({ kind: 'base64', value: 'data:image/png;base64,QUJD' })).resolves.toBe('base64://QUJD');
    await expect(mediaSource({ kind: 'base64', value: 'base64://QUJD' })).resolves.toBe('base64://QUJD');
  });
});
