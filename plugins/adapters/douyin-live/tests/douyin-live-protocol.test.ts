import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DOUYIN_CHAT_METHOD,
  decodePushFrame,
  decodeWebcastFrame,
  encodeAck,
  encodeHeartbeat,
  formatOutboundDanmaku,
  parseChatMessage,
  readProtoFields,
  resolveDouyinLiveConfig,
  splitDanmaku,
} from '../src/protocol.js';
import { buildSignatureStub, parseRoomIdFromHtml } from '../src/client.js';
import { chatFrame, chatPayload, giftFrame, message, responseFrame, webcastMessage } from './fixtures.js';

describe('douyin live config', () => {
  it('requires an id and a numeric web_rid', () => {
    expect(() => resolveDouyinLiveConfig({})).toThrow(/id/);
    expect(() => resolveDouyinLiveConfig({ id: 'live' })).toThrow(/roomId/);
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: 'abc' })).toThrow(/roomId/);
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: '000' })).toThrow(/roomId/);
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: '0123' })).toThrow(/roomId/);
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: 1.5 })).toThrow(/roomId/);
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: 2 ** 53 })).toThrow(/roomId/);
    expect(resolveDouyinLiveConfig({ id: 'live', roomId: '9007199254740993' }).roomId).toBe('9007199254740993');
  });

  it('defaults to listen-only (sendMode off) and clamps limits', () => {
    const config = resolveDouyinLiveConfig({ id: 'live', roomId: 123456789 });
    expect(config).toMatchObject({ roomId: '123456789', sendMode: 'off', maxLength: 50, maxChunks: 2, minSendIntervalMs: 5000 });
    expect(config).not.toHaveProperty('cookie');
    const clamped = resolveDouyinLiveConfig({ id: 'live', roomId: '9', maxLength: 500, maxChunks: 0, minSendIntervalSec: 1, sendMode: 'bogus' });
    expect(clamped).toMatchObject({ sendMode: 'off', maxLength: 100, maxChunks: 1, minSendIntervalMs: 2000 });
    expect(resolveDouyinLiveConfig({ id: 'live', roomId: '9', sendMode: 'direct' }).sendMode).toBe('direct');
  });

  it('accepts only http(s) signer URLs', () => {
    expect(resolveDouyinLiveConfig({ id: 'live', roomId: '9', signerUrl: 'http://127.0.0.1:8080/sign' }).signerUrl).toBe('http://127.0.0.1:8080/sign');
    expect(() => resolveDouyinLiveConfig({ id: 'live', roomId: '9', signerUrl: 'file:///etc/passwd' })).toThrow(/signerUrl/);
  });
});

describe('douyin live frames', () => {
  it('decodes a gzip PushFrame → Response → WebcastChatMessage and ignores other methods', () => {
    const frame = responseFrame([
      webcastMessage('WebcastGiftMessage', message([3, 'gift'])),
      webcastMessage(DOUYIN_CHAT_METHOD, chatPayload({ text: ' 主播好 ', uid: 42n, nickname: 'viewer', msgId: 7_300_000_000_000_000_001n, roomId: 7_400_000_000_000_000_002n, createTime: 1_700_000_000_123 })),
    ], { needAck: true, internalExt: 'ext-1', logId: 9_000_000_000_000_000_003n });
    const decoded = decodeWebcastFrame(frame)!;
    expect(decoded.frame).toMatchObject({ logId: '9000000000000000003', payloadType: 'msg', payloadEncoding: 'gzip' });
    expect(decoded.response).toMatchObject({ needAck: true, internalExt: 'ext-1' });
    const chats = decoded.response!.messages.map((item) => parseChatMessage(item));
    expect(chats[0]).toBeUndefined();
    expect(chats[1]).toEqual({
      id: '7300000000000000001', text: '主播好', uid: '42', nickname: 'viewer', roomId: '7400000000000000002', timestamp: 1_700_000_000_123,
    });
  });

  it('decodes an uncompressed payload too', () => {
    const decoded = decodeWebcastFrame(chatFrame({ text: 'raw', uid: 1, nickname: 'a', msgId: 5 }, { gzip: false }))!;
    expect(parseChatMessage(decoded.response!.messages[0]!)?.text).toBe('raw');
  });

  it('drops broken frames without throwing', () => {
    expect(decodeWebcastFrame(Uint8Array.from([0xff, 0xff, 0xff]))).toBeUndefined();
    const broken = Buffer.from(message([7, 'msg'], [6, 'gzip'], [8, Uint8Array.from([0x1f, 0x8b, 1, 2, 3])]));
    expect(decodeWebcastFrame(broken)).toMatchObject({ frame: { payloadType: 'msg' } });
    expect(decodeWebcastFrame(broken)?.response).toBeUndefined();
    expect(decodeWebcastFrame(encodeHeartbeat())?.response).toBeUndefined();
  });

  it('encodes heartbeat and ack frames', () => {
    expect(decodePushFrame(encodeHeartbeat())).toMatchObject({ payloadType: 'hb', logId: '0' });
    const ack = decodePushFrame(encodeAck('9000000000000000003', 'ext-1'))!;
    expect(ack).toMatchObject({ payloadType: 'ack', logId: '9000000000000000003' });
    expect(Buffer.from(ack.payload).toString()).toBe('ext-1');
  });

  it('prefers user.idStr, falls back to the outer msgId and converts second timestamps', () => {
    const outer = { method: DOUYIN_CHAT_METHOD, msgId: '88', payload: chatPayload({ text: 'hi', uid: 1n, idStr: '123456789012345678901', nickname: 'n', eventTime: 1_700_000_000 }) };
    expect(parseChatMessage(outer)).toMatchObject({ id: '88', uid: '123456789012345678901', timestamp: 1_700_000_000_000 });
    const anonymous = { method: DOUYIN_CHAT_METHOD, msgId: '0', payload: chatPayload({ text: 'hi', nickname: '游客' }) };
    expect(parseChatMessage(anonymous, () => 42)).toEqual({ text: 'hi', uid: '0', nickname: '游客', timestamp: 42 });
    expect(parseChatMessage({ method: DOUYIN_CHAT_METHOD, msgId: '1', payload: chatPayload({ text: '   ' }) })).toBeUndefined();
  });

  it('skips unknown wire fields while reading', () => {
    const bytes = Uint8Array.from([...message([1, 5]), 0x15, 1, 2, 3, 4, ...message([2, 'x'])]);
    expect(readProtoFields(bytes).map((item) => item.field)).toEqual([1, 2, 2]);
    expect(decodeWebcastFrame(giftFrame())?.response?.messages[0]?.method).toBe('WebcastGiftMessage');
  });
});

describe('douyin live signing and room parsing', () => {
  it('builds X-MS-STUB as md5 of the fixed parameter template', () => {
    const params = new Map([
      ['live_id', '1'], ['aid', '6383'], ['version_code', '180800'], ['webcast_sdk_version', '1.0.14-beta.0'],
      ['room_id', '7400'], ['did_rule', '3'], ['user_unique_id', '1234'], ['device_platform', 'web'], ['identity', 'audience'],
      ['app_name', 'ignored'],
    ]);
    const plain = 'live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.14-beta.0,room_id=7400,sub_room_id=,sub_channel_id=,did_rule=3,user_unique_id=1234,device_platform=web,device_type=,ac=,identity=audience';
    expect(buildSignatureStub(params)).toBe(createHash('md5').update(plain).digest('hex'));
  });

  it('extracts the internal room_id from escaped or plain page data', () => {
    expect(parseRoomIdFromHtml('self.__pace_f.push([1,"{\\"roomId\\":\\"7400000000000000002\\"}"])')).toBe('7400000000000000002');
    expect(parseRoomIdFromHtml('{"roomId":"7400"}')).toBe('7400');
    expect(parseRoomIdFromHtml('{"roomId":"0"}')).toBeUndefined();
    expect(parseRoomIdFromHtml('<html></html>')).toBeUndefined();
  });
});

describe('douyin live outbound formatting (reserved for direct)', () => {
  it('folds mentions into the body as @nickname', () => {
    expect(formatOutboundDanmaku([{ type: 'mention', data: { id: '42', name: '小明' } }, { type: 'text', data: { text: '欢迎！' } }])).toBe('@小明 欢迎！');
    expect(formatOutboundDanmaku([{ type: 'mention', data: { id: '42' } }, 'hi'])).toBe('@42 hi');
    expect(formatOutboundDanmaku(['hi', { type: 'mention', data: { name: 'A' } }, 'yo'])).toBe('hi @A yo');
    expect(formatOutboundDanmaku([{ type: 'image', data: { url: 'x' } }, { type: 'text', data: { text: ' a  b ' } }])).toBe('a b');
    expect(formatOutboundDanmaku(null)).toBe('');
    expect(formatOutboundDanmaku([null, undefined, 7, { type: 'text', data: { text: 'ok' } }])).toBe('ok');
  });

  it('splits into bounded chunks and truncates the rest', () => {
    expect(splitDanmaku('一二三四五六七八九十十一十二', 10, 2)).toEqual(['一二三四五六七八九十', '十一十二']);
    expect(splitDanmaku('a'.repeat(25), 10, 2)).toEqual(['a'.repeat(10), `${'a'.repeat(9)}…`]);
    expect(splitDanmaku('  ', 10, 2)).toEqual([]);
  });
});
