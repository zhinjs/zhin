import { deflateSync } from 'node:zlib';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import adapter from '../adapters/bilibili-live/index.js';
import { BilibiliLiveEndpoint, type LiveSocket } from '../src/endpoint.js';
import { LIVE_OP, resolveBilibiliLiveConfig } from '../src/protocol.js';
import type { BilibiliLiveFetch } from '../src/client.js';

const endpointId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili-live-test');

function packet(op: number, version: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(version, 6);
  header.writeUInt32BE(op, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, body]);
}

const danmuFrame = (text: string, uid = 42, uname = 'viewer', id = `dm-${text}`) => packet(5, 2, deflateSync(packet(5, 0, Buffer.from(JSON.stringify({
  cmd: 'DANMU_MSG',
  info: [[0, 1, 25, 16777215, 1700000000000, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ id_str: id }) }], text, [uid, uname]],
})))));

class FakeSocket implements LiveSocket {
  binaryType = 'blob';
  readonly sent: Buffer[] = [];
  readonly #listeners = new Map<string, ((event: { data?: unknown; code?: number }) => void)[]>();
  closed = false;
  constructor(readonly url: string) {}
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

function fakeFetch(options: { selfMid?: number; sendCode?: number } = {}) {
  const sends: URLSearchParams[] = [];
  const fetch: BilibiliLiveFetch = vi.fn(async (url: string, init) => {
    const ok = (data: unknown, code = 0) => ({ ok: true, status: 200, json: async () => ({ code, data }) });
    if (url.includes('/room/v1/Room/room_init')) return ok({ room_id: 5050, uid: 7 });
    if (url.includes('/x/frontend/finger/spi')) return ok({ b_3: 'buvid-test' });
    if (url.includes('/x/web-interface/nav')) {
      return ok({
        isLogin: options.selfMid !== undefined,
        mid: options.selfMid,
        wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' },
      });
    }
    if (url.includes('/getDanmuInfo?')) {
      expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
      return ok({ token: 'tok', host_list: [{ host: 'live.example', wss_port: 2245 }] });
    }
    if (url.endsWith('/msg/send')) {
      sends.push(new URLSearchParams(init?.body ?? ''));
      return ok({}, options.sendCode ?? 0);
    }
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, sends };
}

async function connected(config: Record<string, unknown> = {}, fetchOptions: Parameters<typeof fakeFetch>[0] = {}) {
  const { fetch, sends } = fakeFetch(fetchOptions);
  const sockets: FakeSocket[] = [];
  let clock = 1_000_000;
  const receive = vi.fn(async (_payload: unknown) => undefined);
  const endpoint = bindTestEndpoint(new BilibiliLiveEndpoint({
    id: endpointId,
    fetch,
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      queueMicrotask(() => {
        socket.fire('open');
        socket.receive(packet(LIVE_OP.authReply, 1, Buffer.from('{"code":0}')));
      });
      return socket;
    },
    now: () => clock,
    chunkDelayMs: 0,
    config: resolveBilibiliLiveConfig({ id: 'live', roomId: 12, sessdata: 's', biliJct: 'c', ...config }),
  }), { receive });
  await endpoint.start();
  endpoint.open();
  return { endpoint, sockets, receive, sends, advance: (ms: number) => { clock += ms; } };
}

const conversation = (id: string) => ({ endpoint: { id: String(endpointId), adapter: String(endpointId) }, kind: 'channel' as const, id });

describe('bilibili live adapter definition', () => {
  it('declares liveDanmaku so the Agent answers in danmaku windows', () => {
    expect(adapter.capabilities).toEqual(['inbound', 'outbound', 'liveDanmaku']);
  });
});

describe('BilibiliLiveEndpoint', () => {
  it('authenticates on the real room with the danmaku token and starts heartbeats', async () => {
    const { endpoint, sockets } = await connected({}, { selfMid: 99 });
    expect(endpoint.roomId).toBe('5050');
    expect(endpoint.transportState).toBe('open');
    expect(endpoint.selfUserId).toBe('99');
    const socket = sockets[0]!;
    expect(socket.url).toBe('wss://live.example:2245/sub');
    expect(socket.binaryType).toBe('arraybuffer');
    const auth = socket.sent[0]!;
    expect(auth.readUInt32BE(8)).toBe(LIVE_OP.auth);
    expect(JSON.parse(auth.subarray(16).toString())).toMatchObject({ uid: 99, roomid: 5050, key: 'tok', protover: 3, buvid: 'buvid-test' });
    expect(socket.sent[1]!.readUInt32BE(8)).toBe(LIVE_OP.heartbeat);
    await endpoint.stop();
    expect(socket.closed).toBe(true);
  });

  it('emits each danmaku once as a channel message of the room', async () => {
    const { endpoint, sockets, receive } = await connected({}, { selfMid: 99 });
    const socket = sockets[0]!;
    socket.receive(danmuFrame('主播好'));
    socket.receive(danmuFrame('主播好')); // 同一 id 重复推送
    socket.receive(danmuFrame('自己发的', 99, 'me'));
    socket.receive(danmuFrame('匿名', 0, '用**', 'dm-anon'));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    const first = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(first).toMatchObject({
      content: '主播好',
      sender: { id: '42', name: 'viewer' },
      conversation: { kind: 'channel', id: '5050' },
      message: { id: 'dm-主播好' },
      metadata: { roomId: '5050', liveDanmaku: true },
    });
    expect((receive.mock.calls[1]![0] as { sender: unknown }).sender).toEqual({ id: 'anon:用**', name: '用**' });
    await endpoint.stop();
  });

  it('ignores danmaku before open', async () => {
    const { endpoint, sockets, receive } = await connected();
    endpoint.close();
    sockets[0]!.receive(danmuFrame('closed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('posts a reply as chunked danmaku, replying to the mentioned viewer', async () => {
    const { endpoint, sends } = await connected({ maxLength: 10, maxChunks: 2 });
    await endpoint.send({
      conversation: conversation('5050'),
      payload: [{ type: 'mention', data: { id: '42', name: 'viewer' } }, { type: 'text', data: { text: '一二三四五六七八九十十一十二' } }],
    });
    expect(sends.map((body) => body.get('msg'))).toEqual(['一二三四五六七八九十', '十一十二']);
    expect(sends[0]!.get('reply_mid')).toBe('42');
    expect(sends[1]!.get('reply_mid')).toBe('0');
    expect(sends[0]!.get('roomid')).toBe('5050');
    expect(sends[0]!.get('csrf')).toBe('c');
    await endpoint.stop();
  });

  it('refuses to send when off, logged out, too soon, or to another room', async () => {
    const off = await connected({ sendMode: 'off' });
    await expect(off.endpoint.send({ conversation: conversation('5050'), payload: 'hi' })).rejects.toMatchObject({ code: 'send_disabled' });
    await off.endpoint.stop();

    const anonymous = await connected({ sessdata: undefined, biliJct: undefined });
    await expect(anonymous.endpoint.send({ conversation: conversation('5050'), payload: 'hi' })).rejects.toMatchObject({ code: 'not_logged_in' });
    await anonymous.endpoint.stop();

    const live = await connected();
    await expect(live.endpoint.send({ conversation: conversation('1'), payload: 'hi' })).rejects.toMatchObject({ code: 'invalid_recipient' });
    await live.endpoint.send({ conversation: conversation('5050'), payload: 'hi' });
    await expect(live.endpoint.send({ conversation: conversation('5050'), payload: 'again' })).rejects.toMatchObject({ code: 'rate_limited' });
    live.advance(5_000);
    await live.endpoint.send({ conversation: conversation('5050'), payload: 'again' });
    expect(live.sends).toHaveLength(2);
    await live.endpoint.stop();
  });

  it('opens the circuit on a rate-limit code and stops sending', async () => {
    const { endpoint, advance } = await connected({}, { sendCode: 10031 });
    const error = await endpoint.send({ conversation: conversation('5050'), payload: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EndpointDeliveryError);
    expect(error).toMatchObject({ code: 'platform_error', disposition: 'not_sent' });
    expect(endpoint.circuitBreaker?.code).toBe(10031);
    advance(60_000);
    await expect(endpoint.send({ conversation: conversation('5050'), payload: 'hi' })).rejects.toMatchObject({ code: 'circuit_open' });
    await endpoint.stop();
  });
});
