/**
 * 将 HTML 转为纯文本（无回溯密集正则，供 CodeQL / SSRF 工具链使用）。
 */
import { readableLinkTarget, decodeReadableEntities as decodeCommonEntities } from './readable-link.js';

const DEFAULT_MAX_INPUT = 2 * 1024 * 1024;

const BLOCK_TAGS = ['script', 'style', 'svg', 'nav', 'footer', 'header', 'form'] as const;

function findTagClose(html: string, from: number): number {
  const gt = html.indexOf('>', from);
  return gt === -1 ? -1 : gt + 1;
}

/** 移除成对块级标签及其内容（线性扫描） */
function removeBalancedBlocks(html: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const openLen = open.length;
  const closeLen = close.length;
  let out = '';
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    const start = lower.indexOf(open, i);
    if (start === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, start);
    const afterOpen = findTagClose(html, start + openLen);
    if (afterOpen === -1) {
      out += html.slice(start);
      break;
    }
    const end = lower.indexOf(close, afterOpen);
    if (end === -1) {
      out += html.slice(start);
      break;
    }
    i = end + closeLen;
  }
  return out;
}

/** 移除 HTML 注释 */
function removeHtmlComments(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<!--', i);
    if (start === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, start);
    const end = html.indexOf('-->', start + 4);
    if (end === -1) {
      out += html.slice(start);
      break;
    }
    i = end + 3;
  }
  return out;
}

/** 将剩余标签替换为空格（线性） */
function stripRemainingTags(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    out += ' ';
    i = gt + 1;
  }
  return out;
}

export type HtmlToPlainTextOptions = {
  maxInputLength?: number;
};

/**
 * HTML → 纯文本：先剥离 script/style 等块，再去标签与实体。
 */
export function htmlToPlainText(html: string, options?: HtmlToPlainTextOptions): string {
  const maxLen = options?.maxInputLength ?? DEFAULT_MAX_INPUT;
  let work = html.length > maxLen ? html.slice(0, maxLen) : html;

  for (const tag of BLOCK_TAGS) {
    work = removeBalancedBlocks(work, tag);
  }
  work = removeHtmlComments(work);
  work = stripRemainingTags(work);
  work = decodeCommonEntities(work);
  return work.replace(/\s+/g, ' ').trim();
}

/** 邮件等场景：块级结束标签换行后再剥离标签（保留换行） */
export function htmlToPlainTextWithBlockBreaks(html: string, options?: HtmlToPlainTextOptions): string {
  const maxLen = options?.maxInputLength ?? DEFAULT_MAX_INPUT;
  let work = html.length > maxLen ? html.slice(0, maxLen) : html;
  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');
  for (const tag of BLOCK_TAGS) {
    work = removeBalancedBlocks(work, tag);
  }
  work = removeHtmlComments(work);
  work = stripRemainingTags(work);
  work = decodeCommonEntities(work);
  return work
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * HTML 卡片出站回退：块级换行 + 语义标题轻量 markdown 前缀。
 */
export function htmlToFallbackText(html: string, options?: HtmlToPlainTextOptions): string {
  const maxLen = options?.maxInputLength ?? DEFAULT_MAX_INPUT;
  let work = html.length > maxLen ? html.slice(0, maxLen) : html;
  for (const tag of BLOCK_TAGS) {
    work = removeBalancedBlocks(work, tag);
  }
  work = removeHtmlComments(work);
  const out: string[] = [];
  const lists: Array<{ ordered: boolean; next: number }> = [];
  let anchor: { target: string; start: number } | undefined;
  let cells = 0;
  let pre = false;
  for (let i = 0; i < work.length;) {
    if (work[i] !== '<') {
      const next = work.indexOf('<', i);
      const text = decodeCommonEntities(work.slice(i, next === -1 ? work.length : next));
      out.push(pre ? text : text.replace(/\s+/gu, ' '));
      i = next === -1 ? work.length : next; continue;
    }
    // Respect quoted attributes, so href/title values may contain '>'.
    let end = i + 1;
    let quote = '';
    for (; end < work.length; end++) {
      const character = work[end]!;
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === work.length) break;
    const token = work.slice(i + 1, end);
    const match = /^\s*(\/?)\s*([a-z][\w:-]*)/iu.exec(token);
    i = end + 1;
    if (!match) continue;
    const closing = match[1] === '/';
    const tag = match[2]!.toLowerCase();
    if (tag === 'a') {
      if (closing) {
        if (anchor) {
          const label = out.slice(anchor.start).join('').trim();
          if (label !== anchor.target) out.push(label ? ` (${anchor.target})` : anchor.target);
        }
        anchor = undefined;
      } else {
        const target = readableLinkTarget(decodeCommonEntities(readHtmlAttribute(token, 'href') ?? ''));
        anchor = target ? { target, start: out.length } : undefined;
      }
    } else if (tag === 'img' && !closing) {
      const alt = decodeCommonEntities(readHtmlAttribute(token, 'alt') ?? '').trim();
      out.push(alt ? `[图片：${alt}]` : '[图片]');
    } else if (tag === 'ul' || tag === 'ol') {
      if (closing) { lists.pop(); out.push('\n'); }
      else {
        const start = Number(readHtmlAttribute(token, 'start'));
        lists.push({ ordered: tag === 'ol', next: Number.isSafeInteger(start) && start > 0 ? start : 1 });
      }
    } else if (tag === 'li') {
      if (closing) out.push('\n');
      else {
        const list = lists.at(-1);
        out.push(`\n${'  '.repeat(Math.min(32, Math.max(0, lists.length - 1)))}${list?.ordered ? `${list.next++}.` : '-'} `);
      }
    } else if (tag === 'tr') { cells = 0; out.push('\n'); }
    else if ((tag === 'td' || tag === 'th') && !closing) { if (cells++) out.push(' | '); }
    else if (tag === 'pre') { pre = !closing; out.push('\n'); }
    else if (tag === 'br' || tag === 'hr') out.push('\n');
    else if (/^h[1-6]$/u.test(tag)) out.push(closing ? '\n\n' : `\n${'#'.repeat(Number(tag[1]))} `);
    else if (['p', 'div', 'section', 'article', 'table', 'blockquote'].includes(tag)) {
      if (closing) out.push(tag === 'p' ? '\n\n' : '\n');
    }
  }
  return out.join('').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
    + (html.length > maxLen ? '\n\n[内容过长，已省略后续内容；请缩小查询范围或分页查看。]' : '');
}

/** Linear attribute scan, independent of attribute length and quote characters. */
function readHtmlAttribute(token: string, requested: string): string | undefined {
  let i = token.search(/\s/u);
  if (i < 0) return undefined;
  while (i < token.length) {
    while (i < token.length && /[\s/]/u.test(token[i]!)) i++;
    const start = i;
    while (i < token.length && !/[\s=/>]/u.test(token[i]!)) i++;
    const name = token.slice(start, i).toLowerCase();
    while (i < token.length && /\s/u.test(token[i]!)) i++;
    if (token[i] !== '=') { if (i === start) i++; continue; }
    i++;
    while (i < token.length && /\s/u.test(token[i]!)) i++;
    const quote = token[i] === '"' || token[i] === "'" ? token[i++] : undefined;
    const valueStart = i;
    while (i < token.length && (quote ? token[i] !== quote : !/[\s>]/u.test(token[i]!))) i++;
    const value = token.slice(valueStart, i);
    if (quote) i++;
    if (name === requested) return value;
  }
  return undefined;
}
