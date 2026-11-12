import type { LocalImageAssetStore, LocalImageScope } from './local-image-assets.js';

/**
 * Capture image blocks in any tool result (MCP, plugin, seam or builtin) before journaling.
 * Only protocol-shaped payloads are captured; ordinary tool text keeps its meaning.
 *
 * Runs after the tool has settled and is deliberately not cancellable: a cancellation arriving
 * while an image is written must not turn a completed (possibly side-effecting) call into a
 * cancelled one, and must not leave a saved image that no journaled result refers to.
 * Only plain objects and arrays are rebuilt; class instances (Date, Map, Buffer, …) pass through.
 */
export async function captureToolImages(
  result: unknown,
  store: LocalImageAssetStore | undefined,
  scope: LocalImageScope | undefined,
  source: string,
): Promise<unknown> {
  const replacements = new Map<string, string>();
  const capture = async (data: string): Promise<string> => {
    if (replacements.has(data)) return replacements.get(data)!;
    let text: string;
    try {
      if (!store || !scope) throw new Error('Local image storage is unavailable');
      const reference = await store.capture(data, scope, source);
      text = `[Private tool image: ${JSON.stringify(reference)}. Use get_local_assets with asset_id to inspect; do not publish this original.]`;
    } catch (error) {
      const reason = error instanceof Error && ['Local image storage is full', 'Invalid or oversized local image'].includes(error.message)
        ? error.message : 'Local image storage is unavailable';
      text = `[Tool image unavailable: ${reason}]`;
    }
    replacements.set(data, text);
    return text;
  };
  const visit = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) items.push(await visit(item));
      return items;
    }
    if (!isObject(value)) return value;
    if (value.type === 'image' && typeof value.data === 'string') {
      return { type: 'text', text: await capture(value.data) };
    }
    if (value.type === 'resource' && isObject(value.resource)
      && typeof value.resource.mimeType === 'string' && value.resource.mimeType.startsWith('image/')
      && typeof value.resource.blob === 'string') {
      return { type: 'text', text: await capture(value.resource.blob) };
    }
    if (value.type === 'text' && typeof value.text === 'string') {
      let parsed: unknown;
      try { parsed = JSON.parse(value.text); } catch { return value; }
      if (isObject(parsed) || Array.isArray(parsed)) return { ...value, text: JSON.stringify(await visit(parsed)) };
    }
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) next[key] = await visit(item);
    return next;
  };
  const sanitized = await visit(result);
  if (!replacements.size) return result;
  // Tools (MCP servers especially) may mirror structured results into text or structuredContent.
  // Replace only bytes actually identified as image payloads, not arbitrary base64-looking strings.
  const removeCopies = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = value;
      for (const [data, replacement] of replacements) {
        if (text === data) return replacement;
        if (data.length >= 32) text = text.split(data).join(replacement);
      }
      return text;
    }
    if (Array.isArray(value)) return value.map(removeCopies);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeCopies(item)]));
    return value;
  };
  return removeCopies(sanitized);
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
