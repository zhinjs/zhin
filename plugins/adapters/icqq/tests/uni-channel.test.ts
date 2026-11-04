import { icqqFixture } from './fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService } from '@zhin.js/core/runtime';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import defineIcqqAdapter from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import { createIcqqTestPorts } from './_icqq-mock.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  id: '10001',
  autoReconnect: false,
});

const base64MediaConfig = resolveIcqqConfig({
  id: '10001',
  autoReconnect: false,
  outboundMedia: 'base64',
});

async function createEndpoint(
  receive: ReturnType<typeof vi.fn>,
  config = baseConfig,
) {
  const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
  return await icqqFixture({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config,
    ...createIcqqTestPorts(),
  }, gateway, undefined);
}

afterEach(() => {
});

describe('UNI-Channel 入站：CQ/元素 → canonical segments', () => {
  it('元素数组归一为 canonical 段，content 保留 CQ 原文', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = await createEndpoint(receive);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-seg',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      raw_message: 'hi[at:3][face:14]',
      message: [
        { type: 'text', text: 'hi' },
        { type: 'at', qq: 3 },
        { type: 'face', id: 14 },
        { type: 'image', url: 'https://x/a.jpg', file: 'https://x/a.jpg' },
        { type: 'record', file: 'https://x/a.amr' },
      ],
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const inbound = receive.mock.calls[0]?.[0] as {
      content: string;
      segments: Array<{ type: string; data: Record<string, unknown> }>;
    };
    expect(inbound.content).toBe('hi[at:3][face:14]');
    expect(inbound.segments).toBeDefined();
    const [text, mention, face, image, audio] = inbound.segments;
    expect(text).toEqual({ type: 'text', data: { text: 'hi' } });
    expect(mention).toEqual({ type: 'mention', data: { target: '3' } });
    expect(face).toMatchObject({ type: 'face', data: { id: 14 } });
    expect(image).toMatchObject({
      type: 'image',
      data: { media: { kind: 'url', value: 'https://x/a.jpg' } },
    });
    expect(audio).toMatchObject({
      type: 'audio',
      data: { media: { kind: 'url', value: 'https://x/a.amr' } },
    });
    await endpoint.stop();
  });

  it('在 endpoint lease 内解析 ICQQ 私有语音/视频引用后再进入 Gateway', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = await createEndpoint(receive);
    vi.mocked(endpoint.endpoint.pickGroup).mockReturnValue({
      getPttUrl: vi.fn(async () => 'https://cdn.example/voice.silk'),
      getVideoUrl: vi.fn(async () => 'https://cdn.example/video.mp4'),
    } as never);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-native-media',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      raw_message: '[语音][视频]',
      message: [
        { type: 'record', file: 'protobuf://voice', fid: 'ptt-1' },
        { type: 'video', file: 'protobuf://video', fid: 'video-1', md5: 'abcd' },
      ],
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const inbound = receive.mock.calls[0]?.[0] as {
      segments: Array<{ type: string; data: Record<string, unknown> }>;
    };
    expect(inbound.segments).toMatchObject([
      { type: 'audio', data: { media: { kind: 'url', value: 'https://cdn.example/voice.silk' } } },
      { type: 'video', data: { media: { kind: 'url', value: 'https://cdn.example/video.mp4' } } },
    ]);
    await endpoint.stop();
  });

  it('generation close 等待已经接纳的媒体解析，不丢失旧代入站', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = await createEndpoint(receive);
    let resolvePtt!: (url: string) => void;
    const pttUrl = new Promise<string>((resolve) => { resolvePtt = resolve; });
    vi.mocked(endpoint.endpoint.pickGroup).mockReturnValue({
      getPttUrl: vi.fn(() => pttUrl),
      getVideoUrl: vi.fn(async () => null),
    } as never);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-media-during-close',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      raw_message: '[语音]',
      message: [{ type: 'record', file: 'protobuf://voice' }],
    });

    let closeSettled = false;
    const closing = endpoint.close().then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(receive).not.toHaveBeenCalled();

    resolvePtt('https://cdn.example/voice.silk');
    await closing;
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive.mock.calls[0]?.[0]).toMatchObject({
      segments: [{
        type: 'audio',
        data: { media: { kind: 'url', value: 'https://cdn.example/voice.silk' } },
      }],
    });
    await endpoint.stop();
  });

  it('quote 元数据（oicq source）归一为 reply 段置于段首', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = await createEndpoint(receive);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-quote-seg',
      raw_message: '收到',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      source: {
        message_id: 'quoted-1',
        user_id: 3,
        sender: { user_id: 3, nickname: 'alice' },
        message: [{ type: 'text', text: '原文内容' }],
        time: 1_699_999_000,
      },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const inbound = receive.mock.calls[0]?.[0] as {
      segments: Array<{ type: string; data: Record<string, unknown> }>;
      replyTo?: { id: string };
    };
    expect(inbound.segments[0]).toEqual({
      type: 'reply',
      data: { message_id: 'quoted-1' },
    });
    expect(inbound.replyTo).toEqual({ id: 'quoted-1' });
    await endpoint.stop();
  });

  it('结构化段的 mention 可用于 @ 本机判定（raw_message 缺失时）', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = await createEndpoint(receive);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-at-seg',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      message: [
        { type: 'at', qq: 10001 },
        { type: 'text', text: ' 在吗' },
      ],
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const inbound = receive.mock.calls[0]?.[0] as {
      segments: Array<{ type: string; data: Record<string, unknown> }>;
      mentioned?: boolean;
    };
    expect(inbound.segments[0]).toEqual({ type: 'mention', data: { target: '10001' } });
    expect(inbound.mentioned).toBe(true);
    await endpoint.stop();
  });
});

describe('UNI-Channel 出站：canonical segments → ICQQ Sendable', () => {
  it('mention/face/reply/text 映射为 ICQQ 原生元素', async () => {
    const endpoint = await createEndpoint(vi.fn(), base64MediaConfig);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: [
        { type: 'reply', data: { message_id: 'm1' } },
        { type: 'mention', data: { target: '2' } },
        { type: 'text', data: { text: 'hi' } },
        { type: 'face', data: { id: 14 } },
      ],
    });

    expect(endpoint.endpoint.sendGroupMsg).toHaveBeenCalledWith(100, [
      { type: 'reply', id: 'm1' },
      { type: 'at', qq: 2 },
      'hi',
      { type: 'face', id: 14 },
    ]);
    await endpoint.stop();
  });

  it('带 name 的 mention 作为 at.text 显示名透传；无名则省略', async () => {
    const endpoint = await createEndpoint(vi.fn(), base64MediaConfig);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    await endpoint.send({
      conversation: { endpoint: { id: 'test-endpoint', adapter: 'test' }, kind: 'group', id: '100' },
      payload: [
        { type: 'mention', data: { target: '2', name: '小明' } },
        { type: 'mention', data: { target: '3' } },
      ],
    });

    expect(endpoint.endpoint.sendGroupMsg).toHaveBeenCalledWith(100, [
      { type: 'at', qq: 2, text: '@小明' },
      { type: 'at', qq: 3 },
    ]);
    await endpoint.stop();
  });

  it('image 的 canonical MediaRef（url/base64）映射为 ICQQ 原生图片元素', async () => {
    const endpoint = await createEndpoint(vi.fn(), base64MediaConfig);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: [
        { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.jpg' } } },
        { type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } },
      ],
    });

    expect(endpoint.endpoint.sendGroupMsg).toHaveBeenCalledWith(
      100,
      [
        { type: 'image', file: 'https://x/a.jpg' },
        { type: 'image', file: 'base64://QUJD' },
      ],
    );
    await endpoint.stop();
  });

  it.each([
    ['record', { kind: 'base64', value: 'UkVD' }, { type: 'record', file: 'base64://UkVD' }],
    ['video', { kind: 'path', value: '/tmp/v.mp4' }, { type: 'video', file: '/tmp/v.mp4' }],
  ] as const)('%s 映射为 ICQQ 原生独立媒体元素', async (type, media, expected) => {
    const endpoint = await createEndpoint(vi.fn(), base64MediaConfig);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: [{ type, data: { media } }],
    });

    expect(endpoint.endpoint.sendGroupMsg).toHaveBeenCalledWith(100, expected);
    await endpoint.stop();
  });

  it('file 使用 ICQQ 文件 API，不经过 sendGroupMsg 的空消息路径', async () => {
    const endpoint = await createEndpoint(vi.fn(), base64MediaConfig);
    const sendFile = vi.fn(async () => ({ fid: 'group-file-1' }));
    vi.mocked(endpoint.endpoint.pickGroup).mockReturnValue({ sendFile } as never);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    const sending = endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: [{
        type: 'file',
        data: { media: { kind: 'path', value: '/tmp/report.pdf' }, name: 'report.pdf' },
      }],
    });

    await expect(sending).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(sendFile).toHaveBeenCalledWith('/tmp/report.pdf', '/', 'report.pdf');
    expect(endpoint.endpoint.sendGroupMsg).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('file 模式把 canonical base64 MediaRef 落盘为本地路径', async () => {
    const endpoint = await createEndpoint(vi.fn(), baseConfig);
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: [
        { type: 'image', data: { media: { kind: 'base64', value: 'YQ==' } } },
      ],
    });

    const message = vi.mocked(endpoint.endpoint.sendGroupMsg).mock.calls[0]?.[1] as {
      type: string;
      file: string;
    };
    expect(message).toMatchObject({ type: 'image' });
    expect(message.file).toMatch(/^\/.*zhin-icqq-outbound.*/u);
    expect(fs.existsSync(message.file)).toBe(false);
    await endpoint.stop();
  });
});

describe('UNI-Channel defineAdapter segments policy', () => {
  it('声明编码器支持的段、base64/url/path 媒体能力与 text 交互降级', () => {
    expect(defineIcqqAdapter.segments).toEqual({
      supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face', 'dice', 'rps', 'share'],
      outboundMedia: ['base64', 'url', 'path'],
      interactive: 'text',
      model: { share: { fields: ['description', 'image', 'audio', 'platform'], hint: expect.stringContaining('QQ link card') } },
      reaction: { scopes: ['group'], values: expect.arrayContaining([{ value: '76', label: '赞' }, { value: '182', label: '笑哭' }]) },
    });
  });
});
