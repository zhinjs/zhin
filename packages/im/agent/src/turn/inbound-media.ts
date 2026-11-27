/**
 * 入站媒体注入 — TurnIngress 的 canonical media → 当前 turn 的
 * `UserMessage.media`（MediaContentBlock，不随 session 持久化）。
 *
 * 策略（`ai.multimodal`）：
 * 每个输入媒体必须产生 accepted / derived / unsupported / rejected / failed
 * 之一；失败不得伪装成已经被模型识别的媒体占位。
 *
 * 当前模型收不了的媒体：音频先走 STT（`[语音转写]`）；配置了
 * `ai.multimodal.perception` 时，图片 / 视频 / PDF 由感知模型描述后以
 * untrusted 文本注入（`[图片描述]` 等），失败或超出单回合上限时保持原占位。
 */
import * as path from 'node:path';
import { isMediaBlockRef, type Usage, type MediaContentBlock, type MediaBlockRef, type ModelInputModality } from '@zhin.js/ai';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  inspectMediaBytes,
  normalizeMediaRefs,
  type MediaRefRejection,
} from '../media/media-normalize.js';
import { authorizeInboundMediaPath, readInboundMediaFile } from '../media/inbound-media-path.js';
import type { AudioTranscriptionPort, MediaBinaryPayload } from '../media/media-types.js';
import { transcribeAudioPayload } from '../media/media-router.js';
import { resolveMultimodalConfig } from '../media/resolve-config.js';
import { MediaPerceptionFailedError, renderPerceptionCaption, type MediaPerceptionPort } from '../media/perception.js';
import type { NetworkTransport } from '../security/turn-network-client.js';
import type { ReferencePort, TurnMedia } from './turn-ingress.js';

const logger = getLogger('ZhinAgent');

export interface InboundMediaInjection {
  /** 挂到当前 turn UserMessage.media 的媒体块 */
  readonly blocks: MediaContentBlock[];
  /** 需要拼进用户消息文本的补充（STT 转写 / 占位） */
  readonly textAppends: string[];
  /** 与输入媒体一一对应的终态。 */
  readonly outcomes: InboundMediaOutcome[];
  /** Tokens spent by the perception pre-pass (not part of the turn's own completion usage). */
  readonly perceptionUsage?: Usage;
  readonly perceptionItems?: number;
  /**
   * #1250 trace-media-perception-provenance-clipped: one entry per perception request that reached a
   * provider (cache hits are not calls). The turn engine reports each as a model call of the turn.
   */
  readonly perceptionCalls?: readonly InboundPerceptionCall[];
}

export interface InboundPerceptionCall {
  readonly kind: TurnMedia['kind'];
  readonly provider?: string;
  readonly model?: string;
  readonly usage: Usage;
  readonly durationMs: number;
  /** `failed`: the request reached the provider but no description came back (usage is an estimate). */
  readonly status: 'completed' | 'failed';
}

export interface InboundMediaOutcome {
  readonly kind: TurnMedia['kind'];
  readonly status: 'accepted' | 'derived' | 'unsupported' | 'rejected' | 'failed';
  readonly code: string;
  /** Where derived text came from (perception pre-pass); the text is untrusted external content. */
  readonly provenance?: InboundMediaProvenance;
  /** Perception description injected for this item (untrusted; for the turn trace). */
  readonly description?: string;
}

export interface InboundMediaProvenance {
  readonly source: 'media_perception';
  readonly provider: string;
  readonly model: string;
  readonly cached: boolean;
}

export interface ResolveTurnMediaOptions {
  readonly references?: ReferencePort;
  readonly signal?: AbortSignal;
  readonly providerInput?: readonly ModelInputModality[];
  readonly transcriber?: AudioTranscriptionPort;
  /** `ai.multimodal.perception`: describes media the turn's model cannot take. Absent = placeholders. */
  readonly perception?: MediaPerceptionPort;
  /**
   * #1250: inbound media directories the producing Endpoint declared (`TurnInput.inboundMediaRoots`).
   * A `path` source is read only when its real path lies inside one; absent = no local path is read.
   */
  readonly inboundMediaRoots?: readonly string[];
  /**
   * #1250 第 48 批: protocol-server origins the producing Endpoint declared (`TurnInput.inboundMediaOrigins`).
   * A media URL on one of them keeps its port; every other URL must use the default HTTPS port.
   */
  readonly inboundMediaOrigins?: readonly string[];
  /** Replaces the pinned Node transport that downloads inbound media URLs (tests, embedding hosts). */
  readonly mediaTransport?: NetworkTransport;
  /** Where the message came from (`platform/scope/scene`), for the rejection log line only. */
  readonly scene?: string;
  /** Native id of the inbound message, for the rejection log line only. */
  readonly messageId?: string;
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

/** A local file in the message that is not read: the model learns it exists, not where it is. */
function unreadableLocalFileText(type: string, code: string, ref: MediaBlockRef): string {
  const label = ref.file_name ? `; ${ref.file_name}` : '';
  return `[Media rejected:${code}: ${type}${label}; this message carries a local file that cannot be read]`;
}

/**
 * Bytes for one media ref. A local path is never read through the generic normalizer: it needs the
 * producing Endpoint's declared directory (#1250); URLs, inline data and opaque refs are unchanged.
 */
async function materializeInboundMedia(
  type: TurnMedia['kind'],
  media: MediaBlockRef,
  maxBytes: number,
  signal: AbortSignal,
  inboundMediaRoots: readonly string[] | undefined,
  transport?: NetworkTransport,
  inboundMediaOrigins: readonly string[] = [],
): Promise<Readonly<{ payload?: MediaBinaryPayload; refused?: string;
  rejected?: Readonly<{ reason: MediaRefRejection; scheme: string; host?: string; status?: number }> }>> {
  if (media.kind !== 'path') {
    const [result] = await normalizeMediaRefs([{ type, media: media as never }], maxBytes, signal, undefined, transport, inboundMediaOrigins);
    if (result?.ok) return { payload: result.payload };
    const { ok: _ok, ...rejected } = result ?? { ok: false as const, reason: 'mime_mismatch' as const, scheme: media.kind };
    return { rejected };
  }
  const decision = await authorizeInboundMediaPath(media.value, inboundMediaRoots);
  if (!decision.allowed) return { refused: decision.reason };
  if (typeof media.size === 'number' && media.size > maxBytes) return { rejected: { reason: 'too_large', scheme: 'path' } };
  const bytes = await readInboundMediaFile(decision, maxBytes);
  if (!bytes) return { rejected: { reason: 'file_unreadable', scheme: 'path' } };
  const detected = inspectMediaBytes(bytes, type === 'file' ? undefined : type);
  if (!detected) return { rejected: { reason: 'mime_mismatch', scheme: 'path' } };
  return {
    payload: {
      kind: detected.kind,
      base64: bytes.toString('base64'),
      mimeType: detected.mimeType,
      fileName: media.file_name ?? path.basename(decision.path),
    },
  };
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
  options: ResolveTurnMediaOptions = {},
): Promise<InboundMediaInjection> {
  const {
    references,
    signal = new AbortController().signal,
    providerInput,
    transcriber,
    perception,
    inboundMediaRoots,
    inboundMediaOrigins,
  } = options;
  const where = { ...(options.scene ? { scene: options.scene } : {}), ...(options.messageId ? { message: options.messageId } : {}) };
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
  let perceived = 0;
  let perceptionUsage: Usage | undefined;
  const perceptionCalls: InboundPerceptionCall[] = [];

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
    const { payload, refused, rejected } = await materializeInboundMedia(type, media, config.maxFileBytes, signal, inboundMediaRoots, options.mediaTransport, inboundMediaOrigins);
    signal.throwIfAborted();
    if (refused) {
      // The reason and kind only: the path itself names host layout and stays out of logs and prompt.
      logger.warn(formatCompact({ op: 'inbound_media_rejected', type, reason: refused, ...where, scheme: 'path' }));
      textAppends.push(unreadableLocalFileText(type, refused, media));
      outcomes.push({ kind: type, status: 'rejected', code: refused });
      continue;
    }
    if (!payload) {
      // #1250 inbound-media-reject-reason-opaque: the specific reason, scene, and the URL's scheme + host
      // (never its path, query string or inline data).
      const code = rejected?.reason ?? 'unmaterialized_platform_reference';
      logger.warn(formatCompact({ op: 'inbound_media_rejected', type, reason: code, ...where,
        ...(rejected ? { scheme: rejected.scheme } : {}),
        ...(rejected?.host ? { host: rejected.host } : {}),
        ...(rejected?.status !== undefined ? { status: rejected.status } : {}) }));
      textAppends.push(failureText(type, `rejected:${code}`, media));
      outcomes.push({ kind: type, status: 'rejected', code });
      continue;
    }

    if (type === 'audio') {
      if (config.audio.strategy === 'transcribe') {
        try {
          const text = await transcribeAudioPayload(payload, transcriber, signal);
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
      if (perception?.accepts(payload)) {
        if (perceived >= perception.maxItemsPerTurn) {
          logger.warn(formatCompact({ op: 'inbound_perception_skipped', type, reason: 'max_items_per_turn' }));
        } else {
          perceived += 1;
          const started = Date.now();
          try {
            const result = await perception.describe(payload, signal);
            if (result?.usage) {
              perceptionUsage = addUsage(perceptionUsage, result.usage);
              perceptionCalls.push(Object.freeze({ kind: type, provider: result.provider, model: result.model,
                usage: result.usage, durationMs: Date.now() - started, status: 'completed' as const }));
            }
            if (result?.text.trim()) {
              textAppends.push(renderPerceptionCaption(type, result.text));
              outcomes.push({
                kind: type,
                status: 'derived',
                code: 'media_perception',
                provenance: Object.freeze({
                  source: 'media_perception' as const,
                  provider: result.provider,
                  model: result.model,
                  cached: result.cached,
                }),
                description: result.text.trim(),
              });
              continue;
            }
          } catch (error) {
            // A call that failed after reaching the provider still counts against the quota.
            if (error instanceof MediaPerceptionFailedError) {
              perceptionUsage = addUsage(perceptionUsage, error.usage);
              perceptionCalls.push(Object.freeze({ kind: type, ...(error.provider ? { provider: error.provider } : {}),
                ...(error.model ? { model: error.model } : {}), usage: error.usage, durationMs: Date.now() - started,
                status: 'failed' as const }));
            }
            signal.throwIfAborted();
            logger.warn(formatCompact({
              op: 'inbound_perception_failed',
              type,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      }
      textAppends.push(failureText(type, 'unsupported:provider_input', media));
      outcomes.push({ kind: type, status: 'unsupported', code: 'provider_input' });
      continue;
    }
    blocks.push(toBase64Block(type, payload));
    outcomes.push({ kind: type, status: 'accepted', code: 'validated_provider_input' });
  }

  if (blocks.length === 0 && textAppends.length === 0 && outcomes.length === 0) return EMPTY_INJECTION;
  return { blocks, textAppends, outcomes, perceptionItems: perceived, ...(perceptionUsage ? { perceptionUsage } : {}),
    ...(perceptionCalls.length ? { perceptionCalls } : {}) };
}

/**
 * #1250 vision-ask-after-perception: framework line after the perception descriptions of a turn whose model
 * can hand work to other agents. The description already answers "what is in the picture"; asking another
 * agent to look again costs a sub-turn, and the original media goes with such a request only when that
 * agent's model can take it.
 */
export const PERCEPTION_DELEGATION_NOTE = '[Framework note: the attached media was already described above by the perception model in this turn. '
  + 'Answer from that description; do not ask or delegate another agent only to look at or confirm it. '
  + 'If the question needs more than the description gives, the agent you ask receives the original media when its model can take it.]';

/** {@link PERCEPTION_DELEGATION_NOTE} when at least one item of the turn was described by the perception pre-pass. */
export function perceptionDelegationNote(outcomes: readonly InboundMediaOutcome[]): string | undefined {
  return outcomes.some(outcome => outcome.provenance?.source === 'media_perception') ? PERCEPTION_DELEGATION_NOTE : undefined;
}

function addUsage(a: Usage | undefined, b: Usage): Usage {
  return {
    prompt_tokens: (a?.prompt_tokens ?? 0) + b.prompt_tokens,
    completion_tokens: (a?.completion_tokens ?? 0) + b.completion_tokens,
    total_tokens: (a?.total_tokens ?? 0) + b.total_tokens,
  };
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
