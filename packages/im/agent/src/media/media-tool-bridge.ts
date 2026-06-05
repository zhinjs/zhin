import type { OutputElement } from '@zhin.js/ai';
import type { ToolCallRecord } from '../zhin-agent/tool-calls-user-format.js';

function parseToolResultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 从工具结果提取出站媒体（如 voice_tts → AudioElement）
 */
export function extractMediaElementsFromToolCalls(
  toolCalls: ToolCallRecord[],
): OutputElement[] {
  const out: OutputElement[] = [];
  for (const tc of toolCalls) {
    const obj = parseToolResultObject(tc.result);
    if (!obj) continue;

    if (tc.tool === 'voice_tts') {
      const audio = obj.audio;
      if (typeof audio !== 'string' || !audio) continue;
      const format = typeof obj.format === 'string' ? obj.format : 'mp3';
      const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
      out.push({
        type: 'audio',
        url: `data:${mime};base64,${audio}`,
        base64: audio,
      });
      continue;
    }

    if (tc.tool === 'generate_image') {
      const image = obj.image;
      if (typeof image !== 'string' || !image) continue;
      const mime = typeof obj.mime === 'string' ? obj.mime : 'image/png';
      out.push({
        type: 'image',
        url: `data:${mime};base64,${image}`,
        base64: image,
      });
    }
  }
  return out;
}

/** parseOutput 结果 + 工具媒体元素合并 */
export function mergeToolOutboundElements(
  elements: OutputElement[],
  toolCalls: ToolCallRecord[],
): OutputElement[] {
  const media = extractMediaElementsFromToolCalls(toolCalls);
  if (!media.length) return elements;
  return [...elements, ...media];
}
