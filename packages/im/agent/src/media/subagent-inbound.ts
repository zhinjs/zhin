import * as path from 'node:path';
import { loadSpeechPipeline } from '@zhin.js/core';
import type { AIProvider, ContentPart } from '@zhin.js/ai';
import {
  normalizeContentPartsToPayloads,
  payloadToVisionPart,
} from './media-normalize.js';
import { spoolPayloadToFile } from './media-spool.js';
import type { MediaBinaryPayload, MultimodalConfig } from './media-types.js';
import { resolveMultimodalConfig } from './resolve-config.js';
import { providerSupportsVision } from './vision-capability.js';

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

export interface SubagentInboundTask {
  /** 传给 Agent.run 的首条 user content */
  runInput: string | ContentPart[];
  spooledPaths: string[];
  mediaPartCount: number;
  payloadCount: number;
  visionPartCount: number;
  useNativeVision: boolean;
}

/**
 * 入站 route 子 agent：落盘媒体并可选注入 vision parts（主路径 multimodal 在 spawnSync 前不会执行）
 */
export async function buildSubagentInboundTask(
  aiContent: string,
  mediaParts: ContentPart[],
  opts?: { workspaceDir?: string; provider?: AIProvider; config?: MultimodalConfig },
): Promise<SubagentInboundTask> {
  const config = opts?.config ?? resolveMultimodalConfig();
  const payloads = await normalizeContentPartsToPayloads(mediaParts, config.maxFileBytes);
  const inboundRoot = path.join(opts?.workspaceDir || process.cwd(), config.inboundDir);
  const lines: string[] = [];
  const visionParts: ContentPart[] = [];
  const spooledPaths: string[] = [];
  const useNativeVision = Boolean(
    opts?.provider
    && providerSupportsVision(opts.provider)
    && config.enabled
    && config.image.preferNativeVision,
  );

  for (const p of payloads) {
    if (byteLengthFromBase64(p.base64) > config.maxFileBytes) {
      lines.push(`[${p.kind} 超过大小上限，已省略二进制内容]`);
      continue;
    }

    if (p.kind === 'image') {
      const filePath = spoolPayloadToFile(p, inboundRoot, 'image');
      spooledPaths.push(filePath);
      lines.push(
        `${describePayload(p)}\n(已落盘: ${filePath}；请用 analyze_media，file_path 填该绝对路径)`,
      );
      if (useNativeVision) {
        const vp = payloadToVisionPart(p);
        if (vp) visionParts.push(vp);
      }
      continue;
    }

    if (p.kind === 'audio') {
      if (config.audio.strategy === 'mcp') {
        const filePath = spoolPayloadToFile(p, inboundRoot, 'audio');
        spooledPaths.push(filePath);
        lines.push(
          `${describePayload(p)}\n(已落盘: ${filePath}，可供 STT/MCP 使用)`,
        );
        continue;
      }

      if (config.audio.strategy === 'transcribe') {
        try {
          const pipeline = await loadSpeechPipeline();
          if (pipeline) {
            const text = await pipeline.transcribe({
              data: Buffer.from(p.base64, 'base64'),
              mimeType: p.mimeType,
            });
            if (text?.trim()) {
              lines.push(`[语音转写] ${text.trim()}`);
              continue;
            }
          }
        } catch {
          // fall through
        }
        lines.push(describePayload(p));
        continue;
      }

      if (config.audio.strategy !== 'text-only') {
        lines.push(describePayload(p));
        continue;
      }

      lines.push(describePayload(p));
      continue;
    }

    if (p.kind === 'video' && config.video.strategy === 'mcp') {
      const filePath = spoolPayloadToFile(p, inboundRoot, 'video');
      spooledPaths.push(filePath);
      lines.push(
        `${describePayload(p)}\n(已落盘: ${filePath}，可供 ffmpeg MCP 抽帧)`,
      );
      continue;
    }

    lines.push(describePayload(p));
  }

  const textBlock = [aiContent, lines.join('\n')].filter(Boolean).join('\n\n');
  let runInput: string | ContentPart[];
  if (useNativeVision && visionParts.length > 0) {
    const parts: ContentPart[] = [];
    if (textBlock.trim()) parts.push({ type: 'text', text: textBlock });
    parts.push(...visionParts);
    runInput = parts;
  } else {
    runInput = textBlock || aiContent;
  }

  return {
    runInput,
    spooledPaths,
    mediaPartCount: mediaParts.length,
    payloadCount: payloads.length,
    visionPartCount: visionParts.length,
    useNativeVision: useNativeVision && visionParts.length > 0,
  };
}
