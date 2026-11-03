import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import adapter from '../adapters/douyin-live/index.js';
import { DouyinLiveEndpoint, type LiveSocket } from '../src/endpoint.js';
import { decodePushFrame, resolveDouyinLiveConfig } from '../src/protocol.js';
import type { DouyinLiveFetch, DouyinLiveSigner } from '../src/client.js';
import { chatFrame, giftFrame } from './fixtures.js';

const endpointId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'douyin-live-test');
const WEB_RID = '123456789';
const INTERNAL_ROOM = '7400000000000000002';

class FakeSocket implements LiveSocket {
  binaryType = 'nodebuffer';
  readonly sent: Buffer[] = [];
  readonly #listeners = new Map<string, ((event: { data?: unknown; code?: number }) => void)[]>();
  closed = false;
  constructor(readonly url: string, readonly headers: Readonly<Record<string, string>>) {}
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: { data?: unknown; code?: number } = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
  send(data: Uint8Array): void {
    this.sent.push(Buffer.from(data));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fire('close', { code: 1000 });
  }
  receive(frame: Buffer): void {
    this.fire('message', { data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
  }
}

function fakeFetch(options: { readonly signer?: string } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const response = (body: string, setCookie?: string) => ({
    ok: true, status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'set-cookie' ? setCookie ?? null : null) },
    text: async () => body,
  });
  const fetch: DouyinLiveFetch = vi.fn(async (url: string, init) => {
    calls.push({ url, headers: { ...init?.headers } });
    if (url === 'https://live.douyin.com/') return response('<html></html>', 'ttwid=guest-ttwid; Path=/; HttpOnly');
    if (url === `https://live.douyin.com/${WEB_RID}`) return response(`<script>self.__pace_f.push([1,"{\\"roomId\\":\\"${INTERNAL_ROOM}\\"}"])</script>`);
    if (options.signer && url.startsWith(options.signer)) return response(JSON.stringify({ signature: 'signed-by-url' }));
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, calls };
}

async function connected(config: Record<string, unknown> = {}, extra: { sign?: DouyinLiveSigner; signer?: string } = {}) {
  const { fetch, calls } = fakeFetch({ ...(extra.signer ? { signer: extra.signer } : {}) });
  const sockets: FakeSocket[] = [];
  const receive = vi.fn(async (_payload: unknown) => undefined);
  const harness = await createEndpointHarness(() => new DouyinLiveEndpoint({
    id: endpointId,
    fetch,
    ...(extra.sign ? { sign: extra.sign } : {}),
    userUniqueId: '7319483754668557238',
    socket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      queueMicrotask(() => socket.fire('open'));
      return socket;
    },
    now: () => 1_700_000_000_000,
    config: resolveDouyinLiveConfig({ id: 'live', roomId: WEB_RID, ...config }),
  }), { name: 'douyin-live', capabilities: ['inbound', 'outbound'], gateway: createTestEventGateway({ receive }) });
  await harness.start();
  harness.open();
  return { harness, sockets, receive, calls };
}

const conversation = (id: string) => ({ endpoint: { id: String(endpointId), adapter: String(endpointId) }, kind: 'channel' as const, id });

describe('douyin live adapter definition', () => {
  it('declares liveDanmaku so the Agent answers in danmaku windows', () => {
    expect(adapter.capabilities).toEqual(['inbound', 'outbound', 'liveDanmaku']);
  });
});

describe('DouyinLiveEndpoint inbound', () => {
  it('requests a guest ttwid, resolves the internal room_id and connects with cookie + heartbeat', async () => {
    const { harness, sockets, calls } = await connected();
    expect(harness.endpoint.internalRoomId).toBe(INTERNAL_ROOM);
    expect(harness.endpoint.webRid).toBe(WEB_RID);
    expect(harness.index.describe()[0]?.transportState).toBe('open');
    expect(calls.map((call) => call.url)).toEqual(['https://live.douyin.com/', `https://live.douyin.com/${WEB_RID}`]);
    expect(calls[1]!.headers.cookie).toMatch(/^ttwid=guest-ttwid; __ac_nonce=0[0-9a-f]{20}$/);
    const socket = sockets[0]!;
    const url = new URL(socket.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/');
    expect(url.searchParams.get('room_id')).toBe(INTERNAL_ROOM);
    expect(url.searchParams.get('user_unique_id')).toBe('7319483754668557238');
    expect(url.searchParams.has('signature')).toBe(false);
    expect(socket.headers.cookie).toBe('ttwid=guest-ttwid');
    expect(socket.headers['user-agent']).toMatch(/Chrome/);
    expect(socket.binaryType).toBe('arraybuffer');
    expect(decodePushFrame(socket.sent[0]!)?.payloadType).toBe('hb');
    await harness.stop();
    expect(socket.closed).toBe(true);
  });

  it('reuses the configured cookie ttwid and signs the socket URL', async () => {
    const sign = vi.fn(async (stub: string) => `sig-${stub.slice(0, 6)}`);
    const { harness, sockets, calls } = await connected({ cookie: 'ttwid=mine; sessionid=secret' }, { sign });
    expect(calls.map((call) => call.url)).toEqual([`https://live.douyin.com/${WEB_RID}`]);
    expect(sign).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{32}$/), undefined);
    const url = new URL(sockets[0]!.url);
    expect(url.searchParams.get('signature')).toBe(`sig-${sign.mock.calls[0]![0].slice(0, 6)}`);
    expect(sockets[0]!.headers.cookie).toBe('ttwid=mine; sessionid=secret');
    await harness.stop();
  });

  it('asks the configured signerUrl for the signature', async () => {
    const { harness, sockets, calls } = await connected({ signerUrl: 'http://127.0.0.1:9/sign' }, { signer: 'http://127.0.0.1:9/sign' });
    expect(calls.some((call) => /^http:\/\/127\.0\.0\.1:9\/sign\?stub=[0-9a-f]{32}$/.test(call.url))).toBe(true);
    expect(new URL(sockets[0]!.url).searchParams.get('signature')).toBe('signed-by-url');
    await harness.stop();
  });

  it('emits each chat danmaku once on the web_rid channel with liveDanmaku metadata', async () => {
    const { harness, sockets, receive } = await connected();
    const socket = sockets[0]!;
    socket.receive(chatFrame({ text: '主播好', uid: 42, nickname: 'viewer', msgId: 1001, roomId: BigInt(INTERNAL_ROOM), createTime: 1_700_000_000_123 }));
    socket.receive(chatFrame({ text: '主播好', uid: 42, nickname: 'viewer', msgId: 1001, roomId: BigInt(INTERNAL_ROOM) })); // 重复推送
    socket.receive(giftFrame()); // 礼物等其他类型忽略
    socket.receive(chatFrame({ text: '匿名', nickname: '游客A', msgId: 1002 }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    expect(receive.mock.calls[0]![0]).toMatchObject({
      content: '主播好',
      sender: { id: '42', name: 'viewer' },
      conversation: { kind: 'channel', id: WEB_RID },
      message: { id: '1001' },
      platformSentAt: 1_700_000_000_123,
      metadata: { roomId: INTERNAL_ROOM, liveDanmaku: true },
    });
    const anonymous = receive.mock.calls[1]![0] as { sender: unknown; metadata: unknown };
    expect(anonymous.sender).toEqual({ id: 'anon:游客A', name: '游客A' });
    expect(anonymous.metadata).toEqual({ roomId: INTERNAL_ROOM, liveDanmaku: true });
    await harness.stop();
  });

  it('acks frames that ask for it', async () => {
    const { harness, sockets } = await connected();
    const socket = sockets[0]!;
    const before = socket.sent.length;
    socket.receive(chatFrame({ text: 'x', uid: 1, nickname: 'n', msgId: 3 }, { needAck: true, internalExt: 'ext-ack', logId: 555 }));
    const ack = decodePushFrame(socket.sent[before]!)!;
    expect(ack).toMatchObject({ payloadType: 'ack', logId: '555' });
    expect(Buffer.from(ack.payload).toString()).toBe('ext-ack');
    await harness.stop();
  });

  it('ignores danmaku before open', async () => {
    const { harness, sockets, receive } = await connected();
    await harness.close();
    sockets[0]!.receive(chatFrame({ text: 'closed', uid: 1, nickname: 'n', msgId: 9 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receive).not.toHaveBeenCalled();
    await harness.stop();
  });
});

describe('DouyinLiveEndpoint outbound (sendMode α)', () => {
  it('refuses to send by default (sendMode off)', async () => {
    const { harness } = await connected();
    await expect(harness.send({ conversation: conversation(WEB_RID), payload: 'hi' })).rejects.toMatchObject({ code: 'send_disabled', disposition: 'not_sent' });
    await harness.stop();
  });
});
