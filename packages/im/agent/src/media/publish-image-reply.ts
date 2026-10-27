import { parseLenientJsonObject, type AssistantMessage } from '@zhin.js/ai';
import type { ImageAssetPublisher, PublishedImage } from './image-assets.js';
import { DEFAULT_MULTIMODAL_CONFIG } from './media-types.js';
import { decodeBase64 } from './media-normalize.js';
import { unwrapJsonStringLayers } from '../core/text-sanitize.js';
import { TOOL_CALL_MARKUP } from '../outbound/structured-reply.js';

/** Normalize only the final-reply media contract, never arbitrary base64-looking text. */
export async function publishReplyImages(
  assistant: AssistantMessage,
  publisher: ImageAssetPublisher,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  const uploaded = new Map<string, PublishedImage>();
  const content: AssistantMessage['content'] = [];
  for (const block of assistant.content) {
    if (block.type !== 'text') { content.push(block); continue; }
    // Match the existing final-reply recovery path, including fences and JSON-string wrappers.
    // Normalize before its output can become history or a correction prompt.
    if (TOOL_CALL_MARKUP.test(block.text)) { content.push(block); continue; }
    const reply = parseLenientJsonObject(unwrapJsonStringLayers(block.text));
    if (!isObject(reply)) { content.push(block); continue; }
    const messages = Array.isArray(reply.messages) ? reply.messages : [reply];
    let changed = false;
    for (const message of messages) {
      if (!isObject(message) || !Array.isArray(message.segments)) continue;
      for (const [index, segment] of message.segments.entries()) {
        if (!isObject(segment) || segment.type !== 'image' || !isObject(segment.data)) continue;
        const media = segment.data.media;
        if (!isObject(media) || typeof media.value !== 'string') continue;
        const encoded = media.kind === 'base64' ? media.value
          : media.kind === 'url' ? /^data:image\/[^;]+;base64,(.+)$/isu.exec(media.value)?.[1] : undefined;
        if (encoded === undefined) continue;
        changed = true;
        try {
          signal?.throwIfAborted();
          const compact = encoded.replace(/^data:image\/[^;]+;base64,/iu, '').replace(/^base64:\/\//u, '').replace(/\s/gu, '');
          let image = uploaded.get(compact);
          if (!image) {
            const bytes = decodeBase64(compact, DEFAULT_MULTIMODAL_CONFIG.maxFileBytes);
            if (!bytes) throw new Error('Invalid inline image');
            image = await publisher.publish(bytes, signal);
            uploaded.set(compact, image);
          }
          segment.data.media = { kind: 'url', value: image.image_url, mime_type: image.mime, size: image.size };
        } catch {
          signal?.throwIfAborted();
          // Persist the same failure the user sees; never retry generation or retain the bytes.
          message.segments[index] = { type: 'text', data: { text: '图片上传失败，请稍后重试。' } };
        }
      }
    }
    content.push(changed ? { ...block, text: JSON.stringify(reply) } : block);
  }
  return { ...assistant, content };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
