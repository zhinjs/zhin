import type { MessageElement, SendContent } from '../types.js';

const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** 从 message 段 data 提取 base64 Buffer（data: URL / base64:// / raw base64） */
export function extractBase64Buffer(data: Record<string, unknown>): Buffer | undefined {
  const url = typeof data.url === 'string' ? data.url : undefined;
  const file = typeof data.file === 'string' ? data.file : undefined;
  const base64 = typeof data.base64 === 'string' ? data.base64 : undefined;

  if (url?.startsWith('base64://')) {
    return Buffer.from(url.slice(9), 'base64');
  }
  if (url && /^data:[^/]+\/[^;]+;base64,/i.test(url)) {
    return Buffer.from(url.replace(/^data:[^/]+\/[^;]+;base64,/, ''), 'base64');
  }
  if (file?.startsWith('base64://')) {
    return Buffer.from(file.slice(9), 'base64');
  }
  if (base64) {
    const raw = base64.startsWith('base64://') ? base64.slice(9) : base64;
    return Buffer.from(raw, 'base64');
  }
  return undefined;
}

/** 解析本地文件路径（非 http(s) / base64） */
export function resolveLocalMediaPath(data: Record<string, unknown>): string | undefined {
  const url = typeof data.url === 'string' ? data.url : undefined;
  const file = typeof data.file === 'string' ? data.file : undefined;
  const candidate = file ?? url;
  if (!candidate || isRemoteUrl(candidate)) return undefined;
  if (candidate.startsWith('base64://') || /^data:/.test(candidate)) return undefined;
  if (candidate.startsWith('file://') || candidate.startsWith('/') || !candidate.includes('://')) {
    return candidate;
  }
  return undefined;
}

export function asMessageElements(content: SendContent): MessageElement[] {
  if (typeof content === 'string') {
    return [{ type: 'text', data: { text: content } }];
  }
  if (!Array.isArray(content)) {
    return [content];
  }
  return content.map((item) =>
    typeof item === 'string' ? { type: 'text', data: { text: item } } : item,
  );
}

export function isMediaSegmentType(type: string): boolean {
  return MEDIA_SEGMENT_TYPES.has(type);
}

export function collectOutboundMediaKinds(content: SendContent | undefined): string[] {
  if (content == null) return [];
  const kinds = new Set<string>();
  for (const item of asMessageElements(content)) {
    const t = item?.type;
    if (typeof t === 'string' && isMediaSegmentType(t)) {
      kinds.add(t);
    }
  }
  return [...kinds];
}
