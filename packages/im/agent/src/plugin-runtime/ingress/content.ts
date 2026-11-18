import { renderAgentOutput, type TurnOutcome } from '../../index.js';
import type { Segment } from '@zhin.js/im-contract';
import type { Message } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('agent');

type OutputElementLike = {
  readonly type: string;
  readonly segments?: Segment[];
  readonly content?: string;
  readonly url?: string;
  readonly title?: string;
  readonly name?: string;
  readonly description?: string;
  readonly fallbackText?: string;
};

export function stringMetadata(metadata: Message['metadata'], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 稳定发送者 ID：sender.id 是适配器从平台 API 传入的一等字段（稳定平台 ID），
 * Missing sender identity remains unauthenticated; metadata is never authority.
 */
export function resolveStableSenderId(message: Message): string {
  return message.sender?.id ?? 'anon';
}

export function isClearCommand(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized === 'clear'
    || normalized === '/clear'
    || normalized === '重置'
    || normalized === '清空';
}

export function completedOutput(
  outcome: TurnOutcome,
): Array<Extract<TurnOutcome, { status: 'completed' }>['output'][number]> {
  if (outcome.status === 'completed') return [...outcome.output];
  if (outcome.status === 'cancelled') {
    throw new Error(`Agent turn cancelled: ${outcome.reason}`);
  }
  if (outcome.status === 'budget_exceeded') {
    throw new Error(`Agent turn exceeded budget: ${outcome.budget}`);
  }
  throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
}

/**
 * The transcriber refused the voice address (#1250 第 45 批): not a public HTTPS URL, a redirect to
 * one that is not, or a name resolving to a private address. Nothing was downloaded.
 */
export interface InboundAudioUrlRefusal {
  readonly status: 'refused';
  readonly code: 'speech_url_blocked';
}

/** A transcript, `null` when nothing usable came back, or a refused address. */
export type InboundAudioUrlTranscription = string | null | InboundAudioUrlRefusal;

/**
 * Where an inbound voice address came from (#1250 第 45 批):
 * - `platform`: a voice segment or `metadata.audio_url` the platform adapter produced from the
 *   platform's own payload (a QQ voice CDN link may be plain http);
 * - `user`: text the sender typed (`[audio:URL]`), or a segment on an Endpoint whose clients send
 *   structured segments themselves (`runtime.sandbox`, or capabilities that cannot be resolved).
 */
export type InboundAudioUrlOrigin = 'platform' | 'user';

/**
 * Inbound voice message transcription (Speech Host `transcribeUrl`). Must not fetch private targets;
 * may accept `http:` only for `origin: 'platform'` (default `user`: HTTPS only).
 */
export type InboundAudioUrlTranscriber = (
  audioUrl: string,
  source?: InboundAudioUrlSource,
) => Promise<InboundAudioUrlTranscription>;

/**
 * Where a voice address came from. `trustedOrigins` (only with `origin: 'platform'`, #1250 第 48 批):
 * the producing Endpoint's own protocol server, whose port a download may keep.
 */
export type InboundAudioUrlSource = Readonly<{ origin: InboundAudioUrlOrigin; trustedOrigins?: readonly string[] }>;

/** Model-facing note in place of a refused voice address; the address itself is not shown. */
export const SPEECH_URL_BLOCKED_NOTE = '[语音地址不可用，未转写（speech_url_blocked）]';

export async function preprocessInboundTurn(
  message: Message,
  content: string,
  transcribeUrl?: InboundAudioUrlTranscriber,
  options: Readonly<{
    /**
     * The Endpoint's adapter builds segments from the platform payload, so a segment field cannot be
     * user text. False (the default) treats every address as user-typed: HTTPS only.
     */
    platformSegments?: boolean;
    /** #1250 第 48 批: the Endpoint's declared protocol-server origins; read only for a platform voice address. */
    platformOrigins?: () => readonly string[];
  }> = {},
): Promise<{ readonly text: string; readonly sttApplied: boolean; readonly sttRefusal?: InboundAudioUrlRefusal['code'] }> {
  const audio = resolveInboundAudioUrl(message, options.platformSegments === true);
  if (!audio || !transcribeUrl) {
    return { text: stripAudioPlaceholders(content), sttApplied: false };
  }
  let transcript: InboundAudioUrlTranscription;
  try {
    const trustedOrigins = audio.origin === 'platform' ? options.platformOrigins?.() ?? [] : [];
    transcript = await transcribeUrl(audio.url, { origin: audio.origin, ...(trustedOrigins.length ? { trustedOrigins } : {}) });
  } catch (error) {
    // A transcriber failure never ends the turn: the text goes on without a transcript.
    logger.warn(formatCompact({ op: 'agent_inbound_stt_failed', error: error instanceof Error ? error.name : 'unknown' }));
    transcript = null;
  }
  const rest = stripAudioPlaceholders(content).trim();
  if (transcript && typeof transcript === 'object') {
    logger.info(formatCompact({ op: 'agent_inbound_stt_refused', reason: transcript.code }));
    const text = rest ? `${rest}\n${SPEECH_URL_BLOCKED_NOTE}` : SPEECH_URL_BLOCKED_NOTE;
    return { text, sttApplied: false, sttRefusal: transcript.code };
  }
  if (!transcript) {
    return { text: stripAudioPlaceholders(content) || content, sttApplied: false };
  }
  const text = rest ? `${rest}\n${transcript}` : transcript;
  return { text, sttApplied: true };
}

/** The voice address of `message` and where it came from; see {@link InboundAudioUrlOrigin}. */
function resolveInboundAudioUrl(
  message: Message,
  platformSegments: boolean,
): { readonly url: string; readonly origin: InboundAudioUrlOrigin } | undefined {
  const fromAdapter: InboundAudioUrlOrigin = platformSegments ? 'platform' : 'user';
  if (message.segments) {
    for (const seg of message.segments) {
      if (seg.type === 'audio' || seg.type === 'record') {
        const media = seg.data?.media as { kind?: string; value?: string } | undefined;
        if (media?.kind === 'url' && typeof media.value === 'string' && media.value.trim()) {
          return { url: media.value.trim(), origin: fromAdapter };
        }
        const d = seg.data as Record<string, unknown> | undefined;
        const url = d?.url ?? d?.src ?? d?.file;
        if (typeof url === 'string' && url.trim()) return { url: url.trim(), origin: fromAdapter };
      }
    }
  }
  const fromMeta = message.metadata?.audio_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return { url: fromMeta.trim(), origin: fromAdapter };
  // Text the sender typed is never a platform address.
  const match = message.content.match(/\[audio:([^\[\]]+)\]/u);
  const fromContent = match?.[1]?.trim();
  return fromContent ? { url: fromContent, origin: 'user' } : undefined;
}

function stripAudioPlaceholders(content: string): string {
  return content.replace(/\[audio:[^\[\]]*\]/gu, '').trim();
}

export function flattenOutputElements(elements: readonly OutputElementLike[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'message':
        parts.push(renderAgentOutput([{ type: 'message', segments: el.segments ?? [] }]));
        break;
      case 'text':
        if (el.content) parts.push(el.content);
        break;
      case 'image':
        parts.push(el.url ? `[image:${el.url}]` : '[image]');
        break;
      case 'audio':
        parts.push(el.fallbackText || (el.url ? `[audio:${el.url}]` : '[audio]'));
        break;
      case 'video':
        parts.push(el.fallbackText || (el.url ? `[video:${el.url}]` : '[video]'));
        break;
      case 'card': {
        const card = [el.title ?? 'card'];
        if (el.description) card.push(el.description);
        parts.push(card.join('\n'));
        break;
      }
      case 'file':
        parts.push(el.url ? `${el.name ?? 'file'}: ${el.url}` : (el.name ?? '[file]'));
        break;
    }
  }
  return parts.join('\n');
}
