import type { ContentPart, Message, QuotedMessagePayload } from '@zhin.js/core';
import { Message as MessageNs } from '@zhin.js/core';

/**
 * Extract multimodal ContentPart[] from a Message's structured $content segments.
 * Handles image, video, audio, and face/sticker types.
 * Falls back to raw string parsing for image URLs when $content has no media segments.
 */
export function extractMediaParts(message: Message): ContentPart[] {
  const parts: ContentPart[] = [];

  if (Array.isArray(message.$content)) {
    for (const seg of message.$content) {
      if (typeof seg === 'string' || !seg || !seg.type) continue;
      const { type, data } = seg;
      switch (type) {
        case 'image': {
          const b64 = data?.base64 || data?.data;
          if (b64 && typeof b64 === 'string') {
            const mime = data?.mime || data?.mimeType || 'image/jpeg';
            parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
            break;
          }
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'image_url', image_url: { url } });
          break;
        }
        case 'video': {
          const b64 = data?.base64;
          if (b64 && typeof b64 === 'string') {
            const mime = data?.mime || data?.mimeType || 'video/mp4';
            parts.push({ type: 'video_url', video_url: { url: `data:${mime};base64,${b64}` } } as ContentPart);
            break;
          }
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'video_url', video_url: { url } } as ContentPart);
          break;
        }
        case 'audio':
        case 'record':
        case 'voice': {
          const dataStr = data?.data || data?.base64;
          if (dataStr) {
            const fmt = data?.format === 'wav' ? 'wav' : 'mp3';
            parts.push({ type: 'audio', audio: { data: dataStr, format: fmt } });
          } else {
            const url = data?.url || data?.file || data?.src;
            if (url) {
              parts.push({ type: 'text', text: `[用户发送了一段语音: ${url}]` });
            }
          }
          break;
        }
        case 'face':
        case 'sticker':
        case 'emoji': {
          const id = String(data?.id ?? data?.face_id ?? '');
          const text = data?.text || data?.name || data?.describe;
          if (id) parts.push({ type: 'face', face: { id, text } } as ContentPart);
          break;
        }
      }
    }
  }

  if (parts.length === 0) {
    const raw = typeof message.$raw === 'string' ? message.$raw : JSON.stringify(message.$raw || '');

    const xmlMatches = raw.match(/<image[^>]+url="([^"]+)"/g);
    if (xmlMatches) {
      for (const m of xmlMatches) {
        const urlMatch = m.match(/url="([^"]+)"/);
        if (urlMatch) parts.push({ type: 'image_url', image_url: { url: urlMatch[1] } });
      }
    }

    const cqMatches = raw.match(/\[CQ:image[^\]]*url=([^\],]+)/g);
    if (cqMatches) {
      for (const m of cqMatches) {
        const urlMatch = m.match(/url=([^\],]+)/);
        if (urlMatch) parts.push({ type: 'image_url', image_url: { url: urlMatch[1] } });
      }
    }
  }

  return parts;
}

/** 从已拉取的引用消息 payload 提取多模态部分（如被引消息里的图片） */
export function extractMediaPartsFromQuotedPayload(
  payload: QuotedMessagePayload,
  adapter: Message['$adapter'] = 'process',
): ContentPart[] {
  if (!payload.content || !Array.isArray(payload.content) || !payload.content.length) {
    return [];
  }
  const stub = MessageNs.from(
    {},
    {
      $id: payload.messageId,
      $adapter: adapter,
      $endpoint: '',
      $content: payload.content,
      $sender: { id: payload.sender?.id ?? '' },
      $reply: async () => payload.messageId,
      $recall: async () => {},
      $channel: { id: '', type: 'private' },
      $timestamp: payload.time ?? 0,
      $raw: payload.raw ?? '',
    },
  );
  return extractMediaParts(stub);
}

