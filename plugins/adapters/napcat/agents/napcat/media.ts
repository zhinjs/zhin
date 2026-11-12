import { messages as t } from './messages.js';
import { requireMessageInConversation, type NapcatToolContext } from './conversation.js';

/**
 * OneBot `file` parameters accept `file://` URIs and bare local paths, which NapCat reads from the host
 * (ADR 0056 §2: reading host files is a host-global capability). Tools open to group members accept
 * only remote media: an http(s) URL, `base64://` data, or a platform file token without path separators.
 */
export function isRemoteMediaSource(value: string): boolean {
  const source = value.trim();
  if (!source) return false;
  if (/^https?:\/\//i.test(source) || /^base64:\/\//i.test(source)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return false; // file:, data:, other schemes, Windows drives
  return !/[\\/]/.test(source) && !source.startsWith('~') && source !== '.' && source !== '..';
}

export function requireRemoteMedia(context: NapcatToolContext, value: string, field: string): void {
  if (!isRemoteMediaSource(value)) throw new Error(t(context.locale, 'hostMediaRefused', { p0: field }));
}

const MEDIA_KEYS = ['file', 'url', 'path', 'image', 'thumb', 'audio'] as const;

/**
 * Forward nodes are delivered as OneBot wire segments: every nested media field must be remote and
 * every referenced message (`node.data.id`) must belong to the current conversation.
 */
export async function requireSafeForwardNodes(context: NapcatToolContext, nodes: readonly unknown[], depth = 0): Promise<void> {
  if (depth > 4) throw new Error(t(context.locale, 'forwardTooDeep'));
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const data = (node as { data?: Record<string, unknown> }).data ?? {};
    for (const key of MEDIA_KEYS) {
      const value = data[key];
      if (typeof value === 'string' && value && !(key === 'url' && /^https?:\/\//i.test(value))) requireRemoteMedia(context, value, key);
    }
    const type = (node as { type?: unknown }).type;
    // A node (or a nested reply) that references an existing message would surface its content here.
    if ((depth === 0 || type === 'node' || type === 'reply') && data.id !== undefined && data.id !== null && data.id !== '') {
      await requireMessageInConversation(context, Number(data.id));
    }
    const content = data.content;
    if (Array.isArray(content)) await requireSafeForwardNodes(context, content, depth + 1);
  }
}
