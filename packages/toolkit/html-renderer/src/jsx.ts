import { e } from '@zhin.js/satori';

const SELF_CLOSING = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);

export function serializeJsxToHtml(element: unknown): string {
  if (typeof element === 'string') return e(element);
  if (typeof element === 'number') return String(element);
  if (element == null || typeof element === 'boolean') return '';
  if (Array.isArray(element)) return element.map(serializeJsxToHtml).join('');

  if (typeof element === 'object' && 'type' in element) {
    const { type, props = {} } = element as { type: string; props?: Record<string, unknown> };
    const { children, style, dangerouslySetInnerHTML, ...rest } = props as {
      children?: unknown;
      style?: Record<string, unknown>;
      dangerouslySetInnerHTML?: { __html?: string };
    };

    let styleText = '';
    if (style && typeof style === 'object') {
      styleText = Object.entries(style)
        .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
        .join('; ');
    }

    const attrs = Object.entries(rest)
      .filter(([key, value]) => key !== 'dangerouslySetInnerHTML' && value != null && value !== false)
      .map(([key, value]) => `${key}="${e(String(value))}"`)
      .join(' ')

    const styleAttr = styleText ? ` style="${e(styleText)}"` : '';
    const attrText = attrs ? ` ${attrs}` : '';

    if (dangerouslySetInnerHTML?.__html) {
      return `<${type}${attrText}${styleAttr}>${dangerouslySetInnerHTML.__html}</${type}>`;
    }

    const inner = serializeJsxToHtml(children);
    if (SELF_CLOSING.has(type) && !inner) return `<${type}${attrText}${styleAttr} />`;
    return `<${type}${attrText}${styleAttr}>${inner}</${type}>`;
  }

  return '';
}
