import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OutputElement } from '@zhin.js/ai';
import { renderToPlainText } from '@zhin.js/ai';
import type { MessageElement } from '@zhin.js/core';
import type { OutboundMediaCapabilities } from './media-types.js';
import { resolveOutboundCapabilities } from './media-capabilities.js';
import { fetchUrlAsBase64 } from './media-normalize.js';
import type { MediaBinaryPayload } from './media-types.js';
import type { MediaKind } from './media-types.js';

/** 超过此长度的 base64 先落盘，避免出站 segment.toString→from 模板超 400KB */
const OUTBOUND_SPOOL_B64_CHARS = 32_000;

function extForMime(mime: string, kind: MediaKind): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
  };
  if (map[mime]) return map[mime];
  if (kind === 'audio') return '.mp3';
  if (kind === 'video') return '.mp4';
  if (kind === 'image') return '.png';
  return '.bin';
}

async function spoolBase64ToTempFile(
  base64: string,
  mimeType: string,
  kind: MediaKind,
): Promise<string> {
  const dir = path.join(os.tmpdir(), 'zhin-outbound-media');
  await fs.mkdir(dir, { recursive: true });
  const ext = extForMime(mimeType, kind);
  const filePath = path.join(dir, `${kind}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

async function readFileAsBase64(filePath: string, maxBytes: number): Promise<MediaBinaryPayload | null> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxBytes) return null;
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mime = 'application/octet-stream';
    let kind: MediaKind = 'file';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      kind = 'image';
      mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    } else if (['.mp3', '.wav', '.ogg'].includes(ext)) {
      kind = 'audio';
      mime = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
      kind = 'video';
      mime = 'video/mp4';
    }
    return { kind, base64: buf.toString('base64'), mimeType: mime, fileName: path.basename(filePath) };
  } catch {
    return null;
  }
}

async function elementToPayload(
  el: OutputElement,
  maxBytes: number,
): Promise<MediaBinaryPayload | null> {
  if (el.type === 'text') return null;

  if (el.type === 'image') {
    if (el.base64) {
      return { kind: 'image', base64: el.base64, mimeType: 'image/jpeg', meta: { alt: el.alt } };
    }
    if (el.url.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(el.url);
      if (m) return { kind: 'image', base64: m[2], mimeType: m[1], meta: { alt: el.alt } };
    }
    if (el.url && !el.url.startsWith('http')) {
      return readFileAsBase64(el.url, maxBytes);
    }
    if (el.url?.startsWith('http')) {
      return fetchUrlAsBase64(el.url, maxBytes);
    }
  }

  if (el.type === 'audio') {
    if (el.base64) {
      return { kind: 'audio', base64: el.base64, mimeType: 'audio/mpeg' };
    }
    if (el.url.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(el.url);
      if (m) return { kind: 'audio', base64: m[2], mimeType: m[1] };
    }
    if (el.url) return readFileAsBase64(el.url, maxBytes);
  }

  if (el.type === 'video') {
    if (el.base64) {
      return { kind: 'video', base64: el.base64, mimeType: 'video/mp4' };
    }
    if (el.url) return readFileAsBase64(el.url, maxBytes);
  }

  if (el.type === 'file' && el.url) {
    return readFileAsBase64(el.url, maxBytes);
  }

  return null;
}

async function payloadToMessageElement(
  payload: MediaBinaryPayload,
  caps: OutboundMediaCapabilities,
  platform?: string,
): Promise<MessageElement | null> {
  const max = caps.maxAttachmentBytes ?? 26_214_400;
  if (!payload.base64 || payload.base64.length === 0) {
    if (payload.kind === 'image' && caps.image) {
      return { type: 'text', data: { text: `[图片: ${payload.meta?.alt || 'image'}]` } };
    }
    return null;
  }
  const bytes = Math.floor((payload.base64.length * 3) / 4);
  if (bytes > max) {
    return { type: 'text', data: { text: `[附件过大 (${(bytes / 1024 / 1024).toFixed(1)} MB)，无法发送]` } };
  }

  /** icqq 常与守护进程异机；落盘路径对端不可读，保留 base64 由适配器编码为 CQ base64:// */
  const spool = payload.base64.length > OUTBOUND_SPOOL_B64_CHARS && platform !== 'icqq';
  const filePath = spool
    ? await spoolBase64ToTempFile(payload.base64, payload.mimeType, payload.kind)
    : undefined;

  switch (payload.kind) {
    case 'image':
      if (!caps.image) {
        return { type: 'text', data: { text: `[图片: ${payload.meta?.alt || 'image'}]` } };
      }
      if (filePath) {
        return {
          type: 'image',
          data: { file: filePath, url: filePath, mime: payload.mimeType },
        };
      }
      return {
        type: 'image',
        data: {
          base64: payload.base64,
          mime: payload.mimeType,
        },
      };
    case 'audio':
      if (!caps.audio) {
        return { type: 'text', data: { text: elAudioFallback(payload) } };
      }
      if (filePath) {
        return {
          type: 'record',
          data: {
            file: filePath,
            url: filePath,
            format: payload.mimeType.includes('wav') ? 'wav' : 'mp3',
            mime: payload.mimeType,
          },
        };
      }
      return {
        type: 'record',
        data: {
          base64: payload.base64,
          data: payload.base64,
          format: payload.mimeType.includes('wav') ? 'wav' : 'mp3',
          mime: payload.mimeType,
        },
      };
    case 'video':
      if (!caps.video) {
        return { type: 'text', data: { text: `[视频]` } };
      }
      if (filePath) {
        return {
          type: 'video',
          data: { file: filePath, url: filePath, mime: payload.mimeType },
        };
      }
      return {
        type: 'video',
        data: {
          base64: payload.base64,
          mime: payload.mimeType,
        },
      };
    case 'file':
      if (!caps.file) {
        return { type: 'text', data: { text: `📎 ${payload.fileName || 'file'}` } };
      }
      if (filePath) {
        return {
          type: 'file',
          data: {
            file: filePath,
            url: filePath,
            name: payload.fileName || 'file',
            mime: payload.mimeType,
          },
        };
      }
      return {
        type: 'file',
        data: {
          base64: payload.base64,
          name: payload.fileName || 'file',
          mime: payload.mimeType,
        },
      };
    default:
      return null;
  }
}

function elAudioFallback(payload: MediaBinaryPayload): string {
  return payload.meta?.alt ? `[语音: ${payload.meta.alt}]` : '[语音消息]';
}

function elementToTextSegment(el: OutputElement): MessageElement {
  if (el.type === 'text') {
    return { type: 'text', data: { text: el.content } };
  }
  if (el.type === 'card') {
    const lines = [`📋 ${el.title}`];
    if (el.description) lines.push(el.description);
    if (el.fields?.length) {
      for (const f of el.fields) lines.push(`  ${f.label}: ${f.value}`);
    }
    return { type: 'text', data: { text: lines.join('\n') } };
  }
  return { type: 'text', data: { text: renderToPlainText([el]) } };
}

/**
 * OutputElement[] → MessageElement[]（base64 契约，平台 adapter 决定如何发送）
 */
export async function publishOutboundElements(
  elements: OutputElement[],
  platform?: string,
  capsOverride?: OutboundMediaCapabilities,
): Promise<MessageElement[]> {
  const caps = capsOverride ?? resolveOutboundCapabilities(platform);
  const segments: MessageElement[] = [];

  for (const el of elements) {
    if (el.type === 'text' || el.type === 'card') {
      if (el.type === 'text' && !el.content?.trim()) continue;
      segments.push(elementToTextSegment(el));
      continue;
    }

    const payload = await elementToPayload(el, caps.maxAttachmentBytes ?? 26_214_400);
    if (!payload) {
      segments.push(elementToTextSegment(el));
      continue;
    }
    const seg = await payloadToMessageElement(payload, caps, platform);
    if (seg) segments.push(seg);
  }

  return segments;
}
