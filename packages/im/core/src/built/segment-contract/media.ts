import type { MediaRef } from './types.js';
import { isMediaRef } from './validate.js';

export { isMediaRef };
export function mediaRefFromLegacyData(data: Record<string, unknown>): MediaRef | undefined {
  if (isMediaRef(data.media)) {
    return data.media;
  }

  const mimeType = typeof data.mime_type === 'string' ? data.mime_type : undefined;

  const base64 =
    typeof data.base64 === 'string' && data.base64.trim()
      ? data.base64.trim()
      : typeof data.data === 'string' && data.data.trim() && !String(data.data).startsWith('http')
        ? data.data.trim()
        : undefined;
  if (base64) {
    return { kind: 'base64', value: base64, ...(mimeType ? { mime_type: mimeType } : {}) };
  }

  const raw = [data.url, data.file, data.src, data.href]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!raw) return undefined;

  const value = raw.trim();
  if (value.startsWith('base64://')) {
    return { kind: 'base64', value: value.slice('base64://'.length), ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { kind: 'url', value, ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) {
    return { kind: 'path', value, ...(mimeType ? { mime_type: mimeType } : {}) };
  }
  return { kind: 'url', value, ...(mimeType ? { mime_type: mimeType } : {}) };
}

export function mediaRefToLegacyFields(media: MediaRef): { url?: string; file?: string } {
  if (media.kind === 'url') return { url: media.value, file: media.value };
  if (media.kind === 'path') return { file: media.value, url: media.value };
  const encoded = media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  return { file: encoded, url: encoded };
}
