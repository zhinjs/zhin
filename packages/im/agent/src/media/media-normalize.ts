import type { ContentPart } from '@zhin.js/ai';
import type { MediaBinaryPayload, MediaKind } from './media-types.js';

function guessMimeFromFormat(fmt: string): string {
  if (fmt === 'wav') return 'audio/wav';
  if (fmt === 'mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function kindFromContentPart(part: ContentPart): MediaKind | null {
  switch (part.type) {
    case 'image_url':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video_url':
      return 'video';
    default:
      return null;
  }
}

function parseDataUri(dataUri: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

export async function fetchUrlAsBase64(url: string, maxBytes: number): Promise<MediaBinaryPayload | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    let kind: MediaKind = 'file';
    if (mime.startsWith('image/')) kind = 'image';
    else if (mime.startsWith('audio/')) kind = 'audio';
    else if (mime.startsWith('video/')) kind = 'video';
    return { kind, base64: buf.toString('base64'), mimeType: mime };
  } catch {
    return null;
  }
}

/**
 * ContentPart[] → MediaBinaryPayload[]（优先已有 base64；URL 按需 fetch）
 */
export async function normalizeContentPartsToPayloads(
  parts: ContentPart[],
  maxFileBytes: number,
): Promise<MediaBinaryPayload[]> {
  const out: MediaBinaryPayload[] = [];

  for (const part of parts) {
    if (part.type === 'face') continue;

    const kind = kindFromContentPart(part);
    if (!kind) continue;

    if (part.type === 'audio') {
      const b64 = part.audio.data;
      if (b64) {
        out.push({
          kind: 'audio',
          base64: b64,
          mimeType: guessMimeFromFormat(part.audio.format),
          meta: { format: part.audio.format },
        });
      }
      continue;
    }

    if (part.type === 'image_url') {
      const url = part.image_url.url;
      const parsed = parseDataUri(url);
      if (parsed) {
        out.push({ kind: 'image', base64: parsed.base64, mimeType: parsed.mime });
        continue;
      }
      const fetched = await fetchUrlAsBase64(url, maxFileBytes);
      if (fetched) out.push(fetched);
      continue;
    }

    if (part.type === 'video_url') {
      const url = part.video_url.url;
      const parsed = parseDataUri(url);
      if (parsed) {
        out.push({ kind: 'video', base64: parsed.base64, mimeType: parsed.mime });
        continue;
      }
      const fetched = await fetchUrlAsBase64(url, maxFileBytes);
      if (fetched) out.push({ ...fetched, kind: 'video' });
    }
  }

  return out;
}

export function payloadToDataUri(payload: MediaBinaryPayload): string {
  return `data:${payload.mimeType};base64,${payload.base64}`;
}

export function payloadToVisionPart(payload: MediaBinaryPayload): ContentPart | null {
  if (payload.kind !== 'image') return null;
  return {
    type: 'image_url',
    image_url: { url: payloadToDataUri(payload), detail: 'auto' },
  };
}
