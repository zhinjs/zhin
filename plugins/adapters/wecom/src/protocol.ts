/**
 * WeCom (企业微信) protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import { createHash, createDecipheriv } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface WecomAdapterConfig {
  readonly name?: string;
  readonly corpId?: string;
  readonly agentSecret?: string;
  readonly token?: string;
  readonly encodingAESKey?: string;
  readonly webhookPath?: string;
  readonly apiBaseUrl?: string;
  /** Transitional: legacy root `endpoints[]` with `context: wecom`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedWecomConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedWecomConfig {
  readonly context: 'wecom';
  readonly name: string;
  readonly corpId: string;
  readonly agentSecret: string;
  readonly token: string;
  readonly encodingAESKey: string;
  readonly webhookPath: string;
  readonly apiBaseUrl: string;
}

export interface WecomMessage {
  readonly ToUserName: string;
  readonly FromUserName: string;
  readonly CreateTime: number;
  readonly MsgType: 'text' | 'image' | 'voice' | 'video' | 'shortvideo' | 'location' | 'link' | 'event' | string;
  readonly Content?: string;
  readonly MsgId?: string;
  readonly PicUrl?: string;
  readonly MediaId?: string;
  readonly ThumbMediaId?: string;
  readonly Format?: string;
  readonly Recognition?: string;
  readonly Location_X?: string;
  readonly Location_Y?: string;
  readonly Scale?: string;
  readonly Label?: string;
  readonly Title?: string;
  readonly Description?: string;
  readonly Url?: string;
  readonly Event?: string;
  readonly EventKey?: string;
  readonly AgentID?: string;
}

export interface AccessToken {
  access_token: string;
  expires_in: number;
  timestamp: number;
}

export interface WecomApiResponse {
  readonly errcode: number;
  readonly errmsg?: string;
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly msgid?: string;
  readonly userlist?: unknown[];
  readonly department?: unknown[];
  readonly [key: string]: unknown;
}

export interface WecomWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface WecomSendBody {
  readonly msgtype: string;
  readonly data: Record<string, unknown>;
}

export function resolveWecomConfig(config: WecomAdapterConfig = {}): ResolvedWecomConfig {
  const entry = config.endpoints?.find((item) => item.context === 'wecom');
  const corpId = config.corpId ?? entry?.corpId ?? process.env.WECOM_CORP_ID;
  const agentSecret = config.agentSecret ?? entry?.agentSecret ?? process.env.WECOM_AGENT_SECRET;
  const token = config.token ?? entry?.token ?? process.env.WECOM_TOKEN;
  const encodingAESKey = config.encodingAESKey
    ?? entry?.encodingAESKey
    ?? process.env.WECOM_AES_KEY;
  if (!corpId || !agentSecret || !token || !encodingAESKey) {
    throw new TypeError(
      'WeCom adapter requires corpId + agentSecret + token + encodingAESKey (plugins.<key> or endpoints with context: wecom)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.WECOM_BOT_NAME
    || 'wecom-bot';
  return {
    context: 'wecom',
    name,
    corpId,
    agentSecret,
    token,
    encodingAESKey,
    webhookPath: normalizeWebhookPath(
      config.webhookPath ?? entry?.webhookPath ?? '/wecom/callback',
    ),
    apiBaseUrl: config.apiBaseUrl
      ?? entry?.apiBaseUrl
      ?? 'https://qyapi.weixin.qq.com',
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/wecom/callback';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function queryParam(value: string | null | undefined): string {
  return value ?? '';
}

/** URL 查询里的 Base64 可能把 `+` 解码成空格 */
export function normalizeEchostrParam(echostr: string): string {
  return echostr.replace(/ /g, '+');
}

export function getAesKey(encodingAESKey: string): Buffer {
  const aesKey = Buffer.from(`${encodingAESKey}=`, 'base64');
  if (aesKey.length !== 32) {
    throw new Error(`encodingAESKey must produce a 32-byte key, got ${aesKey.length} bytes`);
  }
  return aesKey;
}

export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string,
): boolean {
  try {
    const hash = createHash('sha1')
      .update([token, timestamp, nonce, encrypt].sort().join(''))
      .digest('hex');
    return hash === signature;
  } catch {
    return false;
  }
}

export function decryptMessage(
  encrypted: string,
  encodingAESKey: string,
  corpId: string,
): string | null {
  try {
    const aesKey = getAesKey(encodingAESKey);
    const buf = Buffer.from(encrypted, 'base64');
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);
    const pad = decrypted[decrypted.length - 1]!;
    const content = decrypted.subarray(0, decrypted.length - pad);
    const msgLen = content.readUInt32BE(16);
    const msg = content.subarray(20, 20 + msgLen).toString('utf8');
    const extractedCorpId = content.subarray(20 + msgLen).toString('utf8');
    if (extractedCorpId !== corpId) return null;
    return msg;
  } catch {
    return null;
  }
}

export function extractEncryptFromXml(xml: string): string | null {
  const match = xml.match(/<Encrypt><!\[CDATA\[([^[\]]+)\]\]><\/Encrypt>/);
  return match?.[1] ?? null;
}

export function parseXmlMessage(xml: string): WecomMessage | null {
  try {
    const get = (tag: string): string | undefined => {
      const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\[\\]]*)\\]\\]><\\/${tag}>`))
        || xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
      return m ? m[1] : undefined;
    };
    const msgType = get('MsgType');
    if (!msgType) return null;

    const msg: WecomMessage = {
      ToUserName: get('ToUserName') || '',
      FromUserName: get('FromUserName') || '',
      CreateTime: Number(get('CreateTime') || Date.now()),
      MsgType: msgType,
      MsgId: get('MsgId'),
      AgentID: get('AgentID'),
      Content: get('Content'),
      PicUrl: get('PicUrl'),
      MediaId: get('MediaId'),
      ThumbMediaId: get('ThumbMediaId'),
      Format: get('Format'),
      Recognition: get('Recognition'),
      Location_X: get('Location_X'),
      Location_Y: get('Location_Y'),
      Scale: get('Scale'),
      Label: get('Label'),
      Title: get('Title'),
      Description: get('Description'),
      Url: get('Url'),
      Event: get('Event'),
      EventKey: get('EventKey'),
    };
    return msg;
  } catch {
    return null;
  }
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(msg: WecomMessage): string {
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
      return `[位置] ${msg.Label || ''} (${msg.Location_X}, ${msg.Location_Y})`.trim();
    case 'link':
      return `[link: ${msg.Title ?? ''}${msg.Url ? ` ${msg.Url}` : ''}]`;
    case 'event':
      return `[事件] ${msg.Event || ''} ${msg.EventKey || ''}`.trim();
    default:
      return `[不支持的消息类型: ${msg.MsgType}]`;
  }
}

export function resolveChatType(fromUserName: string): 'group' | 'private' {
  return fromUserName.endsWith('@chatroom') ? 'group' : 'private';
}

/**
 * Wire-encode an already-rendered outbound payload into WeCom message/send body parts.
 */
export function formatOutboundBody(payload: unknown): WecomSendBody {
  if (typeof payload === 'string') {
    return { msgtype: 'text', data: { content: payload } };
  }
  if (!Array.isArray(payload)) {
    return { msgtype: 'text', data: { content: String(payload ?? '') } };
  }

  const textParts: string[] = [];
  let hasMedia = false;
  let mediaType = '';
  let mediaData: Record<string, unknown> | null = null;

  for (const item of payload) {
    if (typeof item === 'string') {
      textParts.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const seg = item as WecomWireSegment;
    const data = seg.data ?? {};
    switch (seg.type) {
      case 'text':
        textParts.push(String(data.content ?? data.text ?? ''));
        break;
      case 'at': {
        const userId = data.id ?? data.userId;
        if (userId) textParts.push(`<@${userId}>`);
        break;
      }
      case 'image':
        if (!hasMedia) {
          hasMedia = true;
          mediaType = 'image';
          mediaData = { media_id: data.file || data.url };
        }
        break;
      case 'markdown':
        if (!hasMedia) {
          hasMedia = true;
          mediaType = 'markdown';
          mediaData = { content: data.content || data.text };
        }
        break;
      case 'link':
        if (!hasMedia) {
          hasMedia = true;
          mediaType = 'news';
          mediaData = {
            articles: [{
              title: data.title || '链接',
              description: data.text || data.content || '',
              url: data.url,
              picurl: data.picUrl,
            }],
          };
        }
        break;
      default:
        break;
    }
  }

  if (hasMedia && mediaData) {
    return { msgtype: mediaType, data: mediaData };
  }
  return { msgtype: 'text', data: { content: textParts.join('') } };
}

export function buildSendRequestBody(
  targetId: string,
  content: WecomSendBody,
  agentId: string | number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    msgtype: content.msgtype,
    agentid: agentId,
    [content.msgtype]: content.data,
  };
  if (targetId.endsWith('@chatroom')) {
    body.chatid = targetId;
  } else {
    body.touser = targetId;
  }
  return body;
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
