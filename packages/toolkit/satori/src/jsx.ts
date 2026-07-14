/**
 * Satori HTML JSX 运行时 — 同步产出 HTML 字符串（非 zhin.js IM 消息树）
 */
import { e } from "./html-template.js";
import type { HtmlComponent } from "./html-components.js";

/** Fragment 标记（与 React 语义一致，产出时展平子节点） */
export const Fragment = Symbol.for("@zhin.js/satori.fragment");

export type JSXChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | JSXChild[];

export type JSXElementType = string | HtmlComponent<any> | typeof Fragment;

export type JSXProps = Record<string, unknown> & {
  children?: JSXChild;
};

declare global {
  namespace JSX {
    type Element = string;
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface HTMLAttributes {
      children?: JSXChild;
      key?: string | number;
      style?: string | Record<string, string | number>;
      class?: string;
      id?: string;
      title?: string;
      [attr: string]: unknown;
    }
    interface IntrinsicElements {
      div: HTMLAttributes;
      span: HTMLAttributes;
      p: HTMLAttributes;
      h1: HTMLAttributes;
      h2: HTMLAttributes;
      h3: HTMLAttributes;
      h4: HTMLAttributes;
      img: HTMLAttributes;
      br: HTMLAttributes;
      hr: HTMLAttributes;
      a: HTMLAttributes;
      ul: HTMLAttributes;
      ol: HTMLAttributes;
      li: HTMLAttributes;
      strong: HTMLAttributes;
      em: HTMLAttributes;
      [elemName: string]: HTMLAttributes;
    }
  }
}

const SELF_CLOSING = new Set(["img", "br", "hr", "input", "meta", "link"]);

function stripKey(props: JSXProps | null | undefined): Record<string, unknown> {
  if (!props) return {};
  const { key: _key, ...rest } = props;
  return rest;
}

function styleToString(style: unknown): string {
  if (!style) return "";
  if (typeof style === "string") return style;
  if (typeof style !== "object") return String(style);
  return Object.entries(style as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v}`)
    .join("; ");
}

function escapeTextChild(child: string): string {
  const t = child.trim();
  if (looksLikeSingleHtmlElement(t)) return child;
  return e(child);
}

function looksLikeSingleHtmlElement(text: string): boolean {
  if (!text.startsWith('<') || text.length < 3) return false;
  const second = text.charCodeAt(1);
  const startsWithTag = (second >= 65 && second <= 90) || (second >= 97 && second <= 122);
  if (!startsWithTag) return false;
  const gt = text.indexOf('>');
  if (gt < 0) return false;
  return text.endsWith('/>') || text.includes('</');
}

function serializeIntrinsicChildren(children: unknown): string {
  if (children == null || children === false) return "";
  if (typeof children === "string") return escapeTextChild(children);
  if (typeof children === "number" || typeof children === "boolean") return String(children);
  if (Array.isArray(children)) return children.map(serializeIntrinsicChildren).join("");
  return "";
}

function serializeIntrinsic(type: string, props: Record<string, unknown>): string {
  const { children, style, dangerouslySetInnerHTML, ...restProps } = props;

  const styleStr = styleToString(style);
  const styleAttr = styleStr ? ` style="${e(styleStr)}"` : "";

  const attrs = Object.entries(restProps)
    .filter(([key, value]) => key !== "key" && value != null && value !== false)
    .map(([key, value]) => `${key}="${e(String(value))}"`)
    .join(" ");
  const attrStr = attrs ? ` ${attrs}` : "";

  if (
    dangerouslySetInnerHTML &&
    typeof dangerouslySetInnerHTML === "object" &&
    "__html" in (dangerouslySetInnerHTML as object)
  ) {
    const raw = String((dangerouslySetInnerHTML as { __html: unknown }).__html);
    return `<${type}${attrStr}${styleAttr}>${raw}</${type}>`;
  }

  const childrenHtml = serializeIntrinsicChildren(children);
  if (SELF_CLOSING.has(type) && !childrenHtml) {
    return `<${type}${attrStr}${styleAttr} />`;
  }
  return `<${type}${attrStr}${styleAttr}>${childrenHtml}</${type}>`;
}

export function createElement(type: JSXElementType, props: JSXProps | null): string {
  const clean = stripKey(props);

  if (type === Fragment) {
    return serializeIntrinsicChildren(clean.children);
  }

  if (typeof type === "function") {
    return type(clean);
  }

  if (typeof type === "string") {
    return serializeIntrinsic(type, clean);
  }

  return "";
}

/** automatic JSX runtime */
export function jsx(type: JSXElementType, props: JSXProps, _key?: string | number): string {
  return createElement(type, props);
}

export function jsxs(type: JSXElementType, props: JSXProps, _key?: string | number): string {
  return jsx(type, props, _key);
}

/** 兼容 lazy tree 或已是 HTML 字符串的输入 */
export function renderJSX(element: unknown): string {
  if (typeof element === "string") return element;
  if (element == null || element === false) return "";
  if (Array.isArray(element)) return element.map(renderJSX).join("");
  if (typeof element === "object" && element !== null && "type" in element) {
    const node = element as { type: JSXElementType; props?: JSXProps; data?: JSXProps };
    return createElement(node.type, node.props ?? node.data ?? null);
  }
  return serializeIntrinsicChildren(element);
}

export function serializeChildren(children: unknown): string {
  return serializeIntrinsicChildren(children);
}
