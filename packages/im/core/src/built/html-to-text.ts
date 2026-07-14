/**
 * 将 HTML 转为纯文本（无回溯密集正则，供 CodeQL / SSRF 工具链使用）。
 */

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

function decodeCommonEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity: string) => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key === 'nbsp') return ' ';
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    const n = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
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
  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<h4[^>]*>/gi, '\n#### ')
    .replace(/<h5[^>]*>/gi, '\n##### ')
    .replace(/<h6[^>]*>/gi, '\n###### ')
    .replace(/<li[^>]*>/gi, '\n- ')
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
