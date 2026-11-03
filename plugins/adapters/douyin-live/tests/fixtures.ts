/** 测试用最小 protobuf 编码器：构造 PushFrame / Response / ChatMessage 夹具帧（不连真实网络）。 */
import { gzipSync } from 'node:zlib';

type Value = bigint | number | string | Uint8Array;

function varint(value: bigint): number[] {
  const out: number[] = [];
  let v = BigInt.asUintN(64, value);
  while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; }
  out.push(Number(v));
  return out;
}

/** 按字段号顺序编码一个 message；数字走 varint，字符串 / 字节走 length-delimited。 */
export function message(...fields: readonly (readonly [number, Value | undefined])[]): Uint8Array {
  const out: number[] = [];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    if (typeof value === 'bigint' || typeof value === 'number') {
      out.push(...varint(BigInt(field << 3)), ...varint(BigInt(value)));
    } else {
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
      out.push(...varint(BigInt((field << 3) | 2)), ...varint(BigInt(bytes.length)), ...bytes);
    }
  }
  return Uint8Array.from(out);
}

export interface ChatFixture {
  readonly text: string;
  readonly uid?: bigint | number;
  readonly idStr?: string;
  readonly nickname?: string;
  readonly msgId?: bigint | number;
  readonly roomId?: bigint | number;
  readonly createTime?: number;
  readonly eventTime?: number;
}

export function chatPayload(chat: ChatFixture): Uint8Array {
  const common = message([1, 'WebcastChatMessage'], [2, chat.msgId], [3, chat.roomId], [4, chat.createTime]);
  const user = message([1, chat.uid], [3, chat.nickname], [1028, chat.idStr]);
  return message([1, common], [2, user], [3, chat.text], [15, chat.eventTime]);
}

export function webcastMessage(method: string, payload: Uint8Array, msgId?: bigint | number): Uint8Array {
  return message([1, method], [2, payload], [3, msgId]);
}

export function responseFrame(
  messages: readonly Uint8Array[],
  options: { readonly needAck?: boolean; readonly internalExt?: string; readonly logId?: bigint | number; readonly gzip?: boolean } = {},
): Buffer {
  const response = message(
    ...messages.map((item) => [1, item] as const),
    [5, options.internalExt],
    [9, options.needAck ? 1 : undefined],
  );
  const gzip = options.gzip ?? true;
  const payload = gzip ? gzipSync(response) : response;
  return Buffer.from(message([2, options.logId ?? 77], [6, gzip ? 'gzip' : undefined], [7, 'msg'], [8, payload]));
}

export const chatFrame = (chat: ChatFixture, options?: Parameters<typeof responseFrame>[1]) =>
  responseFrame([webcastMessage('WebcastChatMessage', chatPayload(chat))], options);

export const giftFrame = () => responseFrame([webcastMessage('WebcastGiftMessage', message([3, 'gift']))]);
