import type { ContentPart } from '@zhin.js/ai';
import type { MultimodalConfig, PreprocessInboundResult } from './media-types.js';
import {
  normalizeContentPartsToPayloads,
  payloadToVisionPart,
} from './media-normalize.js';
import { spoolPayloadToFile } from './media-spool.js';
import * as path from 'node:path';

function byteLengthFromBase64(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function describePayload(payload: import('./media-types.js').MediaBinaryPayload): string {
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

/**
 * 入站混合路由：base64 载荷 → 文本补充 + vision image parts
 */
export async function preprocessInboundMedia(
  parts: ContentPart[],
  config: MultimodalConfig,
  workspaceDir?: string,
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

    if (p.kind === 'audio' && config.audio.strategy !== 'text-only') {
      const filePath = spoolPayloadToFile(p, inboundRoot, 'audio');
      lines.push(`${describePayload(p)}\n(已落盘: ${filePath}，可供 STT/MCP 使用)`);
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
