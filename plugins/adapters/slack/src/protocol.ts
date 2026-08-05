/**
 * Slack protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isMediaRef, type MediaRef } from '@zhin.js/core';
import type { ConversationKind, ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { mrkdwnToMarkdown } from './mrkdwn-to-markdown.js';

const logger = getLogger('slack');

/** 无 canonical MediaRef 或不可投递时留痕（对齐 QQ `*_outbound_media_dropped` 风格）。 */
function dropOutboundMedia(type: string, reason: string): void {
  logger.warn(formatCompact({ op: 'slack_outbound_media_dropped', type, reason }));
}

const SLACK_SIG_VERSION = 'v0';
const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface SlackAdapterConfig {
  readonly name?: string;
  readonly token?: string;
  readonly signingSecret?: string;
  readonly appToken?: string;
  /** Default true (Socket Mode). Set false for HTTP Events API via httpHostToken. */
  readonly socketMode?: boolean;
  readonly webhookPath?: string;
  readonly clientPingTimeout?: number;
  /** Transitional: legacy root `endpoints[]` with `context: slack`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedSlackConfig> & {
    readonly context?: string;
    readonly socketMode?: boolean;
    readonly signingSecret?: string;
    readonly appToken?: string;
    readonly webhookPath?: string;
    readonly clientPingTimeout?: number;
  }>;
}

export interface ResolvedSlackConfig {
  readonly context: 'slack';
  readonly name: string;
  readonly token: string;
  readonly mode: 'socket' | 'http';
  readonly signingSecret: string;
  readonly appToken?: string;
  readonly webhookPath: string;
  readonly clientPingTimeout: number;
}

export interface SlackEventEnvelope {
  readonly token?: string;
  readonly team_id?: string;
  readonly api_app_id?: string;
  readonly event: SlackEvent;
  readonly type: 'event_callback';
  readonly event_id?: string;
  readonly event_time?: number;
}

export interface SlackUrlVerification {
  readonly type: 'url_verification';
  readonly token: string;
  readonly challenge: string;
}

export interface SlackInteractionPayload {
  readonly type: 'block_actions' | 'message_action' | 'shortcut' | 'view_submission' | 'view_closed';
  readonly trigger_id?: string;
  readonly user: { id: string; username?: string; name?: string; team_id?: string };
  readonly channel?: { id: string; name?: string };
  readonly message?: { ts: string; text?: string; [key: string]: unknown };
  readonly actions?: SlackBlockAction[];
  readonly response_url?: string;
  readonly [key: string]: unknown;
}

export interface SlackBlockAction {
  readonly type: string;
  readonly action_id: string;
  readonly block_id: string;
  readonly value?: string;
  readonly text?: { type: string; text: string };
  readonly action_ts?: string;
  readonly [key: string]: unknown;
}

export interface SlackSlashCommand {
  readonly token: string;
  readonly team_id: string;
  readonly channel_id: string;
  readonly channel_name: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly command: string;
  readonly text: string;
  readonly response_url: string;
  readonly trigger_id: string;
  readonly api_app_id?: string;
}

export interface SlackEvent {
  readonly type: string;
  readonly ts?: string;
  readonly event_ts?: string;
  readonly user?: string;
  readonly channel?: string;
  readonly channel_type?: string;
  readonly text?: string;
  readonly thread_ts?: string;
  readonly subtype?: string;
  readonly bot_id?: string;
  readonly [key: string]: unknown;
}

export type SlackMessageEvent = SlackEvent & {
  readonly type: 'message' | 'app_mention';
  readonly ts: string;
  readonly channel: string;
};

export interface SlackWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export function resolveSlackConfig(config: SlackAdapterConfig = {}): ResolvedSlackConfig {
  const entry = config.endpoints?.find((item) => item.context === 'slack');
  const token = config.token
    ?? entry?.token
    ?? process.env.SLACK_BOT_TOKEN
    ?? process.env.SLACK_TOKEN;
  if (!token) {
    throw new TypeError(
      'Slack adapter requires token (plugins.<key>.token or endpoints with context: slack)',
    );
  }

  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.SLACK_BOT_NAME
    || 'slack-bot';

  const socketMode = config.socketMode ?? entry?.socketMode;
  // Prefer Socket Mode (default true) — no public URL required.
  const mode: 'socket' | 'http' = socketMode === false ? 'http' : 'socket';

  const signingSecret = config.signingSecret
    ?? entry?.signingSecret
    ?? process.env.SLACK_SIGNING_SECRET
    ?? '';
  const appToken = config.appToken
    ?? entry?.appToken
    ?? process.env.SLACK_APP_TOKEN
    ?? undefined;

  if (mode === 'socket' && !appToken) {
    throw new TypeError(
      'Slack Socket Mode requires appToken (xapp-...); set socketMode: false for HTTP Events API',
    );
  }
  if (mode === 'http' && !signingSecret) {
    throw new TypeError(
      'Slack HTTP Events API requires signingSecret',
    );
  }

  return {
    context: 'slack',
    name,
    token,
    mode,
    signingSecret,
    appToken,
    webhookPath: normalizeWebhookPath(
      config.webhookPath ?? entry?.webhookPath ?? '/slack/events',
    ),
    clientPingTimeout: config.clientPingTimeout
      ?? entry?.clientPingTimeout
      ?? 15_000,
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/slack/events';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveSlackChannelType(event: Pick<SlackEvent, 'channel_type'>): 'private' | 'group' {
  return event.channel_type === 'im' ? 'private' : 'group';
}

/**
 * 入站归一化 → ConversationRef：channel_type `im` → private，其余（channel/group/mpim）
 * → group；交互/斜杠命令无 channel_type 时按平台 id 前缀推断（D* 为 DM）。Slack 无
 * guild 容器概念（team 为 workspace 级，不进 parent）；线程根 ts 进 `threadId`。
 */
export function slackInboundConversation(
  endpointId: string,
  opts: {
    readonly channelId: string;
    readonly channelType?: string;
    readonly threadId?: string;
  },
): ConversationRef {
  const kind: ConversationKind = opts.channelType != null
    ? (opts.channelType === 'im' ? 'private' : 'group')
    : (opts.channelId.startsWith('D') ? 'private' : 'group');
  return {
    endpoint: { id: endpointId, adapter: endpointId.split('\0')[0] ?? endpointId },
    kind,
    id: opts.channelId,
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
  };
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(event: SlackMessageEvent | SlackEvent): string {
  const text = typeof event.text === 'string' ? event.text : '';
  if (text) return mrkdwnToMarkdown(text);
  if ('files' in event && Array.isArray(event.files) && event.files.length > 0) {
    return '[file]';
  }
  return '';
}

export function formatInteractionContent(payload: SlackInteractionPayload): string {
  const action = payload.actions?.[0];
  if (!action) return '[action]';
  const label = action.text?.text ?? action.value ?? action.action_id;
  return `[action: ${action.action_id}${label ? ` ${label}` : ''}]`;
}

export function formatSlashContent(cmd: SlackSlashCommand): string {
  return `${cmd.command} ${cmd.text}`.trim();
}

export function inboundMessageId(event: SlackMessageEvent): string {
  return `${event.channel}:${event.ts}`;
}

/**
 * Wire-encode an already-rendered outbound payload into Slack text + Block Kit blocks.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundWire(payload: unknown): {
  text: string;
  blocks: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  files: Array<{ buffer?: Buffer; url?: string; path?: string; name?: string }>;
} {
  if (typeof payload === 'string') {
    return { text: payload, blocks: [], attachments: [], files: [] };
  }

  const items: Array<string | SlackWireSegment> = Array.isArray(payload)
    ? payload as Array<string | SlackWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as SlackWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    return { text, blocks: [], attachments: [], files: [] };
  }

  let text = '';
  const blocks: Record<string, unknown>[] = [];
  const attachments: Record<string, unknown>[] = [];
  const files: Array<{ buffer?: Buffer; url?: string; path?: string; name?: string }> = [];

  for (const item of items) {
    if (typeof item === 'string') {
      text += item;
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        text += String(data.text ?? data.content ?? '');
        break;
      case 'at':
      case 'mention':
        text += `<@${String(data.id ?? data.target ?? '')}>`;
        break;
      case 'channel_mention':
        text += `<#${String(data.id ?? '')}>`;
        break;
      case 'link':
        if (data.text && data.text !== data.url) {
          text += `<${String(data.url)}|${String(data.text)}>`;
        } else {
          text += `<${String(data.url ?? '')}>`;
        }
        break;
      case 'image': {
        // canonical MediaRef 唯一来源；kind=url 走 attachment 直发，其余物化后 files.uploadV2 上传
        const media = data.media;
        if (!isMediaRef(media)) {
          dropOutboundMedia(item.type, 'missing_media_ref');
          break;
        }
        if (media.kind === 'url') {
          attachments.push({
            image_url: media.value,
            title: String(data.alt ?? data.title ?? media.file_name ?? ''),
          });
          break;
        }
        const imageFile = resolveMediaToFile(media, String(data.alt ?? media.file_name ?? 'image'));
        if (imageFile) files.push(imageFile);
        else dropOutboundMedia(item.type, 'unsupported_media_kind');
        break;
      }
      case 'audio':
      case 'video':
      case 'file': {
        const media = data.media;
        if (!isMediaRef(media)) {
          dropOutboundMedia(item.type, 'missing_media_ref');
          break;
        }
        const mediaFile = resolveMediaToFile(media, String(data.name ?? media.file_name ?? item.type));
        if (mediaFile) files.push(mediaFile);
        else dropOutboundMedia(item.type, 'unsupported_media_kind');
        break;
      }
      case 'keyboard':
        blocks.push(...keyboardToBlockKitBlocks(data));
        break;
      default:
        text += String(data.text ?? `[${item.type}]`);
    }
  }

  return { text, blocks, attachments, files };
}

export function keyboardToBlockKitBlocks(data: Record<string, unknown>): Record<string, unknown>[] {
  const rows = data.rows as Array<Array<Record<string, unknown>>> | undefined;
  if (!rows?.length) return [];

  const blocks: Record<string, unknown>[] = [];
  for (const row of rows) {
    const elements = row.slice(0, 5).map((btn, index) => ({
      type: 'button',
      text: { type: 'plain_text', text: String(btn.label ?? btn.text ?? 'button').slice(0, 75) },
      action_id: String(btn.id ?? btn.action_id ?? `btn_${blocks.length}_${index}`),
      ...(btn.value != null ? { value: String(btn.value) } : {}),
      ...(btn.style === 'primary' ? { style: 'primary' } : {}),
      ...(btn.style === 'danger' ? { style: 'danger' } : {}),
    }));
    if (elements.length > 0) {
      blocks.push({ type: 'actions', elements });
    }
  }
  return blocks;
}

/**
 * MediaRef → 待上传文件描述：
 * - kind=url → 记录 URL，由 files.uploadV2 前拉取物化；
 * - kind=base64 → 解码为 buffer 直传；
 * - kind=path → 记录本地路径，上传前读盘；
 * - kind=file → Slack 无平台不透明文件引用可直发，返回 undefined 由调用方丢弃留痕。
 */
function resolveMediaToFile(
  media: MediaRef,
  name: string,
): { buffer?: Buffer; url?: string; path?: string; name: string } | undefined {
  switch (media.kind) {
    case 'base64':
      return {
        buffer: Buffer.from(media.value.replace(/^base64:\/\//, ''), 'base64'),
        name,
      };
    case 'url':
      return { url: media.value, name };
    case 'path':
      return { path: media.value, name };
    default:
      return undefined;
  }
}

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_SIG_VERSION}:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `${SLACK_SIG_VERSION}=${hmac}`;

  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
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

export function headerValue(
  headers: IncomingMessage['headers'],
  name: string,
): string {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}
