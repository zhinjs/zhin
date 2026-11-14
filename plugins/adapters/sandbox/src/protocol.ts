import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/** Sandbox WebSocket wire protocol helpers (no legacy Adapter/Endpoint). */

import { readFileSync } from 'node:fs';
import { isMediaRef, type ConversationKind, type ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  normalizeSandboxAgentRunConfig,
  type SandboxAgentRunConfig,
} from './run-config.js';

const logger = getLogger('sandbox');

export type MessageType = 'private' | 'group' | 'guild' | 'direct' | 'channel';

export interface MessageElement {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface SandboxWsSocket {
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on?(event: 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
  off?(
    event: 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ): void;
  addEventListener?(
    type: 'message' | 'close' | 'error',
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
  removeEventListener?(
    type: 'message' | 'close' | 'error',
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
}

/** A Host {@link WsConnection} seen through the {@link SandboxWsSocket} surface. */
export function sandboxSocketOf(connection: {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
}): SandboxWsSocket {
  let open = true;
  connection.onClose(() => { open = false; });
  const subscriptions = new Map<(...args: unknown[]) => void, () => void>();
  return {
    get readyState() { return open ? WS_OPEN : 3; },
    send: (data) => { if (open) connection.send(data); },
    close: (code, reason) => connection.close(code, reason),
    on(event, listener) {
      if (event === 'message') {
        subscriptions.set(listener, connection.onMessage((data) => {
          listener(typeof data === 'string' ? data : new TextDecoder().decode(data));
        }));
      } else if (event === 'close') {
        subscriptions.set(listener, connection.onClose(() => listener()));
      }
      // Transport errors surface as a close on a WsConnection.
    },
    off(_event, listener) {
      subscriptions.get(listener)?.();
      subscriptions.delete(listener);
    },
  };
}

export type ResolvedSandboxBot = {
  readonly context: 'sandbox';
  readonly id: string;
  readonly owner: string;
  readonly randomNamePerConnection: boolean;
  readonly streaming: boolean;
  readonly streamingIntervalMs: number;
  /** Configured `nickname`; `[@nickname]` also mentions this bot. */
  readonly nickname?: string;
};

/** One endpoint config after AdapterIndex expands `plugins.<instanceKey>.endpoints`. */
export interface SandboxEndpointConfig extends EndpointProfileConfiguration {
  readonly id?: string;
  readonly owner?: string;
  readonly streaming?: boolean;
  readonly streamingIntervalMs?: number;
}

export function resolveSandboxEndpoint(
  config: SandboxEndpointConfig,
): ResolvedSandboxBot {
  const id = optionalEndpointField(config.id) ?? 'sandbox-bot';
  const owner = optionalEndpointField(config.owner) ?? 'sandbox-user';
  const streamingIntervalMs = config.streamingIntervalMs ?? 500;
  if (!Number.isFinite(streamingIntervalMs) || streamingIntervalMs < 0) throw new TypeError('streamingIntervalMs must be a non-negative finite number');
  return {
    context: 'sandbox',
    id,
    owner,
    // The endpoint id participates in the Agent session key. Keep it stable
    // across browser reconnects and Host restarts so a persisted playground
    // session resumes the same Agent context.
    randomNamePerConnection: false,
    streaming: config.streaming !== false,
    streamingIntervalMs,
    ...(optionalEndpointField(config.nickname) ? { nickname: optionalEndpointField(config.nickname)! } : {}),
  };
}

function optionalEndpointField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function bindSandboxWsSocket(
  ws: SandboxWsSocket,
  handlers: {
    onMessage: (raw: string) => void;
    onClose: () => void;
    onError?: (err: unknown) => void;
  },
): () => void {
  if (typeof ws.on === 'function') {
    const onMessage = (...args: unknown[]) => {
      const data = args[0];
      const raw = typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? new TextDecoder().decode(data)
          : Buffer.isBuffer(data)
            ? data.toString()
            : String(data ?? '');
      handlers.onMessage(raw);
    };
    ws.on('message', onMessage);
    ws.on('close', handlers.onClose);
    if (handlers.onError) ws.on('error', handlers.onError);
    return () => {
      ws.off?.('message', onMessage);
      ws.off?.('close', handlers.onClose);
      if (handlers.onError) ws.off?.('error', handlers.onError);
    };
  }
  const onMessage = (ev: Event) => {
    const data = (ev as MessageEvent).data;
    handlers.onMessage(typeof data === 'string' ? data : '');
  };
  const onClose = () => handlers.onClose();
  const onError = handlers.onError
    ? () => handlers.onError?.(new Error('WebSocket error'))
    : undefined;
  ws.addEventListener!('message', onMessage);
  ws.addEventListener!('close', onClose);
  if (onError) ws.addEventListener!('error', onError);
  return () => {
    ws.removeEventListener!('message', onMessage);
    ws.removeEventListener!('close', onClose);
    if (onError) ws.removeEventListener!('error', onError);
  };
}

export interface SandboxConversation {
  readonly type: 'private' | 'group' | 'channel';
  readonly id: string;
}

export type SandboxSenderRole = 'master' | 'admin' | 'member';

export interface SandboxParsedMessage {
  type: MessageType;
  id: string;
  messageId?: string;
  content: MessageElement[];
  timestamp: number;
  text: string;
  action?: { id: string; payload: string };
  agentRun?: SandboxAgentRunConfig;
  senderId?: string;
  senderName?: string;
  senderRole?: SandboxSenderRole;
  /**
   * ADR 0060 §5.4: speak as the chat identity linked to the authenticated Console user instead of
   * `senderId`. The server decides; without such an identity the message is simulated.
   */
  asMe?: boolean;
}

export type SandboxInboundEnvelope = SandboxParsedMessage;

interface SandboxWirePayload {
  type?: MessageType;
  id?: string;
  content?: MessageElement[] | string;
  text?: string;
  timestamp?: number;
  messageId?: unknown;
  agentRun?: unknown;
  senderId?: unknown;
  senderName?: unknown;
  senderRole?: unknown;
  asMe?: unknown;
}

function readSandboxWirePayload(raw: string): SandboxWirePayload & { op?: unknown; conversation?: unknown } {
  try {
    const payload: unknown = JSON.parse(raw);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as SandboxWirePayload
      : { text: raw };
  } catch {
    return { text: raw };
  }
}

export type SandboxWsFrame =
  | { readonly kind: 'subscribe'; readonly conversation: SandboxConversation }
  | { readonly kind: 'message'; readonly message: SandboxParsedMessage }
  | { readonly kind: 'invalid' };

/**
 * The bot this socket talks to. Typed `[@<id or name>]` text (the input hint the Sandbox page shows)
 * becomes a mention segment; a match on `id` or one of `names` (case-insensitive) targets `id`,
 * so the IM layer recognises it as a mention of the bot.
 */
export interface SandboxSelfMention {
  readonly id: string;
  readonly names?: readonly string[];
}

const TYPED_MENTION = /\[@([^\[\]\n]{1,64})\]/gu;

function expandTypedMentions(
  content: MessageElement[],
  text: string,
  self: SandboxSelfMention | undefined,
): { content: MessageElement[]; text: string } {
  const selfKeys = new Set([self?.id, ...(self?.names ?? [])]
    .flatMap(value => typeof value === 'string' && value.trim() ? [value.trim().toLowerCase()] : []));
  const resolve = (name: string): { target: string; self: boolean } => {
    const trimmed = name.trim();
    return self && selfKeys.has(trimmed.toLowerCase()) ? { target: self.id, self: true } : { target: trimmed, self: false };
  };
  let expanded = false;
  const next: MessageElement[] = [];
  for (const segment of content) {
    // A picked mention (`mention` segment) may carry the bot's name instead of its id.
    if ((segment.type === 'mention' || segment.type === 'at') && self && typeof segment.data?.target === 'string'
      && segment.data.target !== self.id && selfKeys.has(segment.data.target.trim().toLowerCase())) {
      expanded = true;
      next.push({ ...segment, data: { ...segment.data, target: self.id } });
      continue;
    }
    const value = segment.type === 'text' ? segment.data?.text : undefined;
    if (typeof value !== 'string' || !value.includes('[@')) {
      next.push(segment);
      continue;
    }
    let last = 0;
    for (const match of value.matchAll(TYPED_MENTION)) {
      const name = match[1]!;
      if (!name.trim()) continue;
      expanded = true;
      if (match.index > last) next.push({ type: 'text', data: { text: value.slice(last, match.index) } });
      const { target } = resolve(name);
      next.push({ type: 'mention', data: { target, name: name.trim() } });
      last = match.index + match[0].length;
    }
    if (last === 0) next.push(segment);
    else if (last < value.length) next.push({ type: 'text', data: { text: value.slice(last) } });
  }
  if (!expanded) return { content, text };
  // Plain-text view: drop mentions of the bot (like other platforms strip the at-self prefix),
  // keep `@name` for anyone else so commands and the Agent still see who was addressed.
  let removedSelf = false;
  const plain = text.replace(TYPED_MENTION, (whole, name: string) => {
    if (!name.trim()) return whole;
    const resolved = resolve(name);
    if (resolved.self) { removedSelf = true; return ''; }
    return `@${resolved.target}`;
  });
  return { content: next, text: removedSelf ? plain.replace(/[ \t]{2,}/gu, ' ').trim() : plain };
}

/** Control frames never fall through into chat or platform message hooks. */
export function parseSandboxWsFrame(raw: string, self?: SandboxSelfMention): SandboxWsFrame {
  const payload = readSandboxWirePayload(raw);
  if ('op' in payload) {
    const conversation = payload.conversation as Partial<SandboxConversation> | null;
    if (payload.op !== 'subscribe' || !conversation || typeof conversation !== 'object'
      || (conversation.type !== 'private' && conversation.type !== 'group' && conversation.type !== 'channel')
      || typeof conversation.id !== 'string' || !conversation.id.trim()) return { kind: 'invalid' };
    return { kind: 'subscribe', conversation: { type: conversation.type, id: conversation.id } };
  }
  const message = normalizeSandboxWsPayload(payload, raw, self);
  if (!['private', 'direct', 'group', 'channel', 'guild'].includes(message.type)
    || typeof message.id !== 'string') return { kind: 'invalid' };
  return { kind: 'message', message };
}

export function parseSandboxWsPayload(raw: string, self?: SandboxSelfMention): SandboxParsedMessage {
  return normalizeSandboxWsPayload(readSandboxWirePayload(raw), raw, self);
}

export const parseSandboxInboundPayload = parseSandboxWsPayload;

function normalizeSandboxWsPayload(payload: SandboxWirePayload, raw: string, self?: SandboxSelfMention): SandboxParsedMessage {
  const type = payload.type ?? 'private';
  const id = payload.id ?? 'sandbox-user';
  const wireContent: MessageElement[] = typeof payload.content === 'string'
    ? [{ type: 'text', data: { text: payload.content } }]
    : Array.isArray(payload.content)
      ? payload.content
      : [{ type: 'text', data: { text: payload.text ?? raw } }];

  const actionSegment = wireContent.find((segment) => segment.type === 'action');
  let action: { id: string; payload: string } | undefined;
  if (actionSegment?.data) {
    const actionPayload = typeof actionSegment.data.payload === 'string'
      ? actionSegment.data.payload
      : typeof actionSegment.data.id === 'string'
        ? actionSegment.data.id
        : '';
    const actionId = typeof actionSegment.data.id === 'string'
      ? actionSegment.data.id
      : actionPayload;
    if (actionId || actionPayload) {
      action = { id: actionId || actionPayload, payload: actionPayload || actionId };
    }
  }

  let text = wireContent
    .flatMap((segment) => (segment.type === 'text' && typeof segment.data?.text === 'string'
      ? [segment.data.text]
      : []))
    .join('\n');
  if (!text.trim()) {
    text = (typeof payload.text === 'string' && payload.text.trim())
      ? payload.text
      : action?.payload ?? raw;
  }
  const typed = expandTypedMentions(wireContent, text, self);
  const content = typed.content;
  text = typed.text;
  const agentRun = normalizeSandboxAgentRunConfig(payload.agentRun);
  const rawMessageId = typeof payload.messageId === 'string' ? payload.messageId.trim() : '';
  const messageId = /^[A-Za-z0-9._:-]{1,160}$/u.test(rawMessageId) ? rawMessageId : undefined;
  const senderId = typeof payload.senderId === 'string' && payload.senderId.trim()
    ? payload.senderId.trim()
    : undefined;
  const senderName = typeof payload.senderName === 'string' && payload.senderName.trim()
    ? payload.senderName.trim()
    : undefined;
  const senderRole: SandboxSenderRole | undefined = payload.senderRole === 'master'
    || payload.senderRole === 'admin'
    || payload.senderRole === 'member'
    ? payload.senderRole
    : undefined;
  return {
    type,
    id,
    ...(messageId ? { messageId } : {}),
    content,
    timestamp: payload.timestamp ?? Date.now(),
    text,
    action,
    ...(agentRun ? { agentRun } : {}),
    ...(senderId ? { senderId } : {}),
    ...(senderName ? { senderName } : {}),
    ...(senderRole ? { senderRole } : {}),
    ...(payload.asMe === true ? { asMe: true } : {}),
  };
}

/**
 * ADR 0060 §5.4: a client-chosen sender id becomes a reserved simulated id (`~sim:<id>`). Ids
 * starting with `~` are never chat identities (`isChatIdentity`), so a simulated sender holds no
 * zhin role whatever id it types — including the id of an owner.
 */
export const SANDBOX_SIMULATED_PREFIX = '~sim:';

export function sandboxSimulatedSenderId(clientId: string): string {
  return clientId.startsWith(SANDBOX_SIMULATED_PREFIX) ? clientId : `${SANDBOX_SIMULATED_PREFIX}${clientId}`;
}

/**
 * 入站归一化 → ConversationRef。sandbox 无平台社交图谱：
 * `private`/`group`/`channel` 直映射；`direct`（私聊）归 'private'；
 * `guild`（频道容器语义）归 'channel'。无 guild/temp 容器信息，不产生 parent。
 */
export function sandboxInboundConversation(
  endpointKey: string,
  msg: { readonly type: MessageType; readonly id: string },
): ConversationRef {
  const kind: ConversationKind = msg.type === 'direct'
    ? 'private'
    : msg.type === 'guild'
      ? 'channel'
      : msg.type;
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind,
    id: msg.id,
  };
}

export type SandboxOutboundChannel = {
  readonly type?: string;
  readonly id?: string;
  readonly bot?: string;
  readonly endpoint?: string;
  readonly messageId?: string;
  readonly conversation?: { readonly type: string; readonly id: string };
};

const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

/**
 * base64 内联值：Console UI 的 resolveMediaSrc 只识别 data: / base64://
 * 前缀；裸 base64 补前缀（有 mime_type 时拼成可直转 data: URL 的形状）。
 */
function toInlineBase64Value(value: string, mimeType?: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('base64://') || trimmed.startsWith('data:')) return trimmed;
  return mimeType
    ? `base64://${mimeType};base64,${trimmed}`
    : `base64://${trimmed}`;
}

/**
 * 出站媒体段归一（canonical MediaRef 唯一来源，不读 legacy url/file/base64/src）：
 * - kind=url → 浏览器直连 URL，原样透传；
 * - kind=base64 → 内联直发（补 base64:// 前缀供 Console UI 解析）；
 * - kind=path → 读盘物化为 base64 内联（sandbox 无平台上传通道）；
 * - kind=file → sandbox 无不透明引用通道，丢弃。
 * 无 canonical `data.media` 的媒体段一律 warn + 丢弃。
 */
function normalizeMediaSegment(segment: MessageElement): MessageElement | null {
  const data = segment.data ?? {};
  const media = data.media;
  if (!isMediaRef(media)) {
    logger.warn(formatCompact({
      op: 'sandbox_outbound_media_dropped',
      type: segment.type,
      reason: 'missing_media_ref',
    }));
    return null;
  }
  if (media.kind === 'url') return { type: segment.type, data };
  if (media.kind === 'base64') {
    return {
      type: segment.type,
      data: {
        ...data,
        media: { ...media, value: toInlineBase64Value(media.value, media.mime_type) },
      },
    };
  }
  if (media.kind === 'path') {
    try {
      const base64 = readFileSync(media.value).toString('base64');
      return {
        type: segment.type,
        data: {
          ...data,
          media: {
            ...media,
            kind: 'base64',
            value: toInlineBase64Value(base64, media.mime_type),
          },
        },
      };
    } catch (err) {
      logger.warn(formatCompact({
        op: 'sandbox_outbound_media_dropped',
        type: segment.type,
        reason: 'path_read_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return null;
    }
  }
  logger.warn(formatCompact({
    op: 'sandbox_outbound_media_dropped',
    type: segment.type,
    reason: 'unsupported_media_kind',
  }));
  return null;
}

/** 出站段数组归一：媒体段走 MediaRef-only 归一，其余段原样透传。 */
export function normalizeSandboxOutboundSegments(segments: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of segments) {
    if (
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && MEDIA_SEGMENT_TYPES.has(String((item as MessageElement).type))
    ) {
      const normalized = normalizeMediaSegment(item as MessageElement);
      if (normalized) out.push(normalized);
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Wire-encode an already-rendered outbound payload.
 * Stamps `channel` so Console SandboxChat can filter by type+id (otherwise
 * replies look like they disappeared).
 */
export function formatSandboxOutbound(
  payload: unknown,
  channel: SandboxOutboundChannel = {},
): string {
  const stamp: Record<string, unknown> = {};
  if (channel.type) stamp.type = channel.type;
  if (channel.id) stamp.id = channel.id;
  if (channel.bot) stamp.bot = channel.bot;
  if (channel.endpoint) stamp.endpoint = channel.endpoint;
  if (channel.messageId) stamp.messageId = channel.messageId;
  if (channel.conversation) stamp.conversation = channel.conversation;

  if (typeof payload === 'string') {
    return JSON.stringify({
      ...stamp,
      content: [{ type: 'text', data: { text: payload } }],
      timestamp: Date.now(),
    });
  }
  if (Array.isArray(payload)) {
    return JSON.stringify({
      ...stamp,
      content: normalizeSandboxOutboundSegments(payload),
      timestamp: Date.now(),
    });
  }
  // Already a wire envelope ({ content, type, … }) — pass through so the
  // Console UI can read `content` / `type` without an extra nesting layer.
  // Bare segment objects ({ type: 'text', data: … }) still need wrapping.
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (
      'content' in (payload as object)
      || 'type' in (payload as object) && 'timestamp' in (payload as object)
    )
  ) {
    const envelope = payload as Record<string, unknown>;
    return JSON.stringify({
      ...stamp,
      ...envelope,
      ...(Array.isArray(envelope.content)
        ? { content: normalizeSandboxOutboundSegments(envelope.content) }
        : {}),
      type: envelope.type ?? stamp.type,
      id: envelope.id ?? stamp.id,
      conversation: stamp.conversation ?? envelope.conversation,
      messageId: typeof envelope.messageId === 'string' && envelope.messageId.trim()
        ? envelope.messageId
        : stamp.messageId,
      timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : Date.now(),
    });
  }
  return JSON.stringify({ ...stamp, content: payload, timestamp: Date.now() });
}

/** WebSocket.OPEN 常量值；Node <22 无全局 WebSocket，不能用 WebSocket.OPEN。 */
const WS_OPEN = 1;

export function whenWsOpen(ws: SandboxWsSocket, fn: () => void): void {
  const std = ws as WebSocket;
  if (typeof std.readyState === 'number') {
    if (std.readyState === WS_OPEN) {
      fn();
      return;
    }
    std.addEventListener('open', fn, { once: true });
    return;
  }
  fn();
}
