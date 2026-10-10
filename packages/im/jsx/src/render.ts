import { Fragment, isJsxElement, rawHtmlType, type JSXRenderable, type JSXProps } from './element.js';

export interface HtmlRenderOptions {
  /** Bounds recursive components and untrusted tree depth. Default: 100. */
  readonly maxDepth?: number;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple',
  'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);
const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  className: 'class', htmlFor: 'for', tabIndex: 'tabindex', readOnly: 'readonly',
  autoFocus: 'autofocus', autoPlay: 'autoplay', allowFullScreen: 'allowfullscreen',
  formNoValidate: 'formnovalidate', noValidate: 'novalidate', playsInline: 'playsinline',
  noModule: 'nomodule', itemScope: 'itemscope', isMap: 'ismap',
};
const SVG_ALIASES: Readonly<Record<string, string>> = {
  strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset', strokeOpacity: 'stroke-opacity',
  fillRule: 'fill-rule', fillOpacity: 'fill-opacity', clipRule: 'clip-rule', clipPath: 'clip-path',
  colorInterpolation: 'color-interpolation', colorInterpolationFilters: 'color-interpolation-filters',
  stopColor: 'stop-color', stopOpacity: 'stop-opacity', textAnchor: 'text-anchor',
  dominantBaseline: 'dominant-baseline', fontFamily: 'font-family', fontSize: 'font-size',
  fontWeight: 'font-weight', markerStart: 'marker-start', markerMid: 'marker-mid', markerEnd: 'marker-end',
  vectorEffect: 'vector-effect', xlinkHref: 'xlink:href', xmlnsXlink: 'xmlns:xlink',
};
const UNITLESS_STYLES = new Set([
  'animation-iteration-count', 'aspect-ratio', 'border-image-outset', 'border-image-slice',
  'border-image-width', 'box-flex', 'box-flex-group', 'box-ordinal-group', 'column-count',
  'columns', 'fill-opacity', 'flex', 'flex-grow', 'flex-shrink', 'font-weight', 'grid-area',
  'grid-column', 'grid-column-end', 'grid-column-start', 'grid-row', 'grid-row-end', 'grid-row-start',
  'line-clamp', 'line-height', 'opacity', 'order', 'orphans', 'scale', 'stop-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
  'tab-size', 'widows', 'z-index', 'zoom',
]);

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cssName(name: string): string {
  if (name.startsWith('--')) return name;
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith('ms-') ? `-${kebab}` : kebab;
}

function serializeStyle(value: unknown): string {
  if (value == null || value === false) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('JSX style must be a string or object');
  const declarations: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (item == null || item === false) continue;
    const name = cssName(key);
    if (!/^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/.test(name)) throw new TypeError(`Invalid JSX style property: ${key}`);
    if (typeof item !== 'string' && typeof item !== 'number') throw new TypeError(`Invalid JSX style value: ${key}`);
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError(`Invalid JSX style number: ${key}`);
    const baseName = name.replace(/^-(?:webkit|moz|ms|o)-/, '');
    const unit = typeof item === 'number' && item !== 0 && !name.startsWith('--') && !UNITLESS_STYLES.has(baseName) ? 'px' : '';
    declarations.push(`${name}: ${item}${unit}`);
  }
  return declarations.join('; ');
}

function serializeAttributes(props: JSXProps, svg: boolean): string {
  const attributes: string[] = [];
  const emitted = new Set<string>();
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key' || key === 'dangerouslySetInnerHTML' || value == null) continue;
    if (/^on/i.test(key)) throw new TypeError(`JSX event attributes are unsupported: ${key}`);
    const name = ATTRIBUTE_ALIASES[key] ?? (svg ? SVG_ALIASES[key] : undefined) ?? key;
    if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) throw new TypeError(`Invalid JSX attribute: ${key}`);
    if (emitted.has(name)) throw new TypeError(`Duplicate JSX attribute: ${name}`);
    emitted.add(name);
    if (key === 'style') {
      const style = serializeStyle(value);
      if (style) attributes.push(`style="${escapeHtml(style)}"`);
      continue;
    }
    if (!svg && BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
      if (typeof value !== 'boolean') throw new TypeError(`JSX boolean attribute requires boolean: ${key}`);
      if (value) attributes.push(name.toLowerCase());
      continue;
    }
    if (value === false && !name.startsWith('aria-') && !name.startsWith('data-')) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Invalid JSX attribute value: ${key}`);
    }
    attributes.push(`${name}="${escapeHtml(String(value))}"`);
  }
  return attributes.length ? ` ${attributes.join(' ')}` : '';
}

/** The only JSX serializer; it produces markup without sending or rasterizing it. */
export async function renderToHtml(node: JSXRenderable, options: HtmlRenderOptions = {}): Promise<string> {
  const maxDepth = options.maxDepth ?? 100;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError('JSX maxDepth must be a positive integer');
  const ancestors = new WeakSet<object>();

  const render = async (value: unknown, depth: number, svg: boolean): Promise<string> => {
    if (depth > maxDepth) throw new RangeError(`JSX exceeds maximum render depth ${maxDepth}`);
    if (value == null || typeof value === 'boolean') return '';
    if (typeof value === 'string') return escapeHtml(value);
    if (typeof value === 'number') return String(value);
    if (typeof value !== 'object') throw new TypeError('Unsupported JSX child');
    if (ancestors.has(value)) throw new TypeError('Circular JSX tree');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const rendered: string[] = [];
        // Keep function execution deterministic, including asynchronous side effects.
        for (const child of value) rendered.push(await render(child, depth + 1, svg));
        return rendered.join('');
      }
      if ('then' in value && typeof value.then === 'function') {
        // Box the fulfilled value so Promise resolution does not recursively
        // assimilate custom thenables before our cycle/depth checks can run.
        const then = value.then;
        const resolved = await new Promise<{ node: unknown }>((resolve, reject) => {
          then.call(value, (node: unknown) => resolve({ node }), reject);
        });
        return await render(resolved.node, depth + 1, svg);
      }
      if (!isJsxElement(value)) throw new TypeError('Unsupported JSX child: expected a branded JSX element');
      const { type, props } = value;
      if (type === Fragment) return await render(props.children, depth + 1, svg);
      if (type === rawHtmlType) {
        if (typeof props.html !== 'string') throw new TypeError('Raw HTML must be a string');
        return props.html;
      }
      if (typeof type === 'function') return await render(type(props), depth + 1, svg);
      if (typeof type !== 'string' || !/^[A-Za-z][A-Za-z0-9:._-]*$/.test(type)) throw new TypeError('Invalid JSX tag name');
      if (type.split(':').at(-1)?.toLowerCase() === 'script') throw new TypeError('JSX script elements are unsupported; use explicit trusted raw HTML');
      const inSvg = svg || type === 'svg';
      const attributes = serializeAttributes(props, inSvg);
      const raw = props.dangerouslySetInnerHTML;
      if (raw != null && (typeof raw !== 'object' || !('__html' in raw) || typeof raw.__html !== 'string')) {
        throw new TypeError('dangerouslySetInnerHTML requires { __html: string }');
      }
      if (raw != null && props.children != null) throw new TypeError('JSX cannot contain both children and raw HTML');
      const inner = raw == null
        ? await render(props.children, depth + 1, inSvg && type !== 'foreignObject')
        : (raw as { __html: string }).__html;
      if (!inSvg && VOID_ELEMENTS.has(type.toLowerCase())) {
        if (inner) throw new TypeError(`JSX void element ${type} cannot have children`);
        return `<${type}${attributes}>`;
      }
      return `<${type}${attributes}>${inner}</${type}>`;
    } finally {
      ancestors.delete(value);
    }
  };
  return render(node, 0, false);
}
