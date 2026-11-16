/**
 * Configuration and pure message mapping between `@wchats/ipad` and Zhin.
 * No I/O here: everything is unit-testable without the SDK.
 */
import { isMediaRef, type MediaRef, type Segment } from '@zhin.js/im-contract';
import type { EndpointProfileConfiguration } from 'zhin.js/adapter';

export const ADAPTER_KEY = 'ipad-wechat';
export const GROUP_SUFFIX = '@chatroom';

/** Device-verification page (slider / face). Only needed when WeChat asks for it. */
export interface IpadWechatVerificationConfig {
  /** PEM private key file of the page certificate. */
  readonly key: string;
  /** PEM certificate (chain) file; its SAN must match `publicOrigin`. */
  readonly cert: string;
  /** Listen address, default `127.0.0.1` (use `0.0.0.0` for a phone on the LAN). */
  readonly host?: string;
  /** Listen port, default `8443`. */
  readonly port?: number;
  /** HTTPS origin the phone can reach, e.g. `https://192.168.1.10:8443`. */
  readonly publicOrigin?: string;
  /** How long to wait for the person to finish verification, default 10 minutes. */
  readonly timeoutMs?: number;
}

/** One expanded endpoint (account) configuration. */
export interface IpadWechatEndpointConfig extends EndpointProfileConfiguration {
  readonly id: string;
  /** SDK state root. Each account uses `<dataDir>/accounts/<instance>`; never share one between processes. */
  readonly dataDir?: string;
  /** First-login / restore timeout (SDK `timeoutMillis`), default 600000. */
  readonly loginTimeoutMs?: number;
  /** QR scan polling interval (SDK `pollIntervalMillis`), 100..30000, default 1000. */
  readonly qrPollIntervalMs?: number;
  /** Business heartbeat interval passed to the SDK; omitted uses the SDK default. */
  readonly heartbeatIntervalSeconds?: number;
  /** Let the SDK reconnect the long link, default true. */
  readonly reconnect?: boolean;
  /** Skip messages this account sent from another device, default true. */
  readonly ignoreSelfMessages?: boolean;
  /** Download inbound images before dispatch, default true. */
  readonly downloadImages?: boolean;
  readonly verification?: IpadWechatVerificationConfig;
}

export interface ResolvedIpadWechatConfig {
  readonly id: string;
  readonly dataDir: string;
  readonly loginTimeoutMs: number;
  readonly qrPollIntervalMs: number;
  readonly heartbeatIntervalSeconds?: number;
  readonly reconnect: boolean;
  readonly ignoreSelfMessages: boolean;
  readonly downloadImages: boolean;
  readonly verification?: Required<Omit<IpadWechatVerificationConfig, 'publicOrigin'>> & { readonly publicOrigin?: string };
}

export const DEFAULT_DATA_DIR = 'data/ipad-wechat';
const DEFAULT_LOGIN_TIMEOUT_MS = 600_000;
const DEFAULT_QR_POLL_INTERVAL_MS = 1_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 10 * 60_000;

function positiveInteger(value: unknown, name: string, fallback: number, range?: readonly [number, number]): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`ipad-wechat ${name} must be a positive integer`);
  }
  if (range && (value < range[0] || value > range[1])) {
    throw new TypeError(`ipad-wechat ${name} must be between ${range[0]} and ${range[1]}`);
  }
  return value;
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`ipad-wechat ${name} must be a non-empty string`);
  return value.trim();
}

export function resolveIpadWechatConfig(config: IpadWechatEndpointConfig): ResolvedIpadWechatConfig {
  const id = typeof config.id === 'string' ? config.id.trim() : '';
  if (!/^[A-Za-z0-9_.-]+$/u.test(id)) {
    throw new TypeError('ipad-wechat endpoint id must use letters, numbers, dot, underscore, or hyphen');
  }
  const verification = config.verification;
  let resolvedVerification: ResolvedIpadWechatConfig['verification'];
  if (verification !== undefined) {
    if (!verification || typeof verification !== 'object') throw new TypeError('ipad-wechat verification must be an object');
    const publicOrigin = verification.publicOrigin?.trim();
    if (publicOrigin !== undefined) {
      const url = new URL(publicOrigin);
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.username) {
        throw new TypeError('ipad-wechat verification.publicOrigin must be a bare https:// origin');
      }
    }
    resolvedVerification = Object.freeze({
      key: nonEmpty(verification.key, 'verification.key'),
      cert: nonEmpty(verification.cert, 'verification.cert'),
      host: verification.host?.trim() || '127.0.0.1',
      port: positiveInteger(verification.port, 'verification.port', 8443, [1, 65535]),
      timeoutMs: positiveInteger(verification.timeoutMs, 'verification.timeoutMs', DEFAULT_VERIFICATION_TIMEOUT_MS),
      ...(publicOrigin ? { publicOrigin } : {}),
    });
  }
  return Object.freeze({
    id,
    dataDir: config.dataDir?.trim() || DEFAULT_DATA_DIR,
    loginTimeoutMs: positiveInteger(config.loginTimeoutMs, 'loginTimeoutMs', DEFAULT_LOGIN_TIMEOUT_MS),
    qrPollIntervalMs: positiveInteger(config.qrPollIntervalMs, 'qrPollIntervalMs', DEFAULT_QR_POLL_INTERVAL_MS, [100, 30_000]),
    ...(config.heartbeatIntervalSeconds !== undefined
      ? { heartbeatIntervalSeconds: positiveInteger(config.heartbeatIntervalSeconds, 'heartbeatIntervalSeconds', 0) }
      : {}),
    reconnect: config.reconnect ?? true,
    ignoreSelfMessages: config.ignoreSelfMessages ?? true,
    downloadImages: config.downloadImages ?? true,
    ...(resolvedVerification ? { verification: resolvedVerification } : {}),
  });
}

export function isGroupId(id: string): boolean {
  return id.endsWith(GROUP_SUFFIX);
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

/** The message fields the mapping reads (a subset of the SDK MessageContext). */
export interface InboundIpadMessage {
  readonly id: string;
  readonly kind: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly conversationId: string;
  readonly senderId: string;
  readonly groupSenderId: string | null;
  readonly body: string;
  readonly mediaHandle?: string;
}

const KIND_PLACEHOLDER: Readonly<Record<string, string>> = Object.freeze({
  image: '[图片]', voice: '[语音]', video: '[视频]', emoji: '[表情]', location: '[位置]',
  contact_card: '[名片]', app: '[链接]', call: '[通话]', call_notify: '[通话]', call_invite: '[通话]',
});

export interface InboundProjection {
  readonly conversation: Readonly<{ kind: 'private' | 'group'; id: string }>;
  readonly senderId: string;
  readonly content: string;
  readonly segments: readonly Segment[];
}

/** Sender of an incoming message: the member in a group, the peer otherwise. */
export function inboundSenderId(message: InboundIpadMessage): string {
  return isGroupId(message.conversationId) && message.direction === 'incoming'
    ? message.groupSenderId ?? message.senderId
    : message.senderId;
}

/**
 * Canonical projection. `imagePath` is the downloaded file of an image message;
 * without it the image stays a text placeholder (the SDK media handle is opaque,
 * not a URL, and is never exposed).
 */
export function projectInbound(message: InboundIpadMessage, options: { imagePath?: string } = {}): InboundProjection {
  const group = isGroupId(message.conversationId);
  const segments: Segment[] = [];
  let content: string;
  if (message.kind === 'image' && options.imagePath) {
    segments.push({ type: 'image', data: { media: { kind: 'path', value: options.imagePath } } });
    content = KIND_PLACEHOLDER.image!;
  } else if (message.kind === 'text') {
    content = message.body;
    if (content) segments.push({ type: 'text', data: { text: content } });
  } else {
    content = message.mediaHandle || !message.body ? (KIND_PLACEHOLDER[message.kind] ?? `[${message.kind}]`) : message.body;
    segments.push({ type: 'text', data: { text: content } });
  }
  return Object.freeze({
    conversation: Object.freeze({ kind: group ? 'group' : 'private', id: message.conversationId }),
    senderId: inboundSenderId(message),
    content,
    segments: Object.freeze(segments),
  });
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export type OutboundPart =
  | Readonly<{ kind: 'text'; text: string; at: readonly string[] }>
  | Readonly<{ kind: 'image'; media: MediaRef }>;

interface WireSegment { readonly type: string; readonly data?: Record<string, unknown> }

function toWireSegments(payload: unknown): WireSegment[] {
  if (typeof payload === 'string') return [{ type: 'text', data: { text: payload } }];
  const items = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? [payload] : [];
  const segments: WireSegment[] = [];
  for (const item of items) {
    if (typeof item === 'string') segments.push({ type: 'text', data: { text: item } });
    else if (item && typeof item === 'object' && typeof (item as WireSegment).type === 'string') segments.push(item as WireSegment);
  }
  if (!segments.length && payload != null && typeof payload !== 'object') segments.push({ type: 'text', data: { text: String(payload) } });
  return segments;
}

/**
 * Split a rendered payload into what the SDK can send: consecutive text (with
 * `@` mentions, groups only) becomes one text message, every image its own
 * message, in order. `reply` segments are dropped (the SDK has no quote send).
 * Anything else is an error: the declared `segments.supported` list keeps core
 * from sending it here.
 */
export function planOutbound(payload: unknown, group: boolean): OutboundPart[] {
  const parts: OutboundPart[] = [];
  let text = '';
  let at: string[] = [];
  const flush = () => {
    if (text.trim()) parts.push(Object.freeze({ kind: 'text', text, at: Object.freeze([...new Set(at)]) }));
    text = ''; at = [];
  };
  for (const segment of toWireSegments(payload)) {
    const data = segment.data ?? {};
    switch (segment.type) {
      case 'text':
      case 'markdown':
        text += String(data.text ?? '');
        break;
      case 'mention': {
        const target = String(data.target ?? data.user_id ?? data.id ?? '').trim();
        if (!target) break;
        const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : target;
        if (group && target !== 'all') at.push(target);
        // U+2005 is the separator WeChat itself puts after a mention.
        text += `@${name}\u2005`;
        break;
      }
      case 'image': {
        const media = data.media;
        if (!isMediaRef(media)) throw new Error('ipad-wechat: image segment without a media reference');
        flush();
        parts.push(Object.freeze({ kind: 'image', media }));
        break;
      }
      case 'reply':
        break;
      default:
        throw new Error(`ipad-wechat: unsupported outbound segment "${segment.type}"`);
    }
  }
  flush();
  return parts;
}
