/**
 * @zhin.js/ai - Multi-modal Output Pipeline
 *
 * 统一输出类型系统：AI 回复 → OutputElement[] → Adapter 渲染
 *
 * 支持的输出类型:
 *   - text:  纯文本 / markdown
 *   - image: 图片 URL 或 base64
 *   - audio: 音频 URL 或 base64
 *   - video: 视频 URL
 *   - card:  结构化卡片 (标题 + 正文 + 字段 + 按钮)
 *   - file:  文件附件
 */

// ============================================================================
// OutputElement 类型定义
// ============================================================================

export interface TextElement {
  type: 'text';
  content: string;
  /** markdown / plain */
  format?: 'markdown' | 'plain';
}

export interface ImageElement {
  type: 'image';
  url: string;
  /** base64 数据 (url 不可用时的后备) */
  base64?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface AudioElement {
  type: 'audio';
  url: string;
  base64?: string;
  duration?: number;
  /** 语音转文字的后备文本 */
  fallbackText?: string;
}

export interface VideoElement {
  type: 'video';
  url: string;
  /** base64 载荷（出站优先；url 可为空或 data URI） */
  base64?: string;
  mimeType?: string;
  coverUrl?: string;
  duration?: number;
  fallbackText?: string;
}

export interface CardField {
  label: string;
  value: string;
  inline?: boolean;
}

export interface CardButton {
  text: string;
  /** 点击后发送的命令 */
  command?: string;
  /** 点击后打开的 URL */
  url?: string;
}

export interface CardElement {
  type: 'card';
  title: string;
  description?: string;
  fields?: CardField[];
  imageUrl?: string;
  buttons?: CardButton[];
  color?: string;
}

export interface FileElement {
  type: 'file';
  url: string;
  name: string;
  size?: number;
  mimeType?: string;
}

export type OutputElement =
  | TextElement
  | ImageElement
  | AudioElement
  | VideoElement
  | CardElement
  | FileElement;

// ============================================================================
// 输出解析器 — 将 AI 原始回复转换为 OutputElement[]
// ============================================================================

/**
 * 从 AI 回复文本中解析出结构化的 OutputElement[]
 *
 * 识别规则:
 *   - ![alt](url)            → ImageElement
 *   - [audio](url)           → AudioElement
 *   - [video](url)           → VideoElement
 *   - ```card ... ```        → CardElement (JSON)
 *   - [file:name](url)       → FileElement
 *   - 其余文本               → TextElement
 */
export function parseOutput(raw: string): OutputElement[] {
  if (!raw || !raw.trim()) return [{ type: 'text', content: '', format: 'plain' }];

  const elements: OutputElement[] = [];
  let remaining = raw;

   
  while (remaining.length > 0) {
    const next = findNextOutputToken(remaining);
    if (!next) {
      elements.push({ type: 'text', content: remaining.trim(), format: 'markdown' });
      break;
    }

    if (next.prefix.trim()) {
      elements.push({ type: 'text', content: next.prefix.trim(), format: 'markdown' });
    }

    if (next.kind === 'card') {
      try {
        const cardData = JSON.parse(next.body);
        elements.push({ ...cardData, type: 'card' });
      } catch {
        elements.push({ type: 'text', content: next.body, format: 'plain' });
      }
    } else if (next.kind === 'image') {
      elements.push({ type: 'image', url: next.url, alt: next.label || undefined });
    } else if (next.kind === 'audio') {
      elements.push({ type: 'audio', url: next.url });
    } else if (next.kind === 'video') {
      elements.push({ type: 'video', url: next.url });
    } else {
      elements.push({ type: 'file', url: next.url, name: next.label });
    }
    remaining = remaining.slice(next.end);
  }

  return elements.length > 0 ? elements : [{ type: 'text', content: raw, format: 'plain' }];
}

type OutputToken =
  | { kind: 'card'; prefix: string; body: string; end: number }
  | { kind: 'image' | 'audio' | 'video' | 'file'; prefix: string; label: string; url: string; end: number };

function findNextOutputToken(text: string): OutputToken | null {
  const candidates = [
    parseCardToken(text),
    parseMarkdownToken(text, 'image'),
    parseMarkdownToken(text, 'audio'),
    parseMarkdownToken(text, 'video'),
    parseMarkdownToken(text, 'file'),
  ].filter((item): item is OutputToken & { start: number } => item !== null);
  candidates.sort((a, b) => a.start - b.start);
  const first = candidates[0];
  if (!first || first.prefix.length >= 500) return null;
  const { start: _start, ...token } = first;
  return token;
}

function parseCardToken(text: string): (OutputToken & { start: number }) | null {
  const marker = '```card';
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = text.indexOf('\n', start + marker.length);
  if (bodyStart < 0) return null;
  const endMarker = text.indexOf('```', bodyStart + 1);
  if (endMarker < 0) return null;
  return {
    kind: 'card',
    start,
    prefix: text.slice(0, start),
    body: text.slice(bodyStart + 1, endMarker),
    end: endMarker + 3,
  };
}

function parseMarkdownToken(
  text: string,
  kind: 'image' | 'audio' | 'video' | 'file',
): (OutputToken & { start: number }) | null {
  const marker = kind === 'image' ? '![' : kind === 'file' ? '[file:' : `[${kind}](`;
  const start = text.toLowerCase().indexOf(marker);
  if (start < 0) return null;
  if (kind === 'audio' || kind === 'video') {
    const urlStart = start + marker.length;
    const urlEnd = text.indexOf(')', urlStart);
    if (urlEnd < 0) return null;
    return { kind, start, prefix: text.slice(0, start), label: kind, url: text.slice(urlStart, urlEnd), end: urlEnd + 1 };
  }
  const labelStart = start + marker.length;
  const labelEnd = text.indexOf(']', labelStart);
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
  const urlEnd = text.indexOf(')', labelEnd + 2);
  if (urlEnd < 0) return null;
  return {
    kind,
    start,
    prefix: text.slice(0, start),
    label: text.slice(labelStart, labelEnd),
    url: text.slice(labelEnd + 2, urlEnd),
    end: urlEnd + 1,
  };
}

// ============================================================================
// OutputElement 渲染工具
// ============================================================================

/**
 * 将 OutputElement[] 降级为纯文本（用于不支持富媒体的平台）
 */
export function renderToPlainText(elements: OutputElement[]): string {
  return elements.map(el => {
    switch (el.type) {
      case 'text':
        return el.content;
      case 'image':
        return el.alt ? `[图片: ${el.alt}]` : `[图片: ${el.url}]`;
      case 'audio':
        return el.fallbackText || `[音频: ${el.url}]`;
      case 'video':
        return el.fallbackText || `[视频: ${el.url}]`;
      case 'card': {
        const parts = [el.title];
        if (el.description) parts.push(el.description);
        if (el.fields?.length) {
          for (const f of el.fields) parts.push(`${f.label}: ${f.value}`);
        }
        return parts.join('\n');
      }
      case 'file':
        return `[文件: ${el.name}] ${el.url}`;
      default:
        return '';
    }
  }).filter(Boolean).join('\n');
}

/**
 * 将 OutputElement[] 渲染为 Satori 兼容的 HTML 片段
 */
export function renderToSatori(elements: OutputElement[]): string {
  return elements.map(el => {
    switch (el.type) {
      case 'text':
        return `<p>${escapeHtml(el.content)}</p>`;
      case 'image':
        return `<img src="${escapeHtml(el.url)}"${el.alt ? ` alt="${escapeHtml(el.alt)}"` : ''}/>`;
      case 'audio':
        return el.fallbackText
          ? `<p>${escapeHtml(el.fallbackText)}</p>`
          : `<audio src="${escapeHtml(el.url)}"/>`;
      case 'video':
        return el.fallbackText
          ? `<p>${escapeHtml(el.fallbackText)}</p>`
          : `<video src="${escapeHtml(el.url)}"/>`;
      case 'card': {
        let html = `<div class="card">`;
        html += `<h3>${escapeHtml(el.title)}</h3>`;
        if (el.description) html += `<p>${escapeHtml(el.description)}</p>`;
        if (el.imageUrl) html += `<img src="${escapeHtml(el.imageUrl)}"/>`;
        if (el.fields?.length) {
          for (const f of el.fields) {
            html += `<p><b>${escapeHtml(f.label)}</b>: ${escapeHtml(f.value)}</p>`;
          }
        }
        html += `</div>`;
        return html;
      }
      case 'file':
        return `<a href="${escapeHtml(el.url)}">${escapeHtml(el.name)}</a>`;
      default:
        return '';
    }
  }).filter(Boolean).join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
