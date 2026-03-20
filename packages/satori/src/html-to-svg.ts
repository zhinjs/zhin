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

  if (typeof props.style === 'string') {
    newProps.style = styleStringToObject(props.style);
  }

  if (props.children !== undefined && props.children !== null) {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    const next = children.map(transformNode).flatMap((n) => (Array.isArray(n) ? n : [n]));
    const filtered = next.filter((x) => x != null) as Exclude<TransformedNode, null>[];
    if (filtered.length === 0) delete newProps.children;
    else if (filtered.length === 1) newProps.children = filtered[0];
    else newProps.children = filtered;
  }

  return { type, props: newProps } as SatoriElement;
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

export async function htmlToSvg(html: string, options: HtmlToSvgOptions): Promise<string> {
  const parsed = parse(html);
  const tree = normalizeRoot(parsed);
  return satori(tree as Parameters<typeof satori>[0], options as Parameters<typeof satori>[1]);
}
