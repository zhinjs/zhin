/**
 * HTML → SVG：html-react-parser + 官方 satori（需安装 react，与 html-react-parser 一致）。
 */
import parse from 'html-react-parser';
import { Fragment as FragmentSymbol } from 'react';
import satori from 'satori';

/** Satori font entry（与官方 satori 一致） */
export interface SatoriFont {
  name: string;
  data: ArrayBuffer | Buffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: 'normal' | 'italic';
}

export interface HtmlToSvgOptions {
  width: number;
  height?: number;
  fonts: SatoriFont[];
  embedFont?: boolean;
  debug?: boolean;
  graphemeImages?: Record<string, string>;
  loadAdditionalAsset?: (languageCode: string, segment: string) => Promise<string | SatoriFont[]>;
  pointScaleFactor?: number;
}

function styleStringToObject(styleStr: string): Record<string, string | number> {
  if (!styleStr || typeof styleStr !== 'string') return {};
  const out: Record<string, string | number> = {};
  for (const part of styleStr.split(';').filter(Boolean)) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim().replace(/-([a-z])/gi, (_, c: string) => c.toUpperCase());
    const value = part.slice(colon + 1).trim();
    if (key && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 将不被 satori 支持的 CSS 属性转换为 flexbox 等价写法。
 * satori 基于 Yoga 布局引擎，只支持 flexbox，不支持 block/inline/grid/table 等。
 */
function patchStyleForSatori(style: Record<string, unknown>): Record<string, unknown> {
  const display = style.display as string | undefined;
  if (display) {
    switch (display) {
      // block → flex column + 占满父级宽度（浏览器 block 默认 width:100%）
      case 'block':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'column';
        if (!style.width) style.width = '100%';
        break;
      // inline → 行内元素：不独占一行，内容撑开宽度，允许换行
      case 'inline':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'row';
        if (!style.flexWrap) style.flexWrap = 'wrap';
        if (!style.alignItems) style.alignItems = 'baseline';
        break;
      // inline-block → 行内块：像 inline 一样流式排列，但可设置宽高
      case 'inline-block':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'row';
        if (!style.flexWrap) style.flexWrap = 'wrap';
        break;
      // inline-flex → flex（satori 不区分 inline-flex）
      case 'inline-flex':
        style.display = 'flex';
        break;
      // grid → flex 近似：行方向换行排列，模拟网格效果
      case 'grid':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'row';
        if (!style.flexWrap) style.flexWrap = 'wrap';
        break;
      // table → flex column，table-row → flex row，table-cell → flex item
      case 'table':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'column';
        if (!style.width) style.width = '100%';
        break;
      case 'table-row':
      case 'table-header-group':
      case 'table-footer-group':
      case 'table-row-group':
        style.display = 'flex';
        if (!style.flexDirection) style.flexDirection = 'row';
        break;
      case 'table-cell':
        style.display = 'flex';
        if (!style.flex) style.flex = '1';
        break;
      // none 保持不变（satori 支持）
      case 'none':
      case 'flex':
        break;
      // 其他未知值降级为 flex
      default:
        style.display = 'flex';
        break;
    }
  }

  // grid 布局属性 → flex 近似映射
  if (style.gridTemplateColumns) {
    // grid columns → flex row + wrap
    if (!style.flexWrap) style.flexWrap = 'wrap';
    if (!style.flexDirection) style.flexDirection = 'row';
    delete style.gridTemplateColumns;
  }
  if (style.gridTemplateRows) delete style.gridTemplateRows;
  if (style.gridColumn) delete style.gridColumn;
  if (style.gridRow) delete style.gridRow;
  if (style.gridArea) delete style.gridArea;
  if (style.gridGap) {
    if (!style.gap) style.gap = style.gridGap;
    delete style.gridGap;
  }
  if (style.gridColumnGap) {
    if (!style.columnGap) style.columnGap = style.gridColumnGap;
    delete style.gridColumnGap;
  }
  if (style.gridRowGap) {
    if (!style.rowGap) style.rowGap = style.gridRowGap;
    delete style.gridRowGap;
  }

  // position: fixed/sticky → absolute（satori 不支持 fixed/sticky）
  const position = style.position as string | undefined;
  if (position === 'fixed' || position === 'sticky') {
    style.position = 'absolute';
  }

  // float → 移除（satori 不支持 float）
  if (style.float) {
    const floatVal = style.float as string;
    delete style.float;
    delete style.clear;
    // 尝试用 alignSelf 模拟
    if (floatVal === 'right' && !style.alignSelf) {
      style.alignSelf = 'flex-end';
      if (!style.marginLeft) style.marginLeft = 'auto';
    }
  }

  // visibility → display:none（satori 不支持 visibility，用 display 替代）
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    style.display = 'none';
    delete style.visibility;
  } else if (style.visibility) {
    delete style.visibility;
  }

  // vertical-align → alignSelf 近似（仅处理常见值）
  if (style.verticalAlign) {
    const va = style.verticalAlign as string;
    if (!style.alignSelf) {
      if (va === 'top') style.alignSelf = 'flex-start';
      else if (va === 'bottom') style.alignSelf = 'flex-end';
      else if (va === 'middle') style.alignSelf = 'center';
    }
    delete style.verticalAlign;
  }

  // 移除 satori 不支持的纯交互/动画属性
  const unsupportedProps = [
    'animation', 'animationName', 'animationDuration', 'animationDelay',
    'animationTimingFunction', 'animationIterationCount', 'animationFillMode',
    'transition', 'transitionProperty', 'transitionDuration', 'transitionDelay',
    'cursor', 'pointerEvents', 'userSelect',
    'filter', 'backdropFilter',
    'clear', 'textIndent',
  ];
  for (const prop of unsupportedProps) {
    if (prop in style) delete style[prop];
  }

  return style;
}

type SatoriElement = {
  type: string | symbol | ((props: unknown) => unknown);
  props: Record<string, unknown>;
};

type TransformedNode = SatoriElement | string | number | null | TransformedNode[];

function isElementStub(node: unknown): node is { type: unknown; props: Record<string, unknown> } {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    'props' in node &&
    typeof (node as { props: unknown }).props === 'object' &&
    (node as { props: object | null }).props !== null
  );
}

/**
 * 需要特殊处理的 HTML 标签 → satori 兼容映射。
 * satori 原生支持: div, span, p, a, b, strong, i, em, u, s, del, code, pre,
 *                  h1-h6, br, hr, img, svg, ul, ol, li
 * 以下仅映射 satori **不支持** 的标签。
 */
const TAG_REMAP: Record<string, { tag: string; style?: Record<string, string> }> = {
  // table 系列 → div + flex 行列布局
  table: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  thead: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  tbody: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  tfoot: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  tr: { tag: 'div', style: { display: 'flex', flexDirection: 'row', width: '100%' } },
  th: { tag: 'div', style: { display: 'flex', flex: '1', fontWeight: '700', padding: '8px', alignItems: 'center' } },
  td: { tag: 'div', style: { display: 'flex', flex: '1', padding: '8px', alignItems: 'center' } },
  caption: { tag: 'div', style: { display: 'flex', justifyContent: 'center', padding: '4px', fontWeight: '700' } },
  colgroup: { tag: 'div', style: { display: 'none' } },
  col: { tag: 'div', style: { display: 'none' } },
  // 定义列表
  dl: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  dt: { tag: 'div', style: { display: 'flex', fontWeight: '700' } },
  dd: { tag: 'div', style: { display: 'flex', marginLeft: '40px' } },
  // HTML5 语义标签 → div（保持 block 行为）
  section: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  article: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  aside: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  nav: { tag: 'div', style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' } },
  header: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  footer: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  main: { tag: 'div', style: { display: 'flex', flexDirection: 'column', width: '100%' } },
  // 图文、引用
  figure: { tag: 'div', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '16px 40px' } },
  figcaption: { tag: 'div', style: { display: 'flex', fontSize: '14px', color: '#666', justifyContent: 'center' } },
  blockquote: { tag: 'div', style: { display: 'flex', flexDirection: 'column', borderLeft: '3px solid #ccc', paddingLeft: '12px', margin: '16px 0' } },
  // 表单类（渲染为静态占位）
  form: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  fieldset: { tag: 'div', style: { display: 'flex', flexDirection: 'column', border: '1px solid #ccc', padding: '8px', margin: '8px 0' } },
  legend: { tag: 'div', style: { display: 'flex', fontWeight: '700', padding: '0 4px' } },
  // 其他
  details: { tag: 'div', style: { display: 'flex', flexDirection: 'column' } },
  summary: { tag: 'div', style: { display: 'flex', fontWeight: '700', cursor: 'pointer' } },
  address: { tag: 'div', style: { display: 'flex', flexDirection: 'column', fontStyle: 'italic' } },
};

/** 将 html-react-parser 产出的节点转为 satori 可用的树（style 字符串 → 对象等） */
function transformNode(node: unknown): TransformedNode {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) {
    return node.map(transformNode).filter((n) => n != null) as TransformedNode[];
  }
  if (!isElementStub(node)) return null;

  const { type, props } = node;

  if (type === FragmentSymbol) {
    const ch = props.children;
    const list = Array.isArray(ch) ? ch : ch != null ? [ch] : [];
    const mapped = list.map(transformNode).flatMap((n) => (Array.isArray(n) ? n : [n]));
    return mapped.filter((x) => x != null) as TransformedNode[];
  }

  const newProps: Record<string, unknown> = { ...props };

  // 标签映射：将不支持的 HTML 标签转换为 div + 等价 flex 样式
  let resolvedType = type;
  if (typeof type === 'string' && type in TAG_REMAP) {
    const remap = TAG_REMAP[type];
    resolvedType = remap.tag;
    if (remap.style) {
      const existingStyle = typeof newProps.style === 'string'
        ? styleStringToObject(newProps.style)
        : typeof newProps.style === 'object' && newProps.style !== null
          ? { ...newProps.style as Record<string, unknown> }
          : {};
      // remap 样式作为默认值，用户显式样式优先
      newProps.style = patchStyleForSatori({ ...remap.style, ...existingStyle });
    } else if (typeof newProps.style === 'string') {
      newProps.style = patchStyleForSatori(styleStringToObject(newProps.style));
    } else if (typeof newProps.style === 'object' && newProps.style !== null) {
      newProps.style = patchStyleForSatori({ ...newProps.style as Record<string, unknown> });
    }
  } else if (typeof props.style === 'string') {
    newProps.style = patchStyleForSatori(styleStringToObject(props.style));
  } else if (typeof props.style === 'object' && props.style !== null) {
    newProps.style = patchStyleForSatori({ ...props.style as Record<string, unknown> });
  }

  if (props.children !== undefined && props.children !== null) {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    const next = children.map(transformNode).flatMap((n) => (Array.isArray(n) ? n : [n]));
    const filtered = next.filter((x) => x != null) as Exclude<TransformedNode, null>[];
    if (filtered.length === 0) delete newProps.children;
    else if (filtered.length === 1) newProps.children = filtered[0];
    else newProps.children = filtered;
  }

  return { type: resolvedType, props: newProps } as SatoriElement;
}

function normalizeRoot(parsed: unknown): SatoriElement {
  const t = transformNode(parsed);
  if (t == null) {
    return { type: 'div', props: {} };
  }
  if (Array.isArray(t)) {
    const parts = t.filter((x) => x != null) as Exclude<TransformedNode, null>[];
    if (parts.length === 0) return { type: 'div', props: {} };
    if (parts.length === 1 && typeof parts[0] === 'object' && parts[0] !== null && 'type' in parts[0]) {
      return parts[0] as SatoriElement;
    }
    return {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' },
        children: parts,
      },
    };
  }
  if (typeof t === 'object' && t !== null && 'type' in t && 'props' in t) {
    return t as SatoriElement;
  }
  return {
    type: 'div',
    props: { children: t as string | number },
  };
}

/**
 * 危险 HTML 标签名（小写）——在传入 html-react-parser 之前移除。
 * 这些标签可执行脚本、嵌入外部资源或引入 XSS 向量。
 */
const DANGEROUS_TAGS = [
  'script', 'iframe', 'object', 'embed', 'applet',
  'form', 'input', 'textarea', 'button', 'select',
  'link', 'meta', 'base', 'noscript',
];

/** 预编译：带内容的危险标签（如 <script>...</script>） */
const DANGEROUS_TAG_PAIR_RES = DANGEROUS_TAGS.map(
  tag => new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'),
);

/** 自闭合或未闭合的危险标签 */
const DANGEROUS_TAG_RE = new RegExp(
  `<\\/?\\s*(${DANGEROUS_TAGS.join('|')})[^>]*>`,
  'gi',
);

/** 匹配 on* 事件处理属性，如 onclick="..." onLoad='...' ONERROR=xxx（gi 标志处理大小写） */
const EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * 匹配 href / src / action 等 URI 属性（引号值写法），用于 javascript: 检测。
 * 捕获组 1 = 属性前缀（含引号），捕获组 2 = 属性值（引号内内容）。
 */
const URI_ATTR_QUOTED_RE = /(\s+(?:href|src|action|formaction|data|xlink:href)\s*=\s*["'])([^"']*)/gi;
const JS_PROTOCOL_UNQUOTED_RE = /(\s+(?:href|src|action|formaction|data|xlink:href)\s*=\s*)(?:javascript|vbscript):/gi;

/** 解码 HTML 数字实体（&#NNN; 和 &#xHH;），用于检测混淆后的 javascript: URI */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * 从 HTML 字符串中移除危险内容，防止 XSS。
 * 移除：危险标签（含内容）、on* 事件处理属性、javascript: URI。
 */
export function sanitizeHtml(html: string): string {
  let result = html;

  // 移除带内容的危险标签（如 <script>...</script>）
  for (const re of DANGEROUS_TAG_PAIR_RES) {
    re.lastIndex = 0;
    result = result.replace(re, '');
  }

  // 移除自闭合或未闭合的危险标签
  result = result.replace(DANGEROUS_TAG_RE, '');

  // 移除事件处理属性（循环直到没有更多匹配，防止嵌套如 ononclick）
  let prev: string;
  let maxIterations = 10;
  do {
    prev = result;
    result = result.replace(EVENT_HANDLER_RE, '');
  } while (result !== prev && --maxIterations > 0);

  // 将危险 URI 协议替换为安全值（引号写法，含 HTML 实体混淆检测）
  result = result.replace(URI_ATTR_QUOTED_RE, (match, prefix: string, value: string) => {
    const decoded = decodeHtmlEntities(value).replace(/\s+/g, '').toLowerCase();
    if (decoded.startsWith('javascript:') || decoded.startsWith('vbscript:')) {
      return `${prefix}about:invalid`;
    }
    // Block data: URIs except safe media types (image/*, font/*)
    if (decoded.startsWith('data:') && !decoded.startsWith('data:image/') && !decoded.startsWith('data:font/')) {
      return `${prefix}about:invalid`;
    }
    return match;
  });

  // 将危险 URI 协议替换为安全值（无引号写法）
  result = result.replace(JS_PROTOCOL_UNQUOTED_RE, '$1"about:invalid"');

  return result;
}

export async function htmlToSvg(html: string, options: HtmlToSvgOptions): Promise<string> {
  const sanitized = sanitizeHtml(html);
  const parsed = parse(sanitized);
  const tree = normalizeRoot(parsed);
  return satori(tree as Parameters<typeof satori>[0], options as Parameters<typeof satori>[1]);
}
