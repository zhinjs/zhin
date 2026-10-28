import { brotliCompressSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  LIVE_OP,
  decodeLiveFrame,
  encodeLivePacket,
  formatOutboundDanmaku,
  parseDanmaku,
  resolveBilibiliLiveConfig,
  splitDanmaku,
} from '../src/protocol.js';
import { signWbi } from '../src/client.js';

function packet(op: number, version: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(version, 6);
  header.writeUInt32BE(op, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, body]);
}

const danmu = (text: string, uid = 42, uname = 'viewer') => ({
  cmd: 'DANMU_MSG',
  info: [[0, 1, 25, 16777215, 1700000000000, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ id_str: `dm-${text}` }) }], text, [uid, uname]],
});

describe('bilibili live config', () => {
  it('requires an id and a numeric room', () => {
    expect(() => resolveBilibiliLiveConfig({})).toThrow(/id/);
    expect(() => resolveBilibiliLiveConfig({ id: 'live' })).toThrow(/roomId/);
    expect(() => resolveBilibiliLiveConfig({ id: 'live', roomId: 'abc' })).toThrow(/roomId/);
  });

  it('applies defaults and clamps limits', () => {
    const config = resolveBilibiliLiveConfig({ id: 'live', roomId: 123, maxLength: 500, maxChunks: 0, minSendIntervalSec: 1 });
    expect(config).toMatchObject({ roomId: '123', sendMode: 'direct', maxLength: 100, maxChunks: 1, minSendIntervalMs: 2000 });
    expect(resolveBilibiliLiveConfig({ id: 'live', roomId: '9', sendMode: 'off' }).sendMode).toBe('off');
  });
});

describe('bilibili live packets', () => {
  it('encodes a header the server accepts', () => {
    const encoded = encodeLivePacket(LIVE_OP.auth, '{"roomid":1}');
    expect(encoded.readUInt32BE(0)).toBe(encoded.length);
    expect(encoded.readUInt16BE(4)).toBe(16);
    expect(encoded.readUInt32BE(8)).toBe(LIVE_OP.auth);
    expect(encoded.subarray(16).toString()).toBe('{"roomid":1}');
  });

  it('decodes plain, zlib and brotli frames with several packets', () => {
    const inner = Buffer.concat([
      packet(5, 0, Buffer.from(JSON.stringify(danmu('a')))),
      packet(5, 0, Buffer.from(JSON.stringify(danmu('b')))),
    ]);
    const popularity = Buffer.alloc(4);
    popularity.writeUInt32BE(77, 0);
    const frame = Buffer.concat([
      packet(3, 1, popularity),
      packet(5, 2, deflateSync(inner)),
      packet(5, 3, brotliCompressSync(inner)),
      packet(8, 1, Buffer.from('{"code":0}')),
    ]);
    const packets = decodeLiveFrame(frame);
    expect(packets[0]).toEqual({ op: 3, popularity: 77 });
    expect(packets.filter((p) => p.op === 5)).toHaveLength(4);
    expect(packets.at(-1)).toEqual({ op: 8, body: { code: 0 } });
  });

  it('drops a frame with a bad length instead of throwing', () => {
    const bad = packet(5, 0, Buffer.from('{}'));
    bad.writeUInt32BE(9999, 0);
    expect(decodeLiveFrame(bad)).toEqual([]);
    expect(decodeLiveFrame(packet(5, 0, Buffer.from('not json')))).toEqual([]);
  });
});

describe('bilibili live danmaku', () => {
  it('parses DANMU_MSG and ignores other commands', () => {
    expect(parseDanmaku(danmu(' hi '))).toEqual({ id: 'dm- hi ', text: 'hi', uid: '42', uname: 'viewer', timestamp: 1700000000000 });
    expect(parseDanmaku({ cmd: 'SEND_GIFT', data: {} })).toBeUndefined();
    expect(parseDanmaku({ cmd: 'DANMU_MSG', info: [[], '   ', [1, 'x']] })).toBeUndefined();
    expect(parseDanmaku({ cmd: 'DANMU_MSG:4:0:2:2:2:0', info: [[], 'ok', [0, '用**']] })).toMatchObject({ uid: '0', uname: '用**' });
  });

  it('turns the first numeric mention into the reply target', () => {
    expect(formatOutboundDanmaku([
      { type: 'mention', data: { id: '42', name: 'viewer' } },
      { type: 'text', data: { text: ' 欢迎\n来玩 ' } },
      { type: 'image', data: { url: 'x' } },
    ])).toEqual({ text: '欢迎 来玩', replyUid: '42' });
    expect(formatOutboundDanmaku('plain')).toEqual({ text: 'plain' });
  });

  it('splits into at most maxChunks pieces and marks truncation', () => {
    expect(splitDanmaku('一二三四五六', 4, 2)).toEqual(['一二三四', '五六']);
    expect(splitDanmaku('一二三四五六七八九', 4, 2)).toEqual(['一二三四', '五六七…']);
    expect(splitDanmaku('   ', 4, 2)).toEqual([]);
  });
});

describe('wbi signing', () => {
  it('matches the published reference vector', () => {
    const query = signWbi(
      { foo: '114', bar: '514', zab: 1919810 },
      '7cd084941338484aae1ad9425b84077c',
      '4932caff0ff746eab6f01bf08b70ac45',
      1702204169,
    );
    expect(query).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });
});
