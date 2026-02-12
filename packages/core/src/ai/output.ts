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

  // eslint-disable-next-line no-constant-condition
  while (remaining.length > 0) {
    // ── 尝试匹配 card 代码块 ──
    const cardMatch = remaining.match(/^([\s\S]*?)```card\s*\n([\s\S]*?)```/);
    if (cardMatch) {
      // 前缀文本
      if (cardMatch[1].trim()) {
        elements.push({ type: 'text', content: cardMatch[1].trim(), format: 'markdown' });
      }
      // 解析卡片 JSON
      try {
        const cardData = JSON.parse(cardMatch[2]);
        elements.push({ type: 'card', ...cardData });
      } catch {
        elements.push({ type: 'text', content: cardMatch[2], format: 'plain' });
      }
      remaining = remaining.slice(cardMatch[0].length);
      continue;
    }

    // ── 尝试匹配 image: ![alt](url) ──
    const imgMatch = remaining.match(/^([\s\S]*?)!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch && imgMatch[1].length < 500) {
      if (imgMatch[1].trim()) {
        elements.push({ type: 'text', content: imgMatch[1].trim(), format: 'markdown' });
      }
      elements.push({ type: 'image', url: imgMatch[3], alt: imgMatch[2] || undefined });
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // ── 尝试匹配 audio: [audio](url) ──
    const audioMatch = remaining.match(/^([\s\S]*?)\[audio\]\(([^)]+)\)/i);
    if (audioMatch && audioMatch[1].length < 500) {
      if (audioMatch[1].trim()) {
        elements.push({ type: 'text', content: audioMatch[1].trim(), format: 'markdown' });
      }
      elements.push({ type: 'audio', url: audioMatch[2] });
      remaining = remaining.slice(audioMatch[0].length);
      continue;
    }

    // ── 尝试匹配 video: [video](url) ──
    const videoMatch = remaining.match(/^([\s\S]*?)\[video\]\(([^)]+)\)/i);
    if (videoMatch && videoMatch[1].length < 500) {
      if (videoMatch[1].trim()) {
        elements.push({ type: 'text', content: videoMatch[1].trim(), format: 'markdown' });
      }
      elements.push({ type: 'video', url: videoMatch[2] });
      remaining = remaining.slice(videoMatch[0].length);
      continue;
    }

    // ── 尝试匹配 file: [file:name](url) ──
    const fileMatch = remaining.match(/^([\s\S]*?)\[file:([^\]]+)\]\(([^)]+)\)/i);
    if (fileMatch && fileMatch[1].length < 500) {
      if (fileMatch[1].trim()) {
        elements.push({ type: 'text', content: fileMatch[1].trim(), format: 'markdown' });
      }
      elements.push({ type: 'file', url: fileMatch[3], name: fileMatch[2] });
      remaining = remaining.slice(fileMatch[0].length);
      continue;
    }

    // ── 无匹配 → 全部作为文本 ──
    elements.push({ type: 'text', content: remaining.trim(), format: 'markdown' });
    break;
  }

  return elements.length > 0 ? elements : [{ type: 'text', content: raw, format: 'plain' }];
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
