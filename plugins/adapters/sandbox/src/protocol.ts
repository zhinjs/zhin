/** Sandbox WebSocket wire protocol helpers (no legacy Adapter/Endpoint). */

import { readFileSync } from 'node:fs';
import { isMediaRef } from '@zhin.js/core';
import type { ConversationKind, ConversationRef } from '@zhin.js/im-contract';
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

export type ResolvedSandboxBot = {
  readonly context: 'sandbox';
  readonly id: string;
  readonly owner: string;
  readonly randomNamePerConnection: boolean;
};

export interface SandboxAdapterConfig {
  /** Runtime expands `endpoints[i]` onto the top level — prefer these. */
  readonly context?: string;
  readonly id?: string;
  readonly owner?: string;
  /** Legacy shape: endpoint entries nested under `endpoints[]`. */
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly id?: string;
    readonly owner?: string;
  }>;
}

export function resolveSandboxEndpoint(
  appConfig: SandboxAdapterConfig,
): ResolvedSandboxBot {
  const entry = appConfig.endpoints?.find((item) => item.context === 'sandbox');
  const fixedName = typeof appConfig.id === 'string' && appConfig.id
    ? appConfig.id
    : typeof entry?.id === 'string' && entry.id
      ? entry.id
      : undefined;
  const id = fixedName || process.env.SANDBOX_BOT_NAME || 'sandbox-bot';
  const owner = (typeof appConfig.owner === 'string' && appConfig.owner)
    || (typeof entry?.owner === 'string' && entry.owner)
    || process.env.SANDBOX_BOT_OWNER
    || 'sandbox-user';
  return {
    context: 'sandbox',
    id,
    owner,
    // The endpoint id participates in the Agent session key. Keep it stable
    // across browser reconnects and Host restarts so a persisted playground
    // session resumes the same Agent context.
    randomNamePerConnection: false,
  };
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

export function parseSandboxWsPayload(raw: string): {
  type: MessageType;
  id: string;
  messageId?: string;
  content: MessageElement[];
  timestamp: number;
  text: string;
  action?: { id: string; payload: string };
  agentRun?: SandboxAgentRunConfig;
} {
  let payload: {
    type?: MessageType;
    id?: string;
    content?: MessageElement[] | string;
    text?: string;
    timestamp?: number;
    messageId?: unknown;
    agentRun?: unknown;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    payload = { text: raw };
  }
  const type = payload.type ?? 'private';
  const id = payload.id ?? 'sandbox-user';
  const content: MessageElement[] = typeof payload.content === 'string'
    ? [{ type: 'text', data: { text: payload.content } }]
    : Array.isArray(payload.content)
      ? payload.content
      : [{ type: 'text', data: { text: payload.text ?? raw } }];

  const actionSegment = content.find((segment) => segment.type === 'action');
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

  let text = content
    .flatMap((segment) => (segment.type === 'text' && typeof segment.data?.text === 'string'
      ? [segment.data.text]
      : []))
    .join('\n');
  if (!text.trim()) {
    text = (typeof payload.text === 'string' && payload.text.trim())
      ? payload.text
      : action?.payload ?? raw;
  }
  const agentRun = normalizeSandboxAgentRunConfig(payload.agentRun);
  const rawMessageId = typeof payload.messageId === 'string' ? payload.messageId.trim() : '';
  const messageId = /^[A-Za-z0-9._:-]{1,160}$/u.test(rawMessageId) ? rawMessageId : undefined;
  return {
    type,
    id,
    ...(messageId ? { messageId } : {}),
    content,
    timestamp: payload.timestamp ?? Date.now(),
    text,
    action,
    ...(agentRun ? { agentRun } : {}),
  };
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
