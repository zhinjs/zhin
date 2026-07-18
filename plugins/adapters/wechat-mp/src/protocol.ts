/**
 * WeChat Official Account (MP) protocol helpers — no legacy Adapter/Endpoint.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import * as xml2js from 'xml2js';

export interface WeChatMpAdapterConfig {
  readonly name?: string;
  readonly appId?: string;
  readonly appSecret?: string;
  readonly token?: string;
  readonly encodingAESKey?: string;
  readonly path?: string;
  readonly encrypt?: boolean;
  /**
   * plain：明文入站/出站
   * compatible：入站可解密，被动回复用明文（微信兼容模式推荐）
   * secure：入站/出站均加密
   */
  readonly encryptMode?: 'plain' | 'compatible' | 'secure';
  /**
   * passive：订阅号默认，在 webhook 响应内被动回复（5 秒内）
   * customer_service：走客服消息 API（需接口权限）
   */
  readonly replyMode?: 'passive' | 'customer_service';
  /** 被动回复等待入站处理的最长时间（毫秒），默认 4500 */
  readonly passiveReplyTimeoutMs?: number;
  /** Transitional: legacy root `endpoints[]` with `context: wechat-mp`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedWeChatMpConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedWeChatMpConfig {
  readonly context: 'wechat-mp';
  readonly name: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly token: string;
  readonly encodingAESKey?: string;
  readonly path: string;
  readonly encrypt: boolean;
  readonly encryptMode: 'plain' | 'compatible' | 'secure';
  readonly replyMode: 'passive' | 'customer_service';
  readonly passiveReplyTimeoutMs: number;
}

export interface WeChatMessage {
  readonly ToUserName: string;
  readonly FromUserName: string;
  readonly CreateTime: number;
  readonly MsgType: string;
  readonly MsgId?: string;
  readonly Content?: string;
  readonly PicUrl?: string;
  readonly MediaId?: string;
  readonly Format?: string;
  readonly Recognition?: string;
  readonly ThumbMediaId?: string;
  readonly Location_X?: string;
  readonly Location_Y?: string;
  readonly Scale?: string;
  readonly Label?: string;
  readonly Title?: string;
  readonly Description?: string;
  readonly Url?: string;
  readonly Event?: string;
  readonly EventKey?: string;
  readonly Encrypt?: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

export interface WeChatAPIResponse {
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly msgid?: number;
}

export interface WeChatWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export function resolveWeChatMpConfig(config: WeChatMpAdapterConfig = {}): ResolvedWeChatMpConfig {
  const entry = config.endpoints?.find((item) => item.context === 'wechat-mp');
  const appId = config.appId ?? entry?.appId ?? process.env.WECHAT_APP_ID;
  const appSecret = config.appSecret ?? entry?.appSecret ?? process.env.WECHAT_APP_SECRET;
  const token = config.token ?? entry?.token ?? process.env.WECHAT_TOKEN;
  if (!appId || !appSecret || !token) {
    throw new TypeError(
      'WeChat MP adapter requires appId + appSecret + token (plugins.<key> or endpoints with context: wechat-mp)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.WECHAT_BOT_NAME
    || 'wechat-mp-bot';
  const path = config.path ?? entry?.path ?? '/wechat/webhook';
  const encodingAESKey = config.encodingAESKey ?? entry?.encodingAESKey;
  const encrypt = config.encrypt ?? entry?.encrypt ?? false;
  const encryptMode = config.encryptMode ?? entry?.encryptMode ?? (encrypt ? 'compatible' : 'plain');
  const replyMode = config.replyMode ?? entry?.replyMode ?? 'passive';
  const passiveReplyTimeoutMs = config.passiveReplyTimeoutMs
    ?? entry?.passiveReplyTimeoutMs
    ?? 4500;
  return {
    context: 'wechat-mp',
    name,
    appId,
    appSecret,
    token,
    encodingAESKey,
    path: path.startsWith('/') ? path : `/${path}`,
    encrypt: !!encrypt,
    encryptMode,
    replyMode,
    passiveReplyTimeoutMs,
  };
}

export function queryParam(value: string | null | undefined): string {
  return value ?? '';
}

/** URL 查询里的 Base64 可能把 `+` 解码成空格 */
export function normalizeEchostrParam(echostr: string): string {
  return echostr.replace(/ /g, '+');
}

export function computeSignatureHash(
  token: string,
  params: { readonly timestamp: string; readonly nonce: string; readonly echostr?: string },
): string {
  const { timestamp, nonce, echostr } = params;
  const arr = echostr
    ? [token, timestamp, nonce, echostr]
    : [token, timestamp, nonce];
  arr.sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

export function verifySignature(
  token: string,
  params: {
    readonly signature: string;
    readonly timestamp: string;
    readonly nonce: string;
    readonly echostr?: string;
  },
): boolean {
  const { signature, timestamp, nonce, echostr } = params;
  if (!signature || !timestamp || !nonce) return false;
  return computeSignatureHash(token, { timestamp, nonce, echostr }) === signature;
}

export function getAESKey(encodingAESKey: string): Buffer {
  return Buffer.from(`${encodingAESKey}=`, 'base64');
}

/** 微信安全模式加密 echostr 为较长 Base64；明文/兼容模式多为短字符串 */
export function isEncryptedEchostr(echostr: string): boolean {
  if (echostr.length < 32) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(echostr);
}

export function decryptEchostr(
  encrypted: string,
  encodingAESKey: string,
  appId: string,
): string {
  const aesKey = getAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);

  const pad = decrypted[decrypted.length - 1]!;
  const content = decrypted.subarray(0, decrypted.length - pad);

  const msgLen = content.readUInt32BE(16);
  const plain = content.subarray(20, 20 + msgLen).toString('utf8');
  const gotAppId = content.subarray(20 + msgLen).toString('utf8');

  if (gotAppId !== appId) {
    throw new Error(`AppID mismatch: expected ${appId}, got ${gotAppId}`);
  }
  return plain;
}

export async function parseXMLMessage(xmlString: string): Promise<WeChatMessage | null> {
  try {
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await parser.parseStringPromise(xmlString);
    return result.xml as WeChatMessage;
  } catch {
    return null;
  }
}

export async function decryptMessage(
  encryptedXml: string,
  msgSignature: string,
  timestamp: string,
  nonce: string,
  token: string,
  encodingAESKey: string,
  appId: string,
): Promise<string> {
  const parsed = await parseXMLMessage(encryptedXml);
  const encrypt = parsed?.Encrypt;
  if (!encrypt) throw new Error('Missing Encrypt field in encrypted message');

  const expected = createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
  if (expected !== msgSignature) {
    throw new Error('msg_signature verification failed');
  }

  const aesKey = getAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]);

  const pad = decrypted[decrypted.length - 1]!;
  const content = decrypted.subarray(0, decrypted.length - pad);
  const msgLen = content.readUInt32BE(16);
  const xmlContent = content.subarray(20, 20 + msgLen).toString('utf8');
  const gotAppId = content.subarray(20 + msgLen).toString('utf8');

  if (gotAppId !== appId) {
    throw new Error(`AppID mismatch: expected ${appId}, got ${gotAppId}`);
  }
  return xmlContent;
}

export function encryptMessage(
  replyXml: string,
  token: string,
  encodingAESKey: string,
  appId: string,
  requestTimestamp?: string,
): string {
  const aesKey = getAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  const random = randomBytes(16);
  const msgBuf = Buffer.from(replyXml, 'utf8');
  const appIdBuf = Buffer.from(appId, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);

  const plaintext = Buffer.concat([random, lenBuf, msgBuf, appIdBuf]);
  const blockSize = 32;
  const padLen = blockSize - (plaintext.length % blockSize);
  const padBuf = Buffer.alloc(padLen, padLen);
  const padded = Buffer.concat([plaintext, padBuf]);

  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  const encryptStr = encrypted.toString('base64');

  const timestamp = requestTimestamp || Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(8).toString('hex');
  const signature = createHash('sha1')
    .update([token, timestamp, nonce, encryptStr].sort().join(''))
    .digest('hex');

  return [
    '<xml>',
    `<Encrypt><![CDATA[${encryptStr}]]></Encrypt>`,
    `<MsgSignature><![CDATA[${signature}]]></MsgSignature>`,
    `<TimeStamp>${timestamp}</TimeStamp>`,
    `<Nonce><![CDATA[${nonce}]]></Nonce>`,
    '</xml>',
  ].join('\n');
}

export function buildTextReply(
  wechatMsg: Pick<WeChatMessage, 'FromUserName' | 'ToUserName'>,
  content: string,
): string {
  const cdata = (value: string) => value.replace(/]]>/g, ']]]]><![CDATA[>');
  const createTime = Math.floor(Date.now() / 1000);
  return [
    '<xml>',
    `<ToUserName><![CDATA[${cdata(wechatMsg.FromUserName)}]]></ToUserName>`,
    `<FromUserName><![CDATA[${cdata(wechatMsg.ToUserName)}]]></FromUserName>`,
    `<CreateTime>${createTime}</CreateTime>`,
    `<MsgType><![CDATA[text]]></MsgType>`,
    `<Content><![CDATA[${cdata(content)}]]></Content>`,
    '</xml>',
  ].join('');
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(msg: WeChatMessage): string {
  switch (msg.MsgType) {
    case 'text':
      return msg.Content || '(空消息)';
    case 'image':
      return msg.PicUrl ? `[image: ${msg.PicUrl}]` : '[image]';
    case 'voice':
      return msg.Recognition
        ? msg.Recognition
        : `[voice${msg.Format ? `: ${msg.Format}` : ''}]`;
    case 'video':
    case 'shortvideo':
      return '[video]';
    case 'location':
      return `[location: ${msg.Location_X},${msg.Location_Y}${msg.Label ? ` ${msg.Label}` : ''}]`;
    case 'link':
      return `[link: ${msg.Title ?? ''}${msg.Url ? ` ${msg.Url}` : ''}]`;
    case 'event':
      return `[event: ${msg.Event ?? ''}${msg.EventKey ? ` ${msg.EventKey}` : ''}]`;
    default:
      return `[不支持的消息类型: ${msg.MsgType}]`;
  }
}

/**
 * Built-in passive XML for subscribe etc. Empty string = fall through to gateway.
 */
export function resolveEventPassiveReply(msg: WeChatMessage): string {
  if (msg.MsgType !== 'event') return '';
  if (msg.Event === 'subscribe') {
    return buildTextReply(msg, '感谢关注！');
  }
  return '';
}

/**
 * Wire-encode an already-rendered outbound payload into客服消息 JSON body.
 */
export function formatCustomerServiceBody(
  target: string,
  payload: unknown,
): Record<string, unknown> {
  const messageData: Record<string, unknown> = {
    touser: target,
    msgtype: 'text',
    text: { content: '' },
  };

  if (typeof payload === 'string') {
    (messageData.text as { content: string }).content = payload;
    return messageData;
  }

  const segments: Array<string | WeChatWireSegment> = Array.isArray(payload)
    ? payload as Array<string | WeChatWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as WeChatWireSegment]
      : [];

  if (segments.length === 0) {
    (messageData.text as { content: string }).content = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return messageData;
  }

  const textParts: string[] = [];
  let hasMedia = false;

  for (const item of segments) {
    if (typeof item === 'string') {
      textParts.push(item);
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        textParts.push(String(data.text ?? data.content ?? ''));
        break;
      case 'image':
        if (!hasMedia && data.mediaId) {
          messageData.msgtype = 'image';
          messageData.image = { media_id: data.mediaId };
          delete messageData.text;
          hasMedia = true;
        }
        break;
      case 'voice':
        if (!hasMedia && data.mediaId) {
          messageData.msgtype = 'voice';
          messageData.voice = { media_id: data.mediaId };
          delete messageData.text;
          hasMedia = true;
        }
        break;
      case 'video':
        if (!hasMedia && data.mediaId) {
          messageData.msgtype = 'video';
          messageData.video = {
            media_id: data.mediaId,
            title: data.title || '',
            description: data.description || '',
          };
          delete messageData.text;
          hasMedia = true;
        }
        break;
      default:
        break;
    }
  }

  if (!hasMedia && textParts.length > 0 && messageData.text) {
    (messageData.text as { content: string }).content = textParts.join('\n');
  }
  return messageData;
}

/** Extract plain text from a rendered outbound payload (for passive XML). */
export function extractOutboundText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!Array.isArray(payload)) {
    if (payload && typeof payload === 'object' && 'type' in (payload as object)) {
      const seg = payload as WeChatWireSegment;
      if (seg.type === 'text') return String(seg.data?.text ?? seg.data?.content ?? '');
    }
    return payload == null ? '' : String(payload);
  }
  const parts: string[] = [];
  for (const item of payload) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (item && typeof item === 'object' && 'type' in item) {
      const seg = item as WeChatWireSegment;
      if (seg.type === 'text') {
        parts.push(String(seg.data?.text ?? seg.data?.content ?? ''));
      }
    }
  }
  return parts.join('\n');
}

export async function readTextBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<string> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
