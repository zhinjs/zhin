/**
 * Page-side fallback for segments the Sandbox page has no dedicated renderer for (#1250).
 * Core already flattens outbound history; this is the last guard so a reply never shows a raw
 * `{"$jsx":…}` object or a bare `[markdown]`: Markdown keeps its source, buttons (keyboard rows and
 * JSX `<button>`) become `[label]`, unrendered JSX is read through its children.
 */
const MAX_DEPTH = 32;

interface JsxLike {
  readonly $jsx: 'zhin.jsx/1';
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
}

export function isJsxNode(value: unknown): value is JsxLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as Partial<JsxLike>;
  return node.$jsx === 'zhin.jsx/1' && !!node.props && typeof node.props === 'object' && !Array.isArray(node.props);
}

function keyboardLabels(rows: unknown): string {
  if (!Array.isArray(rows)) return '';
  return rows.flatMap(row => Array.isArray(row) ? row : [])
    .map(button => button && typeof button === 'object' ? (button as { label?: unknown }).label : undefined)
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
    .map(label => `[${label}]`).join(' ');
}

function flatten(node: unknown, depth: number): string {
  if (typeof node === 'string') return node;
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (depth > MAX_DEPTH || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(item => flatten(item, depth + 1)).join('');
  if (isJsxNode(node)) {
    const props = node.props;
    if (node.type === 'button') {
      const label = typeof props.label === 'string' ? props.label : flatten(props.children, depth + 1);
      return label ? `[${label}]` : '';
    }
    if (typeof props.text === 'string') return props.text;
    if (node.type === 'keyboard' && Array.isArray(props.rows)) return keyboardLabels(props.rows);
    return flatten(props.children ?? props.content, depth + 1);
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string') return segmentFallbackText(record, depth + 1) ?? `[${record.type}]`;
  return typeof record.text === 'string' ? record.text : '';
}

/**
 * Display text (Markdown) for a segment, or undefined when nothing better than `[type]` exists.
 * Accepts canonical segments (`{ type, data }`) and unrendered JSX nodes.
 */
export function segmentFallbackText(segment: unknown, depth = 0): string | undefined {
  if (!segment || typeof segment !== 'object' || depth > MAX_DEPTH) return undefined;
  if (isJsxNode(segment)) {
    const text = flatten(segment, depth);
    return text || undefined;
  }
  const record = segment as { type?: unknown; data?: unknown };
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown> : undefined;
  if (!data) return undefined;
  if (record.type === 'keyboard') return keyboardLabels(data.rows) || undefined;
  for (const field of ['text', 'content', 'markdown', 'children'] as const) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    const text = flatten(value, depth + 1);
    if (text) return text;
  }
  return undefined;
}

/** Plain text of a segment's body for previews; `[type]` only when nothing readable exists. */
export function segmentPreviewText(segment: unknown): string {
  const type = segment && typeof segment === 'object' ? (segment as { type?: unknown }).type : undefined;
  return segmentFallbackText(segment) ?? (typeof type === 'string' ? `[${type}]` : '');
}
