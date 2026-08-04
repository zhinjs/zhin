/**
 * ContentPart[] → agentLoop UserMessage（ADR 0009 D2：canonical media blocks）
 */
import { type ContentPart, type MediaContentBlock, type UserMessage, createUserMessage } from '@zhin.js/ai';
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

function imageUrlToContent(url: string): MediaContentBlock | null {
  const parsed = parseDataUri(url);
  if (parsed) {
    return {
      type: 'image',
      data: { media: { kind: 'base64', value: parsed.base64, mime_type: parsed.mime } },
    };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return {
      type: 'image',
      data: { media: { kind: 'url', value: url, mime_type: 'image/jpeg' } },
    };
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

/** 构建带 canonical media blocks 的 UserMessage（vision 模型走 agentLoop） */
export async function buildVisionUserMessage(
  sessionUserContent: string,
  parts: ContentPart[],
  supportsVision: boolean,
  maxFileBytes: number,
): Promise<UserMessage> {
  const media: MediaContentBlock[] = [];

  if (supportsVision) {
    const payloads = await normalizeContentPartsToPayloads(parts, maxFileBytes);
    for (const payload of payloads) {
      if (payload.kind === 'image') {
        media.push({
          type: 'image',
          data: {
            media: { kind: 'base64', value: payload.base64, mime_type: payload.mimeType },
          },
        });
      }
    }

    if (media.length === 0) {
      for (const p of parts) {
        if (p.type !== 'image_url') continue;
        const block = imageUrlToContent(p.image_url.url);
        if (block) media.push(block);
      }
    }
  }

  return createUserMessage(sessionUserContent, media.length > 0 ? media : undefined);
}
