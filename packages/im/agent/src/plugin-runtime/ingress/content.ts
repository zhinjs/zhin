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

/** Inbound voice message transcription (Speech Host `transcribeUrl`). Must not fetch private targets. */
export type InboundAudioUrlTranscriber = (audioUrl: string) => Promise<InboundAudioUrlTranscription>;

/** Model-facing note in place of a refused voice address; the address itself is not shown. */
export const SPEECH_URL_BLOCKED_NOTE = '[语音地址不可用，未转写（speech_url_blocked）]';

export async function preprocessInboundTurn(
  message: Message,
  content: string,
  transcribeUrl?: InboundAudioUrlTranscriber,
): Promise<{ readonly text: string; readonly sttApplied: boolean; readonly sttRefusal?: InboundAudioUrlRefusal['code'] }> {
  const audioUrl = resolveInboundAudioUrl(message);
  if (!audioUrl || !transcribeUrl) {
    return { text: stripAudioPlaceholders(content), sttApplied: false };
  }
  let transcript: InboundAudioUrlTranscription;
  try {
    transcript = await transcribeUrl(audioUrl);
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

function resolveInboundAudioUrl(
  message: Message,
): string | undefined {
  if (message.segments) {
    for (const seg of message.segments) {
      if (seg.type === 'audio' || seg.type === 'record') {
        const media = seg.data?.media as { kind?: string; value?: string } | undefined;
        if (media?.kind === 'url' && typeof media.value === 'string' && media.value.trim()) {
          return media.value.trim();
        }
        const d = seg.data as Record<string, unknown> | undefined;
        const url = d?.url ?? d?.src ?? d?.file;
        if (typeof url === 'string' && url.trim()) return url.trim();
      }
    }
  }
  const fromMeta = message.metadata?.audio_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const match = message.content.match(/\[audio:([^\[\]]+)\]/u);
  const fromContent = match?.[1]?.trim();
  return fromContent || undefined;
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
