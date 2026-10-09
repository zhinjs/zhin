/** Lazy, transport-neutral JSX. Functions are evaluated only during rendering. */
export function Fragment(props: Readonly<{ children?: JSXRenderable }>): JSXRenderable {
  return props.children;
}
/** @internal Raw HTML is deliberately separate from escaped text nodes. */
export const rawHtmlType = Symbol.for('zhin.jsx.raw-html/1');

/** A settled node excludes a top-level thenable so Awaited<JSXNode> terminates. */
type JSXResolvedNode =
  | JSXElement
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JSXRenderable[];

export type JSXNode = JSXResolvedNode | PromiseLike<JSXResolvedNode>;

/** Rendering inputs also accept explicitly annotated async component results. */
export type JSXRenderable = JSXNode | PromiseLike<JSXNode>;

/** Explicit async annotations such as Promise<JSXNode> remain valid component returns. */
export type JSXComponent<P = Record<string, unknown>> = (props: P) => JSXRenderable;
export type JSXElementType = string | JSXComponent<any> | typeof rawHtmlType;
export type JSXProps = Readonly<Record<string, unknown>> & { readonly children?: JSXRenderable };

export interface JSXElement {
  readonly $jsx: 'zhin.jsx/1';
  readonly type: JSXElementType;
  readonly props: JSXProps;
}

export type JSXStyle = string | Readonly<Record<string, string | number | null | undefined | false>>;

export interface JSXAttributes {
  readonly children?: JSXRenderable;
  readonly key?: string | number;
  readonly style?: JSXStyle;
  readonly class?: string;
  readonly className?: string;
  readonly id?: string;
  readonly title?: string;
  readonly dangerouslySetInnerHTML?: Readonly<{ __html: string }>;
  readonly [attribute: string]: unknown;
}

/** Module-scoped namespace consumed through jsxImportSource, never a global JSX. */
export namespace JSX {
  export type Element = JSXElement;
  // Components may return asynchronous or compound nodes; JSX expressions still
  // construct lazy elements. TypeScript 5.1+ checks these independently.
  export type ElementType = JSXElementType;
  export interface ElementChildrenAttribute { children: {}; }
  export interface IntrinsicAttributes { key?: string | number; }
  export interface IntrinsicElements { [name: string]: JSXAttributes; }
}

export function jsx(type: JSXElementType, props: JSXProps | null, _key?: string | number): JSXElement {
  const { key: _propKey, ...cleanProps } = props ?? {};
  return Object.freeze({
    $jsx: 'zhin.jsx/1' as const,
    type,
    props: Object.freeze(cleanProps),
  });
}

export const jsxs = jsx;

/** Development metadata is compiler bookkeeping and never becomes HTML attributes. */
export function jsxDEV(
  type: JSXElementType,
  props: JSXProps | null,
  key?: string | number,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): JSXElement {
  return jsx(type, props, key);
}

/** Classic JSX factory and direct element construction. */
export function createElement(type: JSXElementType, props: JSXProps | null, ...children: JSXRenderable[]): JSXElement {
  return jsx(type, children.length ? { ...props, children } : props);
}

export function isJsxElement(value: unknown): value is JSXElement {
  if (!value || typeof value !== 'object') return false;
  const node = value as Partial<JSXElement>;
  return node.$jsx === 'zhin.jsx/1'
    && (typeof node.type === 'string' || typeof node.type === 'function'
      || node.type === rawHtmlType)
    && !!node.props && typeof node.props === 'object' && !Array.isArray(node.props);
}

/** Insert trusted markup explicitly. Normal strings, including component returns, are text. */
export function rawHtml(html: string): JSXElement {
  if (typeof html !== 'string') throw new TypeError('Raw HTML must be a string');
  return jsx(rawHtmlType, { html });
}

export function Raw(props: Readonly<{ html: string }>): JSXElement {
  return rawHtml(props.html);
}
