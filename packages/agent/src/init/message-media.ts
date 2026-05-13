import type { ContentPart, Message } from '@zhin.js/core';

/**
 * Extract multimodal ContentPart[] from a Message's structured $content segments.
 * Handles image, video, audio, and face/sticker types.
 * Falls back to raw string parsing for image URLs when $content has no media segments.
 */
export function extractMediaParts(message: Message<any>): ContentPart[] {
  const parts: ContentPart[] = [];

  if (Array.isArray(message.$content)) {
    for (const seg of message.$content) {
      if (typeof seg === 'string' || !seg || !seg.type) continue;
      const { type, data } = seg;
      switch (type) {
        case 'image': {
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'image_url', image_url: { url } });
          break;
        }
        case 'video': {
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

