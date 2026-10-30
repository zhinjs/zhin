import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageSegment } from '@zhin.js/client';
import { hasPlaygroundKeyboard, type PlaygroundMessage, type PlaygroundScope } from './playgroundState.js';
import { captureSandboxRequestContext, type SandboxRequestContext } from './sandboxTransport.js';
import { sandboxText, type SandboxLocale } from './messages.js';

export interface SandboxHistoryBinding {
  readonly connectionId: string;
  readonly sessionKey: string;
  readonly scope: Readonly<{ adapter: string; id: string }>;
  readonly scene: Readonly<{ id: string; type: PlaygroundScope; name: string }>;
  readonly ownerId: string;
  readonly requestContext?: SandboxRequestContext;
}
type HistoryUpdate = (current: readonly PlaygroundMessage[]) => PlaygroundMessage[];
interface HistoryPage { messages: PlaygroundMessage[]; hasMore: boolean; nextBeforeSequence: number | null }
interface HistoryOwner {
  key: string;
  binding: SandboxHistoryBinding;
  context: SandboxRequestContext;
  controller: AbortController;
  before?: number;
  hasMore: boolean;
  pending?: Promise<void>;
}

/** Real message events only. A page applies to the latest live rows rather than replacing them. */
export function useSandboxHistory(
  binding: SandboxHistoryBinding | undefined,
  onHistory: (update: HistoryUpdate) => void,
  locale: SandboxLocale = 'zh-CN',
) {
  const key = binding ? JSON.stringify([captureSandboxRequestContext().apiBase, binding.connectionId, binding.sessionKey,
    binding.scope.adapter, binding.scope.id, binding.scene.type, binding.scene.id, binding.ownerId]) : '';
  const current = useRef(key); current.current = key;
  const receiver = useRef(onHistory); receiver.current = onHistory;
  const owner = useRef<HistoryOwner | undefined>(undefined);
  const [state, setState] = useState({ key, loading: false, hasMore: false, error: null as string | null });
  const active = (read: HistoryOwner) => owner.current === read && current.current === read.key
    && !read.controller.signal.aborted && requestContextCurrent(read.context);
  const load = useCallback((read: HistoryOwner, earlier: boolean): Promise<void> => {
    if (!active(read) || earlier && !read.hasMore) return Promise.resolve();
    if (read.pending) return read.pending;
    const before = earlier ? read.before : undefined;
    setState({ key: read.key, loading: true, hasMore: read.hasMore, error: null });
    read.pending = (async () => {
      try {
        const url = new URL('/api/conversations/history', `${read.context.apiBase}/`);
        url.searchParams.set('connectionId', read.binding.connectionId);
        url.searchParams.set('sessionKey', read.binding.sessionKey);
        if (before !== undefined) url.searchParams.set('beforeSequence', String(before));
        const response = await fetch(url, { headers: read.context.headers, signal: read.controller.signal, cache: 'no-store' });
        if (!active(read)) return;
        const body: unknown = await response.json();
        if (!active(read)) return;
        if (!response.ok) {
          if (response.status === 404 && record(body)?.code === 'history_not_recorded') {
            read.hasMore = false; read.before = undefined;
            setState({ key: read.key, loading: false, hasMore: false, error: null });
            return;
          }
          throw Error(typeof record(body)?.error === 'string' ? String(record(body)!.error) : `History request failed (${response.status})`);
        }
        const page = readSandboxHistoryPage(body, read.binding, before, locale);
        // React may defer a functional update; retire it at execution time too.
        receiver.current(previous => active(read) ? mergeSandboxHistory(previous, page.messages) : [...previous]);
        read.hasMore = page.hasMore; read.before = page.nextBeforeSequence ?? undefined;
        setState({ key: read.key, loading: false, hasMore: read.hasMore, error: null });
      } catch (error) {
        if (active(read)) setState({ key: read.key, loading: false, hasMore: read.hasMore,
          error: error instanceof Error ? error.message : 'History read failed' });
      } finally { read.pending = undefined; }
    })();
    return read.pending;
  }, [locale]);
  useEffect(() => {
    if (!binding) { owner.current = undefined; setState({ key, loading: false, hasMore: false, error: null }); return; }
    const read: HistoryOwner = { key, binding: { ...binding, scope: { ...binding.scope }, scene: { ...binding.scene } },
      context: binding.requestContext ?? captureSandboxRequestContext(), controller: new AbortController(), hasMore: false };
    owner.current = read;
    setState({ key, loading: false, hasMore: false, error: null });
    void load(read, false);
    return () => { read.controller.abort(); if (owner.current === read) owner.current = undefined; };
  }, [key, binding?.requestContext]);
  const visible = state.key === key && (owner.current ? active(owner.current) : !binding);
  return {
    loading: visible && state.loading,
    error: visible ? state.error : null,
    hasMore: visible && state.hasMore,
    loadEarlier: () => owner.current ? load(owner.current, true) : Promise.resolve(),
    refresh: () => owner.current ? load(owner.current, false) : Promise.resolve(),
  };
}

function requestContextCurrent(context: SandboxRequestContext): boolean {
  const current = captureSandboxRequestContext();
  return current.apiBase === context.apiBase && current.headers.Authorization === context.headers.Authorization;
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());

/** Validate the server address before projecting any message into the active scene. */
export function readSandboxHistoryPage(body: unknown, binding: SandboxHistoryBinding, before?: number, locale: SandboxLocale = 'zh-CN'): HistoryPage {
  function fail(): never { throw Error('History response does not match the current conversation'); }
  const data = record(record(body)?.data);
  const matches = (value: unknown) => {
    const conversation = record(value), endpoint = record(conversation?.endpoint);
    return endpoint?.adapter === binding.scope.adapter && endpoint.id === binding.scope.id
      && conversation?.kind === binding.scene.type && conversation.id === binding.scene.id
      && conversation.parent === undefined && conversation.threadId === undefined;
  };
  if (record(body)?.success !== true || !data || !matches(data.conversation) || !Array.isArray(data.items)
    || data.items.length > 50 || typeof data.hasMore !== 'boolean') fail();
  const items = data.items as unknown[];
  let previous = 0;
  const messages: PlaygroundMessage[] = [];
  for (const value of items) {
    const item = record(value);
    if (!item || !Number.isSafeInteger(item.sequence) || Number(item.sequence) <= previous || !text(item.type)
      || !validTime(item.timestamp) || before !== undefined && Number(item.sequence) >= before) fail();
    previous = Number(item.sequence);
    if (item.type === 'message.created') {
      const message = record(item.message), ref = record(message?.ref), actor = record(message?.actor);
      if (!message || !ref || !text(ref.id) || !matches(ref.conversation) || !validTime(message.timestamp)
        || !Array.isArray(message.segments) || !message.segments.every(segment => text(record(segment)?.type) && record(record(segment)?.data))
        || message.actor !== undefined && (!actor || !text(actor.id) || actor.displayName !== undefined && typeof actor.displayName !== 'string')
        || message.contentStatus !== undefined && message.contentStatus !== 'unavailable') fail();
      const content: MessageSegment[] = message.contentStatus === 'unavailable'
        ? [{ type: 'text', data: { text: sandboxText(locale, '消息正文未保存') } }] : message.segments as MessageSegment[];
      messages.push({ id: ref.id, type: actor ? 'sent' : 'received', channelType: binding.scene.type, channelId: binding.scene.id,
        channelName: binding.scene.name, senderId: actor ? String(actor.id) : 'endpoint',
        senderName: actor ? String(actor.displayName || actor.id) : binding.scope.id, content, timestamp: message.timestamp,
        historySequence: previous, ...(hasPlaygroundKeyboard(content) ? { interactionReadOnly: true } : {}) });
    } else if (item.type === 'message.recalled') {
      const ref = record(item.messageRef);
      if (item.messageRef !== undefined && (!ref || !text(ref.id) || !matches(ref.conversation))) fail();
      messages.push({ id: `history:recall:${previous}`, type: 'received', channelType: binding.scene.type, channelId: binding.scene.id,
        channelName: binding.scene.name, senderId: 'endpoint', senderName: binding.scope.id, timestamp: item.timestamp,
        content: [{ type: 'text', data: { text: sandboxText(locale, '消息已撤回') } }], historySequence: previous,
        ...(ref ? { recalledMessageId: String(ref.id) } : {}) });
    }
  }
  if (data.hasMore ? !items.length || data.nextBeforeSequence !== record(items[0])?.sequence
    : data.nextBeforeSequence !== null) fail();
  return { messages, hasMore: data.hasMore, nextBeforeSequence: data.hasMore ? Number(data.nextBeforeSequence) : null };
}

/** Stable message identity joins canonical events, optimistic inputs and native wire receipts. */
export function mergeSandboxHistory(current: readonly PlaygroundMessage[], history: readonly PlaygroundMessage[]): PlaygroundMessage[] {
  const key = (row: PlaygroundMessage) => JSON.stringify([row.channelType, row.channelId, row.type, row.id]);
  const rows = new Map(current.map(row => [key(row), row]));
  for (const row of history) {
    const existing = rows.get(key(row));
    rows.set(key(row), existing ? { ...row, ...existing, historySequence: row.historySequence,
      ...(existing.interactionReadOnly === false ? { interactionReadOnly: false } : row.interactionReadOnly ? { interactionReadOnly: true } : {}) } : row);
  }
  const recalled = new Set([...rows.values()].filter(row => row.recalledMessageId).map(row => JSON.stringify([row.channelType, row.channelId, row.recalledMessageId])));
  return [...rows.values()].map(row => recalled.has(JSON.stringify([row.channelType, row.channelId, row.id]))
    ? { ...row, recalled: true, ...(hasPlaygroundKeyboard(row.content) ? { interactionReadOnly: true } : {}) } : row)
    .sort((a, b) => a.timestamp - b.timestamp || (a.channelType === b.channelType && a.channelId === b.channelId
      ? (a.historySequence ?? Number.MAX_SAFE_INTEGER) - (b.historySequence ?? Number.MAX_SAFE_INTEGER) : 0));
}
