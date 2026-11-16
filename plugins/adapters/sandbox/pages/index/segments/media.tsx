import React from 'react';
import { pickMediaRawUrl, resolveMediaSrc } from '@zhin.js/client';
import { Download, FileText } from 'lucide-react';
import { sandboxText } from '../messages.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

export const renderImage: SandboxSegmentRenderer = (data, { locale }, key) => {
  const src = resolveMediaSrc(pickMediaRawUrl(data as Record<string, unknown>), 'image');
  if (!src) return <span key={key} className="sandbox-segment-note">{sandboxText(locale, "[图片]")}</span>;
  const alt = stringField(data, 'alt');
  return (
    // resolveMediaSrc allowlists non-executable URL schemes and image data MIME types.
    // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
    <a key={key} href={src} target="_blank" rel="noreferrer" className="sandbox-media-link">
      {/* lgtm[js/xss,js/client-side-unvalidated-url-redirection] */}
      <img src={src} alt={alt} className="sandbox-media-image" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
    </a>
  );
};

export const renderVideo: SandboxSegmentRenderer = (data, { locale }, key) => {
  const src = resolveMediaSrc(pickMediaRawUrl(data as Record<string, unknown>), 'video');
  if (!src) return <span key={key} className="sandbox-segment-note">{sandboxText(locale, "[视频无地址]")}</span>;
  // resolveMediaSrc allowlists non-executable URL schemes and video data MIME types.
  // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
  return <video key={key} src={src} controls playsInline preload="metadata" className="sandbox-media-video" />;
};

/** `audio`, and the legacy `record` / `voice` aliases Core normalizes to it. */
export const renderAudio: SandboxSegmentRenderer = (data, { locale }, key) => {
  const src = resolveMediaSrc(pickMediaRawUrl(data as Record<string, unknown>), 'audio');
  if (!src) return <span key={key} className="sandbox-segment-note">{sandboxText(locale, "[音频无地址]")}</span>;
  // resolveMediaSrc allowlists non-executable URL schemes and audio data MIME types.
  // lgtm[js/xss,js/client-side-unvalidated-url-redirection]
  return <audio key={key} src={src} controls preload="metadata" className="sandbox-media-audio" />;
};

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/u;

/**
 * Download target of a `file` segment: http(s) URLs as they are, inline base64 (the Sandbox
 * endpoint materializes `path` media into it) as an `application/octet-stream` data URL so the
 * browser downloads it and never renders it. Platform-opaque references (`kind: file`) have none.
 */
export function sandboxFileHref(media: unknown): string | undefined {
  if (!media || typeof media !== 'object') return undefined;
  const { kind, value } = media as { kind?: unknown; value?: unknown };
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (kind === 'url') {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
  if (kind === 'base64') {
    const body = value.replace(/^data:[^,]*,/u, '').replace(/\s/gu, '');
    return BASE64_BODY.test(body) ? `data:application/octet-stream;base64,${body}` : undefined;
  }
  return undefined;
}

/** Human-readable byte size (`1.5 MB`), or `undefined` for a missing / invalid size. */
export function formatFileSize(size: unknown): string | undefined {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function fileNameOf(data: Readonly<Record<string, unknown>>, media: Record<string, unknown> | undefined): string {
  const name = stringField(data, 'name', 'file_name', 'fileName') || (typeof media?.file_name === 'string' ? media.file_name : '');
  if (name) return name;
  if (media?.kind === 'url' && typeof media.value === 'string') {
    try { return decodeURIComponent(new URL(media.value).pathname.split('/').filter(Boolean).at(-1) ?? '') || media.value; } catch { return media.value; }
  }
  return '';
}

/** ADR 0064 G6: a file card with name, size and a download link. */
export const renderFile: SandboxSegmentRenderer = (data, { locale }, key) => {
  const media = data.media && typeof data.media === 'object' ? data.media as Record<string, unknown> : undefined;
  const name = fileNameOf(data, media) || sandboxText(locale, "未命名文件");
  const size = formatFileSize(media?.size ?? data.size);
  const href = sandboxFileHref(media ?? (typeof data.url === 'string' ? { kind: 'url', value: data.url } : undefined));
  const mime = typeof media?.mime_type === 'string' ? media.mime_type : '';
  return (
    <div key={key} className="sandbox-file-card">
      <FileText size={20} aria-hidden="true" className="sandbox-file-card-icon" />
      <div className="sandbox-file-card-main">
        <div className="sandbox-file-card-name" title={name}>{name}</div>
        <div className="sandbox-file-card-meta">{[size, mime].filter(Boolean).join(' · ') || sandboxText(locale, "文件")}</div>
      </div>
      {href
        // sandboxFileHref only yields http(s) URLs or an octet-stream data URL (downloaded, never rendered).
        ? <a className="sandbox-file-card-download" href={href} download={name} target="_blank" rel="noreferrer"
          aria-label={sandboxText(locale, "下载 {0}", [name])}><Download size={16} aria-hidden="true" />{sandboxText(locale, "下载")}</a>
        : <span className="sandbox-file-card-meta">{sandboxText(locale, "平台文件引用，无法在此下载")}</span>}
    </div>
  );
};
