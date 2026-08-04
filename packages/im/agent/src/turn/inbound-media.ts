/**
 * 入站媒体注入 — commMessage 的 canonical 媒体段 → 当前 turn 的
 * `UserMessage.media`（MediaContentBlock，不随 session 持久化）。
 *
 * 策略（`ai.multimodal`）：
 * - image：url / base64 直挂；path 经 media pipeline 物化为 base64；
 *   平台不透明 file 引用暂不可解 → 占位文本。
 * - audio：默认 transcribe（@zhin.js/speech 可选）→ 转写文本；未装/失败或
 *   text-only 策略 → 占位文本；mcp 策略 → 占位 + 落盘提示（暂同 text-only）。
 * - video / file：占位文本（video 抽帧为既有配置面，不在此默认开启）。
 */
import { type MediaContentBlock, type MediaBlockRef } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  readLocalFileAsBase64,
} from '../media/media-normalize.js';
import { readInboundMediaRefs } from '../media/inbound-refs.js';
import type { MediaBinaryPayload } from '../media/media-types.js';
import { transcribeAudioPayload } from '../media/media-router.js';
import {
  getPrimaryAppConfig,
  resolveMultimodalConfig,
} from '../media/resolve-config.js';

const logger = getLogger('ZhinAgent');

export interface InboundMediaInjection {
  /** 挂到当前 turn UserMessage.media 的媒体块 */
  readonly blocks: MediaContentBlock[];
  /** 需要拼进用户消息文本的补充（STT 转写 / 占位） */
  readonly textAppends: string[];
}

const EMPTY_INJECTION: InboundMediaInjection = Object.freeze({
  blocks: Object.freeze([]) as unknown as MediaContentBlock[],
  textAppends: Object.freeze([]) as unknown as string[],
});

function placeholderOf(type: string, ref: MediaBlockRef): string {
  const label = ref.file_name ?? ({ image: '图片', audio: '音频', video: '视频', file: '文件' } as Record<string, string>)[type] ?? '媒体';
  return `[${label}]`;
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

export async function resolveInboundMediaInjection(
  commMessage: Message,
): Promise<InboundMediaInjection> {
  const refs = readInboundMediaRefs(commMessage);
  if (refs.length === 0) return EMPTY_INJECTION;

  const config = resolveMultimodalConfig();
  const blocks: MediaContentBlock[] = [];
  const textAppends: string[] = [];

  for (const { type, media } of refs) {
    if (type === 'image') {
      if (media.kind === 'url' || media.kind === 'base64') {
        blocks.push({ type: 'image', data: { media } });
        continue;
      }
      if (media.kind === 'path') {
        const payload = await readLocalFileAsBase64(media.value, config.maxFileBytes);
        if (payload) {
          blocks.push(toBase64Block('image', payload));
        } else {
          logger.warn(formatCompact({ op: 'inbound_media_dropped', type, reason: 'path_read_failed' }));
          textAppends.push(placeholderOf(type, media));
        }
        continue;
      }
      // kind=file：平台不透明引用（留 adapter 解析钩子，二期）
      textAppends.push(placeholderOf(type, media));
      continue;
    }

    if (type === 'audio' || type === 'record' || type === 'voice') {
      const payload = await resolveAudioPayload(media, config.maxFileBytes);
      if (payload && config.audio.strategy === 'transcribe') {
        try {
          const text = await transcribeAudioPayload(payload, {
            getConfig: getPrimaryAppConfig,
            warn: (msg) => logger.warn(formatCompact({ op: 'inbound_stt', fallback: msg })),
          });
          if (text?.trim()) {
            textAppends.push(`[语音转写] ${text.trim()}`);
            continue;
          }
        } catch (error) {
          logger.warn(formatCompact({
            op: 'inbound_stt_failed',
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      textAppends.push(placeholderOf('audio', media));
      continue;
    }

    textAppends.push(placeholderOf(type === 'video' ? 'video' : 'file', media));
  }

  if (blocks.length === 0 && textAppends.length === 0) return EMPTY_INJECTION;
  return { blocks, textAppends };
}

async function resolveAudioPayload(
  media: MediaBlockRef,
  maxFileBytes: number,
): Promise<MediaBinaryPayload | null> {
  if (media.kind === 'base64') {
    return {
      kind: 'audio',
      base64: media.value.replace(/^base64:\/\//, ''),
      mimeType: media.mime_type ?? 'audio/mpeg',
      ...(media.file_name ? { fileName: media.file_name } : {}),
    };
  }
  if (media.kind === 'path') {
    const payload = await readLocalFileAsBase64(media.value, maxFileBytes);
    return payload ? { ...payload, kind: 'audio' } : null;
  }
  // url 音频需下载，暂不走物化（占位）；file 引用同二期钩子
  return null;
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
