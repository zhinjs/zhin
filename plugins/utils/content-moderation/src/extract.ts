import type { ExtractedImage, ScanContext, TextMatch } from './types.js';

export interface ExtractedContent {
  readonly text: string;
  readonly images: readonly ExtractedImage[];
  /** Original segment list when payload was structured; undefined for plain string. */
  readonly segments?: readonly Record<string, unknown>[];
}

export function extractFromTextAndSegments(
  content: string,
  segments: readonly unknown[] | undefined,
): ExtractedContent {
  if (Array.isArray(segments) && segments.length > 0) {
    return extractFromSegments(segments);
  }
  return Object.freeze({
    text: content ?? '',
    images: Object.freeze([] as ExtractedImage[]),
  });
}

export function extractFromOutboundPayload(payload: unknown): ExtractedContent {
  if (typeof payload === 'string') {
    return Object.freeze({
      text: payload,
      images: Object.freeze([] as ExtractedImage[]),
    });
  }
  if (Array.isArray(payload)) {
    return extractFromSegments(payload);
  }
  if (payload && typeof payload === 'object' && 'type' in payload) {
    return extractFromSegments([payload]);
  }
  return Object.freeze({
    text: payload == null ? '' : String(payload),
    images: Object.freeze([] as ExtractedImage[]),
  });
}

function extractFromSegments(segments: readonly unknown[]): ExtractedContent {
  const texts: string[] = [];
  const images: ExtractedImage[] = [];
  const normalized: Record<string, unknown>[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || typeof seg !== 'object') continue;
    const record = seg as Record<string, unknown>;
    normalized.push(record);
    const type = String(record.type ?? '');
    const data = asRecord(record.data);

    if (type === 'text') {
      const text = typeof data.text === 'string' ? data.text : '';
      if (text) texts.push(text);
      continue;
    }

    if (type === 'image') {
      const media = asRecord(data.media);
      const image = mediaToImage(images.length, i, media, data);
      if (image) images.push(image);
    }
  }

  return Object.freeze({
    text: texts.join(''),
    images: Object.freeze(images),
    segments: Object.freeze(normalized),
  });
}

function mediaToImage(
  index: number,
  segmentIndex: number,
  media: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedImage | null {
  // Canonical MediaRef
  if (typeof media.kind === 'string' && typeof media.value === 'string') {
    const mime = typeof media.mime_type === 'string' ? media.mime_type : undefined;
    if (media.kind === 'url') {
      return Object.freeze({ index, segmentIndex, url: media.value, mime });
    }
    if (media.kind === 'base64') {
      return Object.freeze({ index, segmentIndex, base64: media.value, mime });
    }
    if (media.kind === 'path') {
      return Object.freeze({ index, segmentIndex, path: media.value, mime });
    }
    // kind=file: opaque platform ref — no fetchable URL
    return Object.freeze({ index, segmentIndex, mime });
  }

  // Legacy wire fields
  if (typeof data.url === 'string' && data.url) {
    return Object.freeze({ index, segmentIndex, url: data.url });
  }
  if (typeof data.base64 === 'string' && data.base64) {
    return Object.freeze({ index, segmentIndex, base64: data.base64 });
  }
  if (typeof data.file === 'string' && data.file) {
    const file = data.file;
    if (/^https?:\/\//i.test(file)) {
      return Object.freeze({ index, segmentIndex, url: file });
    }
    return Object.freeze({ index, segmentIndex, path: file });
  }

  return null;
}

export function buildScanContext(input: {
  readonly adapter?: string;
  readonly endpoint?: string;
  readonly conversationKind?: string;
  readonly conversationId?: string;
  readonly sender?: string;
}): ScanContext {
  return Object.freeze({
    adapter: input.adapter ?? '',
    endpoint: input.endpoint ?? '',
    conversationKind: input.conversationKind ?? '',
    conversationId: input.conversationId ?? '',
    ...(input.sender != null ? { sender: input.sender } : {}),
  });
}

export function mergeMatches(
  ...lists: Array<readonly TextMatch[] | undefined>
): readonly TextMatch[] {
  const out: TextMatch[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const m of list) {
      if (
        Number.isFinite(m.start)
        && Number.isFinite(m.end)
        && m.end > m.start
        && m.start >= 0
      ) {
        out.push({ start: Math.trunc(m.start), end: Math.trunc(m.end) });
      }
    }
  }
  return Object.freeze(out);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
