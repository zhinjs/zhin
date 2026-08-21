/**
 * 入站媒体注入 — TurnIngress 的 canonical media → 当前 turn 的
 * `UserMessage.media`（MediaContentBlock，不随 session 持久化）。
 *
 * 策略（`ai.multimodal`）：
 * 每个输入媒体必须产生 accepted / derived / unsupported / rejected / failed
 * 之一；失败不得伪装成已经被模型识别的媒体占位。
 */
import { isMediaBlockRef, type MediaContentBlock, type MediaBlockRef, type ModelInputModality } from '@zhin.js/ai';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  normalizeMediaRefsToPayloads,
} from '../media/media-normalize.js';
import type { MediaBinaryPayload } from '../media/media-types.js';
import { transcribeAudioPayload } from '../media/media-router.js';
import {
  getPrimaryAppConfig,
  resolveMultimodalConfig,
} from '../media/resolve-config.js';
import type { ReferencePort, TurnMedia } from './turn-ingress.js';

const logger = getLogger('ZhinAgent');

export interface InboundMediaInjection {
  /** 挂到当前 turn UserMessage.media 的媒体块 */
  readonly blocks: MediaContentBlock[];
  /** 需要拼进用户消息文本的补充（STT 转写 / 占位） */
  readonly textAppends: string[];
  /** 与输入媒体一一对应的终态。 */
  readonly outcomes: InboundMediaOutcome[];
}

export interface InboundMediaOutcome {
  readonly kind: TurnMedia['kind'];
  readonly status: 'accepted' | 'derived' | 'unsupported' | 'rejected' | 'failed';
  readonly code: string;
}

const EMPTY_INJECTION: InboundMediaInjection = Object.freeze({
  blocks: Object.freeze([]) as unknown as MediaContentBlock[],
  textAppends: Object.freeze([]) as unknown as string[],
  outcomes: Object.freeze([]) as unknown as InboundMediaOutcome[],
});

function failureText(type: string, code: string, ref: MediaBlockRef): string {
  const label = ref.file_name ? `; ${ref.file_name}` : '';
  return `[Media ${code}: ${type}${label}]`;
}

function toBase64Block(
  type: MediaContentBlock['type'],
  payload: MediaBinaryPayload,
  alt?: string,
): MediaContentBlock {
  return {
    type,
    data: {
      media: {
        kind: 'base64',
        value: payload.base64,
        mime_type: payload.mimeType,
        ...(payload.fileName ? { file_name: payload.fileName } : {}),
      },
      ...(alt ? { alt } : {}),
    },
  };
}

export async function resolveTurnMediaInjection(
  turnMedia: readonly TurnMedia[] | undefined,
  references?: ReferencePort,
  signal: AbortSignal = new AbortController().signal,
  providerInput?: readonly ModelInputModality[],
): Promise<InboundMediaInjection> {
  const refs = (turnMedia ?? []).map((entry) => ({
    entry,
    type: entry.kind,
    media: {
      kind: entry.source.kind === 'platform_ref' ? 'file' as const : entry.source.kind,
      value: entry.source.value,
      ...(entry.mimeType ? { mime_type: entry.mimeType } : {}),
      ...(entry.name ? { file_name: entry.name } : {}),
    } satisfies MediaBlockRef,
  }));
  if (refs.length === 0) return EMPTY_INJECTION;

  const config = resolveMultimodalConfig();
  const supportedInput = new Set<ModelInputModality>(providerInput ?? ['text']);
  const blocks: MediaContentBlock[] = [];
  const textAppends: string[] = [];
  const outcomes: InboundMediaOutcome[] = [];

  for (const { entry, type, media: initialMedia } of refs) {
    let media = initialMedia;
    if (entry.source.kind === 'platform_ref') {
      if (!entry.referenceKey || !references) {
        textAppends.push(failureText(type, 'unsupported:unresolved_platform_reference', media));
        outcomes.push({ kind: type, status: 'unsupported', code: 'unresolved_platform_reference' });
        continue;
      }
      const resolution = await references.resolve(entry.referenceKey, {
        depth: 0,
        maxEntries: 1,
        maxChars: 0,
      }, signal);
      if (resolution.status !== 'resolved' || !isMediaBlockRef(resolution.content)) {
        const code = resolution.status === 'resolved' ? 'invalid_platform_media' : resolution.code;
        textAppends.push(failureText(type, `failed:${code}`, media));
        outcomes.push({ kind: type, status: resolution.status === 'forbidden' ? 'rejected' : 'failed', code });
        continue;
      }
      media = resolution.content;
    }
    signal.throwIfAborted();
    const payload = (await normalizeMediaRefsToPayloads(
      [{ type, media: media as never }],
      config.maxFileBytes,
      signal,
    ))[0];
    signal.throwIfAborted();
    if (!payload) {
      const code = media.kind === 'file' ? 'unmaterialized_platform_reference' : 'media_validation_failed';
      logger.warn(formatCompact({ op: 'inbound_media_rejected', type, reason: code }));
      textAppends.push(failureText(type, `rejected:${code}`, media));
      outcomes.push({ kind: type, status: 'rejected', code });
      continue;
    }

    if (type === 'audio') {
      if (config.audio.strategy === 'transcribe') {
        try {
          const text = await transcribeAudioPayload(payload, {
            getConfig: getPrimaryAppConfig,
            warn: (msg) => logger.warn(formatCompact({ op: 'inbound_stt', fallback: msg })),
          });
          if (text?.trim()) {
            textAppends.push(`[语音转写] ${text.trim()}`);
            outcomes.push({ kind: type, status: 'derived', code: 'speech_transcription' });
            continue;
          }
        } catch (error) {
          logger.warn(formatCompact({
            op: 'inbound_stt_failed',
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      if (!supportedInput.has('audio')) {
        textAppends.push(failureText(type, 'unsupported:provider_input', media));
        outcomes.push({ kind: type, status: 'unsupported', code: 'provider_input' });
        continue;
      }
      blocks.push(toBase64Block('audio', payload));
      outcomes.push({ kind: type, status: 'accepted', code: 'validated_provider_input' });
      continue;
    }

    if (!supportedInput.has(type)) {
      textAppends.push(failureText(type, 'unsupported:provider_input', media));
      outcomes.push({ kind: type, status: 'unsupported', code: 'provider_input' });
      continue;
    }
    blocks.push(toBase64Block(type, payload));
    outcomes.push({ kind: type, status: 'accepted', code: 'validated_provider_input' });
  }

  if (blocks.length === 0 && textAppends.length === 0 && outcomes.length === 0) return EMPTY_INJECTION;
  return { blocks, textAppends, outcomes };
}

/**
 * 把注入结果合入 LLM 绑定的 userMessages：最后一个 user 消息挂 media 块，
 * textAppends 以独立 text 块追加在其后（不改动历史消息）。
 */
export function applyInboundMediaInjection(
  userMessages: readonly import('@zhin.js/ai').AgentMessage[],
  injection: InboundMediaInjection,
): import('@zhin.js/ai').AgentMessage[] {
  if (!injection.blocks.length && !injection.textAppends.length) {
    return [...userMessages];
  }
  const out = [...userMessages];
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const msg = out[i]!;
    if (msg.role !== 'user') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    out[i] = {
      ...msg,
      content: [
        ...content,
        ...injection.textAppends.map((text) => ({ type: 'text' as const, text })),
      ],
      ...(injection.blocks.length ? { media: injection.blocks } : {}),
    };
    break;
  }
  return out;
}
