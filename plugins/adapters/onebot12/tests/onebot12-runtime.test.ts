import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { ProtocolError } from '@imhelper/onebot-v12';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { onebot12RuntimeStateToken } from '../src/onebot12-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { outboundMessageToken, sideEventGatewayToken, type OutboundMessageService } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineOneBot12Adapter from '../adapters/onebot12.js';
import { OneBot12WebhookEndpoint } from '../src/webhook.js';
import { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
import type { OneBot12WsSocket } from '../src/ws-types.js';
import {
  buildSendMessageParams,
  formatInboundContent,
  formatOutboundSegments,
  mediaRefToOneBot12UploadParams,
  onebot12InboundConversation,
  resolveOneBot12Config,
  uploadOneBot12MediaSegments,
  type OneBot12Event,
  type OneBot12WsConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];

const testEndpointId = capabilityId(rootPluginId(), adapterFeature, 'onebot12');
const testEndpointIdString = String(testEndpointId);

function makeConversation(
  kind: 'private' | 'group' | 'channel',
  id: string,
  parent?: { kind: 'group' | 'channel'; id: string },
) {
  return {
    endpoint: { id: testEndpointIdString, adapter: testEndpointIdString.split('\0')[0] ?? testEndpointIdString },
    kind,
    id,
    ...(parent ? { parent } : {}),
  };
}

const baseConfig: OneBot12WsConfig = resolveOneBot12Config({
  connection: 'ws',
  id: 'test-ob12',
  url: 'ws://127.0.0.1:6700',
  access_token: 'secret',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as OneBot12WsConfig;

function createMockWs(): OneBot12WsSocket & {
  emitOpen: () => void;
  emitMessage: (data: string) => void;
  emitClose: (code?: number, reason?: string) => void;
  emitError: (error: Error) => void;
  sent: string[];
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];
  const on = (event: string, listener: (...args: unknown[]) => void) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return {
    readyState: 1,
    sent,
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
    close: vi.fn(),
    on,
    emitOpen() {
      emit('open');
    },
    emitMessage(data: string) {
      emit('message', data);
    },
    emitClose(code = 1000, reason = 'bye') {
      emit('close', code, reason);
    },
    emitError(error: Error) {
      emit('error', error);
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close().catch(() => undefined)));
});

describe('onebot12 protocol helpers', () => {
  it('resolves ws config from plugin config', () => {
    const resolved = resolveOneBot12Config({
      connection: 'ws',
      id: 'bot',
      url: 'ws://localhost:1',
    });
    expect(resolved).toMatchObject({
      connection: 'ws',
      id: 'bot',
      url: 'ws://localhost:1',
      reconnect_interval: 5000,
      heartbeat_interval: 30_000,
    });
  });

  it('normalizes inbound events into ConversationRef and content', () => {
    const ev: OneBot12Event = {
      id: 'e1',
      time: 1,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      message_id: 'm1',
      group_id: '100',
      user_id: 'u1',
      alt_message: 'hello',
      message: [{ type: 'text', data: { text: 'hello' } }],
    };
    expect(onebot12InboundConversation(testEndpointIdString, ev)).toEqual(makeConversation('group', '100'));
    expect(formatInboundContent(ev)).toBe('hello');
  });

  it('maps channel guild and private temp session into conversation parent', () => {
    const channelEv: OneBot12Event = {
      id: 'e2',
      time: 1,
      type: 'message',
      detail_type: 'channel',
      sub_type: '',
      message_id: 'm2',
      channel_id: 'c1',
      guild_id: 'g1',
      user_id: 'u1',
      alt_message: 'hi',
    };
    expect(onebot12InboundConversation(testEndpointIdString, channelEv)).toEqual(
      makeConversation('channel', 'c1', { kind: 'channel', id: 'g1' }),
    );

    const tempEv: OneBot12Event = {
      id: 'e3',
      time: 1,
      type: 'message',
      detail_type: 'private',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'm3',
      user_id: 'u2',
      group_id: '300',
      alt_message: 'temp',
    };
    expect(onebot12InboundConversation(testEndpointIdString, tempEv)).toEqual(
      makeConversation('private', 'u2', { kind: 'group', id: '300' }),
    );
  });

  it('builds send_message params from ConversationRef', () => {
    expect(buildSendMessageParams(makeConversation('private', '1'), [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      message: [{ type: 'text', data: { text: 'hi' } }],
      detail_type: 'private',
      user_id: '1',
    });
    expect(buildSendMessageParams(makeConversation('group', '2'), [{ type: 'text', data: { text: 'hi' } }])).toEqual({
      message: [{ type: 'text', data: { text: 'hi' } }],
      detail_type: 'group',
      group_id: '2',
    });
    // channel 的 guild 容器取自 conversation.parent
    expect(buildSendMessageParams(
      makeConversation('channel', 'c1', { kind: 'channel', id: 'g1' }),
      [{ type: 'text', data: { text: 'hi' } }],
    )).toEqual({
      message: [{ type: 'text', data: { text: 'hi' } }],
      detail_type: 'channel',
      channel_id: 'c1',
      guild_id: 'g1',
    });
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundSegments('pong')).toEqual([{ type: 'text', data: { text: 'pong' } }]);
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
    ])).toEqual([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { url: 'https://x/a.png' } },
    ]);
  });

  it('maps canonical segments to OneBot 12 wire segments', () => {
    expect(formatOutboundSegments([
      { type: 'mention', data: { target: 'u1' } },
      { type: 'mention', data: { target: 'all' } },
      { type: 'reply', data: { message_id: 'm-1' } },
    ])).toEqual([
      { type: 'mention', data: { user_id: 'u1' } },
      { type: 'mention_all', data: {} },
      { type: 'reply', data: { message_id: 'm-1' } },
    ]);
    // 已物化 file_id 的段（spec 正式形状）透传
    expect(formatOutboundSegments([
      { type: 'image', data: { file_id: 'fid-1' } },
    ])).toEqual([
      { type: 'image', data: { file_id: 'fid-1' } },
    ]);
    // canonical MediaRef → 扩展字段（url / data / path）
    expect(formatOutboundSegments([
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
      { type: 'image', data: { media: { kind: 'base64', value: 'base64://QUJD', mime_type: 'image/png' } } },
      { type: 'video', data: { media: { kind: 'path', value: '/tmp/a.mp4' } } },
    ])).toEqual([
      { type: 'image', data: { url: 'https://x/a.png' } },
      { type: 'image', data: { data: 'QUJD' } },
      { type: 'video', data: { path: '/tmp/a.mp4' } },
    ]);
  });

  it('drops media segments without a canonical MediaRef', () => {
    // 无 data.media 的媒体段不可投递：warn + 丢弃（legacy 形状不再回读）
    expect(formatOutboundSegments([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { url: 'https://x/a.png' } },
    ])).toEqual([{ type: 'text', data: { text: 'hi' } }]);
    // kind=file 的 MediaRef 直接按 file_id 复投
    expect(formatOutboundSegments([
      { type: 'file', data: { media: { kind: 'file', value: 'fid-9' }, name: 'a.bin' } },
    ])).toEqual([{ type: 'file', data: { name: 'a.bin', file_id: 'fid-9' } }]);
  });

  it('builds upload_file params from canonical MediaRef', () => {
    expect(mediaRefToOneBot12UploadParams('image', {}, { kind: 'url', value: 'https://x/a.png' }))
      .toEqual({ type: 'url', name: 'a.png', url: 'https://x/a.png' });
    expect(mediaRefToOneBot12UploadParams(
      'image',
      { name: 'p.png' },
      { kind: 'base64', value: 'base64://QUJD' },
    )).toEqual({ type: 'data', name: 'p.png', data: 'QUJD' });
    expect(mediaRefToOneBot12UploadParams('video', {}, { kind: 'path', value: 'file:///tmp/a.mp4' }))
      .toEqual({ type: 'path', name: 'a.mp4', path: '/tmp/a.mp4' });
    // kind=file 不可上传（走 file_id 复投），返回 undefined
    expect(mediaRefToOneBot12UploadParams('file', {}, { kind: 'file', value: 'fid' }))
      .toBeUndefined();
  });

  it('materializes media segments via upload_file, reuses file refs, degrades on failure', async () => {
    const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
    const okUpload = async (action: string, params: Record<string, unknown>) => {
      calls.push({ action, params });
      return { file_id: 'fid-1' };
    };
    const out = await uploadOneBot12MediaSegments([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
      { type: 'image', data: { file_id: 'fid-old' } },
      { type: 'file', data: { media: { kind: 'file', value: 'fid-re' }, name: 'a.bin' } },
    ], okUpload);
    expect(calls).toEqual([{
      action: 'upload_file',
      params: { type: 'url', name: 'a.png', url: 'https://x/a.png' },
    }]);
    expect(out).toEqual([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { file_id: 'fid-1' } },
      { type: 'image', data: { file_id: 'fid-old' } },
      { type: 'file', data: { name: 'a.bin', file_id: 'fid-re' } },
    ]);

    // 上传失败 → 保留原段，由 formatOutboundSegments 走扩展字段降级
    const onFail = vi.fn();
    const original = [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }];
    const degraded = await uploadOneBot12MediaSegments(original, async () => {
      throw new Error('no upload');
    }, onFail);
    expect(degraded).toEqual(original);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(formatOutboundSegments(degraded)).toEqual([{ type: 'image', data: { data: 'QUJD' } }]);
  });
});

describe('onebot12 plugin runtime adapter', () => {
  it('routes admitted message events through OutboundMessageService when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway,
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), gateway, undefined);

    await endpoint.start();
    endpoint.open();
    endpoint.client.ingest({
      id: 'e1',
      time: 1_700_000_000,
      type: 'message',
      detail_type: 'private',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'msg-1',
      user_id: '10001',
      alt_message: '你好',
      message: [{ type: 'text', data: { text: '你好' } }],
      'user.name': 'Alice',
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: makeConversation('private', '10001'),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: '你好',
      sender: expect.objectContaining({ id: '10001' }),
      metadata: expect.objectContaining({ nickname: 'Alice' }),
    }));

    await endpoint.stop();
    expect(ws.close).toHaveBeenCalled();
  });

  it('marks mentioned when a mention segment targets self.user_id', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway,
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), gateway, undefined);
    await endpoint.start();
    endpoint.open();
    endpoint.client.ingest({
      id: 'e-at',
      time: 1_700_000_000,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'm-at',
      group_id: '200',
      user_id: '9',
      message: [
        { type: 'mention', data: { user_id: 'bot-1' } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
      alt_message: '@bot 在吗',
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: makeConversation('group', '200'),
      sender: expect.objectContaining({ id: '9' }),
      mentioned: true,
    }));
    await endpoint.stop();
  });

  it('does not mark mentioned when the mention targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway,
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), gateway, undefined);
    await endpoint.start();
    endpoint.open();
    endpoint.client.ingest({
      id: 'e-other',
      time: 1_700_000_000,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'm-other',
      group_id: '200',
      user_id: '9',
      message: [
        { type: 'mention', data: { user_id: 'someone-else' } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
      alt_message: '@other 在吗',
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), { receive, send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    endpoint.client.ingest({
      id: 'e1',
      time: 1,
      type: 'message',
      detail_type: 'private',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'm',
      user_id: '1',
      alt_message: 'nope',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via WS send_message action', async () => {
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      }, undefined);
    await endpoint.start();
    endpoint.open();

    const sendPromise = endpoint.send({
      conversation: makeConversation('private', '10001'),
      payload: 'pong',
    });

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    const req = JSON.parse(ws.sent[0]!) as {
      action: string;
      params: Record<string, unknown>;
      echo: string;
    };
    expect(req.action).toBe('send_message');
    expect(req.params).toMatchObject({
      detail_type: 'private',
      user_id: '10001',
      message: [{ type: 'text', data: { text: 'pong' } }],
    });

    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { message_id: 'out-1' },
      message: '',
      echo: req.echo,
    }));

    await expect(sendPromise).resolves.toBe('out-1');
    await endpoint.stop();
  });

  it('exposes failed status, data and echo through ProtocolError', async () => {
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();

    const call = endpoint.client.call('get_status');
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { echo: string };
    const response = {
      status: 'failed' as const,
      retcode: 1404,
      message: 'unsupported',
      data: { action: 'get_status' },
      echo: request.echo,
    };
    ws.emitMessage(JSON.stringify(response));

    const error = await call.catch((cause) => cause);
    expect(error).toMatchObject({
      protocol: 'onebot-v12',
      operation: 'get_status',
      kind: 'protocol',
      code: 1404,
      response,
    });
    expect(error).toBeInstanceOf(ProtocolError);
    await endpoint.stop();
  });

  it('projects non-message requests through the Client public event map', () => {
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => createMockWs(),
    }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    const request = vi.fn();
    endpoint.client.on('request.group', request);

    endpoint.client.ingest({
      id: 'event-7',
      time: 1,
      type: 'request',
      detail_type: 'group',
      sub_type: 'add',
      self: { platform: 'qq', user_id: 'bot-1' },
      request_id: 'request-7',
      group_id: '200',
      user_id: '42',
      message: 'please',
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'request-7',
      group_id: '200',
      user_id: '42',
      sub_type: 'add',
    }));
  });

  it('uploads base64 media via upload_file then sends file_id segment', async () => {
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      }, undefined);
    await endpoint.start();
    endpoint.open();

    const sendPromise = endpoint.send({
      conversation: makeConversation('private', '10001'),
      payload: [{
        type: 'image',
        data: { media: { kind: 'base64', value: 'QUJD', mime_type: 'image/png' }, name: 'a.png' },
      }],
    });

    // 第一帧：upload_file（spec 物化）
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    const uploadReq = JSON.parse(ws.sent[0]!) as {
      action: string;
      params: Record<string, unknown>;
      echo: string;
    };
    expect(uploadReq.action).toBe('upload_file');
    expect(uploadReq.params).toEqual({ type: 'data', name: 'a.png', data: 'QUJD' });
    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { file_id: 'fid-up-1' },
      message: '',
      echo: uploadReq.echo,
    }));

    // 第二帧：send_message，媒体段以 file_id 正式形状投递
    await vi.waitFor(() => expect(ws.sent.length).toBe(2));
    const sendReq = JSON.parse(ws.sent[1]!) as {
      action: string;
      params: { message?: unknown };
      echo: string;
    };
    expect(sendReq.action).toBe('send_message');
    expect(sendReq.params.message).toEqual([
      { type: 'image', data: { name: 'a.png', file_id: 'fid-up-1' } },
    ]);
    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { message_id: 'out-up-1' },
      message: '',
      echo: sendReq.echo,
    }));

    await expect(sendPromise).resolves.toBe('out-up-1');
    await endpoint.stop();
  });

  it('degrades to extension fields when upload_file fails', async () => {
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      }, undefined);
    await endpoint.start();
    endpoint.open();

    const sendPromise = endpoint.send({
      conversation: makeConversation('private', '10001'),
      payload: [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD' } } }],
    });

    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    const uploadReq = JSON.parse(ws.sent[0]!) as { action: string; echo: string };
    expect(uploadReq.action).toBe('upload_file');
    ws.emitMessage(JSON.stringify({
      status: 'failed',
      retcode: 3404,
      data: null,
      message: 'unsupported',
      echo: uploadReq.echo,
    }));

    // 降级：send_message 仍发出，媒体走扩展字段（base64 → data）
    await vi.waitFor(() => expect(ws.sent.length).toBe(2));
    const sendReq = JSON.parse(ws.sent[1]!) as {
      action: string;
      params: { message?: unknown };
      echo: string;
    };
    expect(sendReq.action).toBe('send_message');
    expect(sendReq.params.message).toEqual([{ type: 'image', data: { data: 'QUJD' } }]);
    ws.emitMessage(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { message_id: 'out-deg-1' },
      message: '',
      echo: sendReq.echo,
    }));

    await expect(sendPromise).resolves.toBe('out-deg-1');
    await endpoint.stop();
  });

  it('admits inbound events received over the socket when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const ws = createMockWs();
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        queueMicrotask(() => ws.emitOpen());
        return ws;
      },
    }), { receive, send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    endpoint.open();
    ws.emitMessage(JSON.stringify({
      id: 'e2',
      time: 2,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      self: { platform: 'qq', user_id: 'bot-1' },
      message_id: 'gm-1',
      group_id: '200',
      user_id: '9',
      alt_message: 'from-ws',
      message: [{ type: 'text', data: { text: 'from-ws' } }],
    }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: makeConversation('group', '200'),
      content: 'from-ws',
    }));
    await endpoint.stop();
  });

  it('creates webhook endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: OutboundMessageService = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = defineOneBot12Adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      name: 'onebot12',
      config: {
        connection: 'webhook',
        id: 'hook',
        path: '/onebot12/webhook',
        api_url: 'http://127.0.0.1:6700',
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === outboundMessageToken) return gateway;
        if (token === sideEventGatewayToken) {
          return {
            receiveNotice: vi.fn(async () => {}),
            receiveRequest: vi.fn(async () => {}),
            receiveSystem: vi.fn(async () => {}),
          };
        }
        if (token === onebot12RuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(OneBot12WebhookEndpoint);
  });

  it('creates reverse-wss endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = defineOneBot12Adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      name: 'onebot12',
      config: { connection: 'wss', id: 'rev', path: '/onebot12/ws' },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === outboundMessageToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === sideEventGatewayToken) {
          return {
            receiveNotice: vi.fn(async () => {}),
            receiveRequest: vi.fn(async () => {}),
            receiveSystem: vi.fn(async () => {}),
          };
        }
        if (token === onebot12RuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(OneBot12WssEndpoint);
  });

  it('handles webhook POST and routes events through OutboundMessageService', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const callAction = vi.fn(async () => ({
      status: 'ok' as const,
      retcode: 0,
      data: { message_id: 'out-1' },
      message: '',
    }));
    const endpoint = bindTestEndpoint(new OneBot12WebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway,
      http,
      config: resolveOneBot12Config({
        connection: 'webhook',
        id: 'hook',
        path: '/onebot12/webhook',
        api_url: 'http://127.0.0.1:6700',
      }) as ReturnType<typeof resolveOneBot12Config> & { connection: 'webhook' },
      callAction,
    }), gateway, undefined);

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/onebot12/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'e1',
        time: 1,
        type: 'message',
        detail_type: 'private',
        sub_type: '',
        self: { platform: 'qq', user_id: 'bot-1' },
        message_id: 'msg-1',
        user_id: '10001',
        alt_message: 'from-webhook',
      }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: makeConversation('private', '10001'),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'from-webhook',
    }));

    await endpoint.send({ conversation: makeConversation('private', '10001'), payload: 'pong' });
    expect(callAction).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1:6700' }),
      'send_message',
      expect.objectContaining({ detail_type: 'private', user_id: '10001' }),
    );

    await endpoint.stop();
  });
});

describe('onebot12 ws lifecycle', () => {
  it('does not arm reconnect when the initial connect closes before open', async () => {
    let creates = 0;
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig, // reconnect_interval: 50
      createWebSocket: () => {
        creates += 1;
        const ws = createMockWs();
        queueMicrotask(() => ws.emitClose(1006, 'refused'));
        return ws;
      },
    }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);

    await expect(endpoint.start()).rejects.toThrow('OneBot12 WS 关闭');
    // 等超过一个 reconnect_interval，不应有幽灵重连发生
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(creates).toBe(1);
  });

  it('settles start() silently when stop() races the initial connect', async () => {
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => createMockWs(), // 永不 open，模拟连接挂起
    }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);

    const startPromise = endpoint.start();
    await endpoint.stop();
    // stop-during-connect 视为主动停止：start() 静默 resolve，不拒绝、不武装重连
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('reconnects only after an established connection closes', async () => {
    const sockets: Array<ReturnType<typeof createMockWs>> = [];
    const endpoint = bindTestEndpoint(new OneBot12WsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createWebSocket: () => {
        const ws = createMockWs();
        sockets.push(ws);
        queueMicrotask(() => {
          if (sockets.length === 1) ws.emitOpen();
        });
        return ws;
      },
    }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);

    await endpoint.start();
    sockets[0]!.emitClose(1006, 'lost');
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    await endpoint.stop();
  });

  it('warns loudly when wss starts without access_token', async () => {
    const { getAdapterLogger } = await import('@zhin.js/logger');
    const warnSpy = vi.spyOn(getAdapterLogger('onebot12', 'wss-noauth'), 'warn');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    try {
      const endpoint = bindTestEndpoint(new OneBot12WssEndpoint({
        id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
        gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
        http,
        config: resolveOneBot12Config({
          connection: 'wss',
          id: 'wss-noauth',
          path: '/ob12/ws',
        }) as import('../src/protocol.js').OneBot12WssConfig,
      }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
      await endpoint.start();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing access_token'));
      await endpoint.stop();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns loudly when webhook starts without access_token', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warnSpy = vi.spyOn(getLogger('onebot12'), 'warn');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    try {
      const endpoint = bindTestEndpoint(new OneBot12WebhookEndpoint({
        id: capabilityId(rootPluginId(), adapterFeature, 'onebot12'),
        gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
        http,
        config: resolveOneBot12Config({
          connection: 'webhook',
          id: 'hook-noauth',
          path: '/ob12/hook',
        }) as ReturnType<typeof resolveOneBot12Config> & { connection: 'webhook' },
      }), { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
      await endpoint.start();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing access_token'));
      await endpoint.stop();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
