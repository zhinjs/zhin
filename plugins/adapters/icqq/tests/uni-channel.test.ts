/**
 * UNI-Channel（统一消息元素通道）icqq 接入测试：
 * 入站 CQ/元素 → canonical Segment[] 随 gateway.receive 上送（content 保留 CQ 原文）；
 * 出站 canonical Segment[] → CQ 串（mention/face/reply/image/record/video MediaRef 映射）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';
import defineIcqqAdapter from '../adapters/icqq.js';
import {
  IcqqIpcEndpoint,
  type IcqqIpcTransport,
} from '../src/endpoint.js';
import { Actions, resolveIcqqConfig } from '../src/protocol.js';
import { setIcqqAgentDeps } from '../src/icqq-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  name: '10001',
  autoReconnect: false,
});

/** base64 出站模式：canonical MediaRef base64 直接编码 base64://，不落盘。 */
const base64MediaConfig = resolveIcqqConfig({
  name: '10001',
  autoReconnect: false,
  outboundMedia: 'base64',
});

function createMockIpc(): IcqqIpcTransport & {
  sent: Array<{ action: string; params?: Record<string, unknown> }>;
  emitEvent: (event: string, data: unknown) => void;
} {
  const handlers: Array<(event: { id: string; event: string; data: unknown }) => void> = [];
  const sent: Array<{ action: string; params?: Record<string, unknown> }> = [];
  return {
    sent,
    emitEvent(event, data) {
      for (const handler of handlers) {
        handler({ id: '*', event, data });
      }
    },
    request: vi.fn(async (action: string, params?: Record<string, unknown>) => {
      sent.push({ action, params });
      if (action === Actions.LIST_FRIENDS) {
        return { id: '1', ok: true, data: [] };
      }
      if (action === Actions.LIST_GROUPS) {
        return { id: '1', ok: true, data: [] };
      }
      if (action === Actions.SEND_GROUP_MSG || action === Actions.SEND_PRIVATE_MSG) {
        return { id: '1', ok: true, data: { message_id: 'sent-1' } };
      }
      return { id: '1', ok: true, data: {} };
    }),
    subscribe: vi.fn((_action, _params, handler) => {
      handlers.push(handler);
      return { unsubscribe: vi.fn(async () => undefined) };
    }),
    setOnRemoteDisconnect: vi.fn(),
    close: vi.fn(),
  };
}

function createEndpoint(
  mock: IcqqIpcTransport,
  receive: ReturnType<typeof vi.fn>,
  config = baseConfig,
): IcqqIpcEndpoint {
  const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
  return new IcqqIpcEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config,
    createIpc: async () => mock,
  });
}

afterEach(() => {
  setIcqqAgentDeps(null);
});

describe('UNI-Channel 入站：CQ/元素 → canonical segments', () => {
  it('元素数组归一为 canonical 段，content 保留 CQ 原文', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = createEndpoint(mock, receive);
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
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
    // content 纯文本视图 = CQ 原文
    expect(inbound.content).toBe('hi[at:3][face:14]');
    // segments = canonical Segment[]（at→mention、image→MediaRef）
    expect(inbound.segments).toBeDefined();
    const [text, mention, face, image, record] = inbound.segments;
    expect(text).toEqual({ type: 'text', data: { text: 'hi' } });
    expect(mention).toEqual({ type: 'mention', data: { target: '3' } });
    expect(face).toMatchObject({ type: 'face', data: { id: 14 } });
    expect(image).toMatchObject({
      type: 'image',
      data: { media: { kind: 'url', value: 'https://x/a.jpg' } },
    });
    expect(record).toMatchObject({
      type: 'record',
      data: { media: { kind: 'url', value: 'https://x/a.amr' } },
    });
    await endpoint.stop();
  });

  it('quote 元数据（oicq source）归一为 reply 段置于段首', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = createEndpoint(mock, receive);
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
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
      metadata: Record<string, unknown>;
    };
    expect(inbound.segments[0]).toEqual({
      type: 'reply',
      data: { message_id: 'quoted-1' },
    });
    // metadata quote 链路保持既有行为
    expect(inbound.metadata).toMatchObject({ quote_id: 'quoted-1' });
    await endpoint.stop();
  });

  it('结构化段的 mention 可用于 @ 本机判定（raw_message 缺失时）', async () => {
    const mock = createMockIpc();
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const endpoint = createEndpoint(mock, receive);
    await endpoint.start();
    endpoint.open();

    mock.emitEvent('message.group.normal', {
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
      metadata: Record<string, unknown>;
    };
    expect(inbound.segments[0]).toEqual({ type: 'mention', data: { target: '10001' } });
    expect(inbound.metadata).toMatchObject({ mentioned: true });
    await endpoint.stop();
  });
});

describe('UNI-Channel 出站：canonical segments → CQ 串', () => {
  it('mention/face/reply/text 映射为 CQ 段', async () => {
    const mock = createMockIpc();
    const endpoint = createEndpoint(mock, vi.fn(), base64MediaConfig);
    await endpoint.start();
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

    const call = mock.sent.find((s) => s.action === Actions.SEND_GROUP_MSG);
    expect(call?.params).toEqual({
      group_id: 100,
      message: '[reply:m1][at:2]hi[face:14]',
    });
    await endpoint.stop();
  });

  it('image/record/video 的 canonical MediaRef（url/base64/path）映射为 CQ 媒体值', async () => {
    const mock = createMockIpc();
    const endpoint = createEndpoint(mock, vi.fn(), base64MediaConfig);
    await endpoint.start();
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
        { type: 'record', data: { media: { kind: 'base64', value: 'UkVD' } } },
        { type: 'video', data: { media: { kind: 'path', value: '/tmp/v.mp4' } } },
      ],
    });

    const call = mock.sent.find((s) => s.action === Actions.SEND_GROUP_MSG);
    expect(call?.params).toEqual({
      group_id: 100,
      message:
        '[image:https://x/a.jpg][image:base64://QUJD][record:base64://UkVD][video:/tmp/v.mp4]',
    });
    await endpoint.stop();
  });

  it('file 模式把 canonical base64 MediaRef 落盘为本地路径', async () => {
    const mock = createMockIpc();
    // baseConfig 无 rpc / outboundMedia → file 模式
    const endpoint = createEndpoint(mock, vi.fn(), baseConfig);
    await endpoint.start();
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

    const call = mock.sent.find((s) => s.action === Actions.SEND_GROUP_MSG);
    const message = String(call?.params?.message);
    expect(message).toMatch(/^\[image:\/.*zhin-icqq-outbound.*\]$/u);
    // 清理 file 模式落盘的临时文件
    fs.rmSync(message.slice('[image:'.length, -1), { force: true });
    await endpoint.stop();
  });
});

describe('UNI-Channel defineAdapter segments policy', () => {
  it('声明 base64/url/path 媒体能力与 text 交互降级', () => {
    expect(defineIcqqAdapter.segments).toEqual({
      outboundMedia: ['base64', 'url', 'path'],
      interactive: 'text',
    });
  });
});
