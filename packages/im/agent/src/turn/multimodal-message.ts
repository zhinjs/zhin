/**
 * ContentPart[] → agentLoop UserMessage（ADR 0009 D2：image blocks）
 */
import type { ContentPart, ImageContent, UserMessage } from '@zhin.js/ai';
import { createUserMessage } from '@zhin.js/ai';
import { normalizeContentPartsToPayloads } from '../media/media-normalize.js';

type MultimodalPart =
  | ContentPart
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'face'; face: { id: string; text?: string } };

function parseDataUri(dataUri: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function imageUrlToContent(url: string): ImageContent | null {
  const parsed = parseDataUri(url);
  if (parsed) {
    return { type: 'image', data: parsed.base64, mimeType: parsed.mime };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { type: 'image', data: url, mimeType: 'image/jpeg' };
  }
  return null;
}

/** 从 ContentPart 拼会话可见文本（含 [图片] 等占位） */
export function summarizeMultimodalParts(
  parts: ContentPart[],
  supportsVision: boolean,
): string {
  const fragments: string[] = [];
  for (const p of parts as MultimodalPart[]) {
    switch (p.type) {
      case 'text':
        fragments.push(p.text);
        break;
      case 'image_url':
        fragments.push('[图片]');
        break;
      case 'video_url':
        fragments.push('[视频]');
        break;
      case 'audio':
        fragments.push('[音频]');
        break;
      case 'face':
        fragments.push(p.face.text || `[表情:${p.face.id}]`);
        break;
    }
  }
  return fragments.join(' ') || '[多模态消息]';
}

/** 构建带 image blocks 的 UserMessage（vision 模型走 agentLoop） */
export async function buildVisionUserMessage(
  sessionUserContent: string,
  parts: ContentPart[],
  supportsVision: boolean,
  maxFileBytes: number,
): Promise<UserMessage> {
  const images: ImageContent[] = [];

  if (supportsVision) {
    const payloads = await normalizeContentPartsToPayloads(parts, maxFileBytes);
    for (const payload of payloads) {
      if (payload.kind === 'image') {
        images.push({
          type: 'image',
          data: payload.base64,
          mimeType: payload.mimeType,
        });
      }
    }

    if (images.length === 0) {
      for (const p of parts) {
        if (p.type !== 'image_url') continue;
        const block = imageUrlToContent(p.image_url.url);
        if (block) images.push(block);
      }
    }
  }

  return createUserMessage(sessionUserContent, images.length > 0 ? images : undefined);
}
