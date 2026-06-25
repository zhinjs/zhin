import { loadSpeechPipeline } from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/ai';
import { createWarnOnce, resetWarnOnceForTests, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import type { ContentChainLogFields } from '@zhin.js/logger';
import type { MediaBinaryPayload, MultimodalConfig, PreprocessInboundResult } from './media-types.js';
import {
  normalizeContentPartsToPayloads,
  payloadToVisionPart,
} from './media-normalize.js';
import { spoolPayloadToFile } from './media-spool.js';
import * as path from 'node:path';

function byteLengthFromBase64(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function describePayload(payload: MediaBinaryPayload): string {
  const bytes = byteLengthFromBase64(payload.base64);
  const kb = (bytes / 1024).toFixed(1);
  switch (payload.kind) {
    case 'image':
      return `[用户发送图片 (${payload.mimeType}, ${kb} KB)]`;
    case 'audio':
      return `[用户发送音频 (${payload.mimeType}, ${kb} KB)]`;
    case 'video':
      return `[用户发送视频 (${payload.mimeType}, ${kb} KB)]`;
    default:
      return `[用户发送附件 (${payload.mimeType}, ${kb} KB)]`;
  }
}

export interface PreprocessInboundMediaDeps {
  transcribe?: (payload: MediaBinaryPayload) => Promise<string>;
  getConfig?: () => Record<string, unknown> | undefined;
  warn?: (message: string) => void;
  logContentChain?: (fields: ContentChainLogFields) => void;
}

const speechWarnOnce = createWarnOnce('speech');
const sttFailWarnOnce = createWarnOnce('stt-fail');

/** 测试用：重置 warn-once 状态 */
export function resetPreprocessInboundMediaForTests(): void {
  resetWarnOnceForTests('speech');
  resetWarnOnceForTests('stt-fail');
}

async function transcribeAudioPayload(
  payload: MediaBinaryPayload,
  deps?: PreprocessInboundMediaDeps,
): Promise<string | undefined> {
  const transcribeFn = deps?.transcribe;
  if (transcribeFn) {
    return transcribeFn(payload);
  }

  const pipeline = await loadSpeechPipeline({
    getConfig: deps?.getConfig,
    warn: (msg) => speechWarnOnce(deps?.warn, msg),
  });
  if (!pipeline) {
    return undefined;
  }

  const data = Buffer.from(payload.base64, 'base64');
  return pipeline.transcribe({ data, mimeType: payload.mimeType });
}

/**
 * 入站混合路由：base64 载荷 → 文本补充 + vision image parts
 */
export async function preprocessInboundMedia(
  parts: ContentPart[],
  config: MultimodalConfig,
  workspaceDir?: string,
  deps?: PreprocessInboundMediaDeps,
): Promise<PreprocessInboundResult> {
  const payloads = await normalizeContentPartsToPayloads(parts, config.maxFileBytes);
  const lines: string[] = [];
  const visionParts: ContentPart[] = [];

  const inboundRoot = path.join(workspaceDir || process.cwd(), config.inboundDir);

  for (const p of payloads) {
    if (byteLengthFromBase64(p.base64) > config.maxFileBytes) {
      lines.push(`[${p.kind} 超过大小上限，已省略二进制内容]`);
      continue;
    }

    if (p.kind === 'image' && config.image.preferNativeVision) {
      const vp = payloadToVisionPart(p);
      if (vp) visionParts.push(vp);
      lines.push(describePayload(p));
      continue;
    }

    if (p.kind === 'audio') {
      if (config.audio.strategy === 'text-only') {
        lines.push(describePayload(p));
        continue;
      }

      if (config.audio.strategy === 'mcp') {
        const filePath = spoolPayloadToFile(p, inboundRoot, 'audio');
        lines.push(`${describePayload(p)}\n(已落盘: ${filePath}，可供 STT/MCP 使用)`);
        continue;
      }

      if (config.audio.strategy === 'transcribe') {
        try {
          const text = await transcribeAudioPayload(p, deps);
          if (text?.trim()) {
            deps?.logContentChain?.({
              stage: CONTENT_CHAIN_STAGE.STT,
              ok: true,
              peer: 'speech',
              chars: text.trim().length,
            });
            lines.push(`[语音转写] ${text.trim()}`);
            continue;
          }
        } catch {
          deps?.logContentChain?.({
            stage: CONTENT_CHAIN_STAGE.STT,
            ok: false,
            peer: 'speech',
          });
          // fall through to placeholder
        }
        sttFailWarnOnce(
          deps?.warn,
          '语音转写失败或未安装 @zhin.js/speech，已降级为文本占位。安装: pnpm add @zhin.js/speech',
        );
        lines.push(describePayload(p));
        continue;
      }

      lines.push(describePayload(p));
      continue;
    }

    if (p.kind === 'video' && config.video.strategy === 'mcp') {
      const filePath = spoolPayloadToFile(p, inboundRoot, 'video');
      lines.push(`${describePayload(p)}\n(已落盘: ${filePath}，可供 ffmpeg MCP 抽帧)`);
      continue;
    }

    lines.push(describePayload(p));
  }

  return {
    textAppend: lines.join('\n'),
    visionParts,
    payloads,
  };
}
