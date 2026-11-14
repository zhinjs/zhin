/**
 * Conversation display names for plugin pages (#1250).
 *
 * The Host has no "conversation display name" RPC; the names it knows live in the accounts list
 * (`endpoint.list`) and in the recent inbox (`inbox.recent`: channel and sender names of recent
 * messages). This module joins both into a {@link ConversationDirectory} that plugin pages use to
 * show 「群聊 · 测试群」 instead of a raw `["conversation-v1", …]` key, and that the
 * conversation picker lists. Reads go through the existing Console RPCs, so the existing
 * permission map applies (`endpoint.view`; a principal without it simply gets no names).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { consoleRpc } from '../console-utils/remoteApi.js';

export type ConversationKind = 'private' | 'group' | 'channel';

/** Canonical address of one conversation (the IM `DeliveryTarget` shape). */
export interface ConversationAddress {
  readonly endpoint: { readonly adapter: string; readonly id: string };
  readonly kind: ConversationKind;
  readonly id: string;
  readonly parent?: { readonly kind: ConversationKind; readonly id: string };
  readonly threadId?: string;
}

export interface ConversationDirectoryAccount {
  readonly adapter: string;
  /** Canonical endpoint id (the `endpoint.id` of a `DeliveryTarget`). */
  readonly endpointId: string;
  /** Account name shown in the Console (`endpointKey`). */
  readonly name: string;
  readonly online: boolean;
}

export interface ConversationDirectoryEntry {
  readonly address: ConversationAddress;
  /** Platform display name of the group / channel / private peer, when the inbox saw one. */
  readonly name?: string;
  readonly accountName?: string;
  /** Epoch ms of the newest message seen in this conversation. */
  readonly lastActiveAt?: number;
}

export interface ConversationDescription {
  readonly address: ConversationAddress;
  readonly name?: string;
  readonly accountName?: string;
  /** Raw platform id of the conversation (group number, user id, …). */
  readonly id: string;
}

export interface ConversationDirectory {
  readonly accounts: readonly ConversationDirectoryAccount[];
  /** Recent conversations, newest first. */
  readonly conversations: readonly ConversationDirectoryEntry[];
  /** Describes a conversation key, `DeliveryTarget` or JSON string; `undefined` when unparsable. */
  describe(value: unknown): ConversationDescription | undefined;
  /** Nickname of a user as last seen in the inbox, scoped to the account when known. */
  userName(userId: string, endpoint?: { readonly adapter: string; readonly id: string }): string | undefined;
}

const KINDS: ReadonlySet<string> = new Set(['private', 'group', 'channel']);
const isKind = (value: unknown): value is ConversationKind => typeof value === 'string' && KINDS.has(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : undefined;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * Parses what plugins store as a conversation identity: the versioned key
 * `["conversation-v1", adapter, endpointId, kind, id, parentKind, parentId, threadId]`, a
 * `DeliveryTarget`-shaped object, or either one serialized as JSON. Anything else is `undefined`.
 */
export function parseConversationAddress(value: unknown): ConversationAddress | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return undefined;
    try {
      return parseConversationAddress(JSON.parse(trimmed) as unknown);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    if (value[0] !== 'conversation-v1') return undefined;
    const [, adapter, endpointId, kind, id, parentKind, parentId, threadId] = value as unknown[];
    const a = text(adapter);
    const e = text(endpointId);
    const i = text(id);
    if (!a || !e || !i || !isKind(kind)) return undefined;
    const pk = isKind(parentKind) ? parentKind : undefined;
    const pid = text(parentId);
    const tid = text(threadId);
    return {
      endpoint: { adapter: a, id: e },
      kind,
      id: i,
      ...(pk && pid ? { parent: { kind: pk, id: pid } } : {}),
      ...(tid ? { threadId: tid } : {}),
    };
  }
  const target = record(value);
  if (!target) return undefined;
  const endpoint = record(target.endpoint);
  const adapter = text(endpoint?.adapter);
  const endpointId = text(endpoint?.id);
  const id = text(target.id);
  if (!adapter || !endpointId || !id || !isKind(target.kind)) return undefined;
  const parent = record(target.parent);
  const parentId = text(parent?.id);
  const threadId = text(target.threadId);
  return {
    endpoint: { adapter, id: endpointId },
    kind: target.kind,
    id,
    ...(parent && isKind(parent.kind) && parentId ? { parent: { kind: parent.kind, id: parentId } } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

/** Stable identity of an address, for maps and React keys. */
export function conversationAddressKey(address: ConversationAddress): string {
  return JSON.stringify([address.endpoint.adapter, address.endpoint.id, address.kind, address.id,
    address.parent?.kind ?? null, address.parent?.id ?? null, address.threadId ?? null]);
}

/** JSON the `conversation` action field submits; servers read it with `normalizeDeliveryTarget`. */
export function serializeConversationAddress(address: ConversationAddress): string {
  return JSON.stringify({
    endpoint: { adapter: address.endpoint.adapter, id: address.endpoint.id },
    kind: address.kind,
    id: address.id,
    ...(address.parent ? { parent: { kind: address.parent.kind, id: address.parent.id } } : {}),
    ...(address.threadId ? { threadId: address.threadId } : {}),
  });
}

function readAccounts(raw: unknown): ConversationDirectoryAccount[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(record(raw)?.endpoints) ? record(raw)!.endpoints as unknown[] : [];
  const accounts: ConversationDirectoryAccount[] = [];
  for (const item of list) {
    const entry = record(item);
    if (!entry) continue;
    const canonical = record(entry.endpoint);
    const adapter = text(canonical?.adapter) ?? text(entry.adapter);
    const endpointId = text(canonical?.id);
    const name = text(entry.name) ?? endpointId;
    if (!adapter || !endpointId || !name) continue;
    accounts.push({ adapter, endpointId, name, online: entry.connected === true && entry.status === 'online' });
  }
  return accounts;
}

interface DirectoryInput {
  /** `endpoint.list` response (or its `endpoints` array). */
  readonly endpoints?: unknown;
  /** `inbox.recent` response (or its `messages` array). */
  readonly messages?: unknown;
}

/** Pure join of the accounts list and recent inbox messages; see {@link useConversationDirectory}. */
export function buildConversationDirectory(input: DirectoryInput = {}): ConversationDirectory {
  const accounts = readAccounts(input.endpoints);
  const byName = new Map(accounts.map(account => [`${account.adapter}\u0000${account.name}`, account]));
  const byCanonical = new Map(accounts.map(account => [`${account.adapter}\u0000${account.endpointId}`, account]));
  const rawMessages = Array.isArray(input.messages)
    ? input.messages
    : Array.isArray(record(input.messages)?.messages) ? record(input.messages)!.messages as unknown[] : [];

  const conversations = new Map<string, { entry: ConversationDirectoryEntry }>();
  const users = new Map<string, string>();
  const sorted = rawMessages
    .map(item => record(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .sort((left, right) => Number(right.timestamp ?? 0) - Number(left.timestamp ?? 0));
  for (const message of sorted) {
    const adapter = text(message.adapter);
    const account = adapter ? byName.get(`${adapter}\u0000${text(message.endpointKey) ?? ''}`) : undefined;
    const channel = record(message.channel);
    const parent = record(channel?.parent);
    const address = parseConversationAddress(message.conversation) ?? (() => {
      // Older rows have no observation: rebuild the address from the account and channel columns.
      const id = text(channel?.id);
      if (!account || !id || !isKind(channel?.type)) return undefined;
      const parentKind = parent?.type === 'guild' ? 'channel' : parent?.type;
      const parentId = text(parent?.id);
      return {
        endpoint: { adapter: account.adapter, id: account.endpointId },
        kind: channel!.type as ConversationKind,
        id,
        ...(isKind(parentKind) && parentId ? { parent: { kind: parentKind, id: parentId } } : {}),
      } satisfies ConversationAddress;
    })();
    const sender = record(message.sender);
    const senderId = text(sender?.id);
    const senderName = text(sender?.name);
    if (senderId && senderName) {
      const scope = address ? `${address.endpoint.adapter}\u0000${address.endpoint.id}` : adapter ?? '';
      if (!users.has(`${scope}\u0000${senderId}`)) users.set(`${scope}\u0000${senderId}`, senderName);
      if (!users.has(`*\u0000${senderId}`)) users.set(`*\u0000${senderId}`, senderName);
    }
    if (!address) continue;
    const key = conversationAddressKey(address);
    const outbound = message.direction === 'outbound';
    // A private chat is named after the peer; only an inbound sender is that peer.
    const name = text(channel?.name) ?? (address.kind === 'private' && !outbound ? senderName : undefined);
    const existing = conversations.get(key);
    if (existing) {
      if (!existing.entry.name && name) existing.entry = { ...existing.entry, name };
      continue;
    }
    const owner = byCanonical.get(`${address.endpoint.adapter}\u0000${address.endpoint.id}`) ?? account;
    const timestamp = Number(message.timestamp);
    conversations.set(key, {
      entry: {
        address,
        ...(name ? { name } : {}),
        ...(owner ? { accountName: owner.name } : {}),
        ...(Number.isFinite(timestamp) && timestamp > 0 ? { lastActiveAt: timestamp } : {}),
      },
    });
  }
  const entries = [...conversations.values()].map(value => value.entry);
  const named = new Map(entries.map(entry => [conversationAddressKey(entry.address), entry]));

  return {
    accounts,
    conversations: entries,
    describe(value) {
      const address = parseConversationAddress(value);
      if (!address) return undefined;
      const known = named.get(conversationAddressKey(address));
      const account = byCanonical.get(`${address.endpoint.adapter}\u0000${address.endpoint.id}`);
      const peer = address.kind === 'private'
        ? users.get(`${address.endpoint.adapter}\u0000${address.endpoint.id}\u0000${address.id}`)
        : undefined;
      const name = known?.name ?? peer;
      const accountName = known?.accountName ?? account?.name ?? endpointShortName(address.endpoint.id);
      return { address, id: address.id, ...(name ? { name } : {}), ...(accountName ? { accountName } : {}) };
    },
    userName(userId, endpoint) {
      if (!userId) return undefined;
      if (endpoint) {
        const scoped = users.get(`${endpoint.adapter}\u0000${endpoint.id}\u0000${userId}`);
        if (scoped) return scoped;
      }
      return users.get(`*\u0000${userId}`);
    },
  };
}

/**
 * Canonical endpoint ids look like `root/sandbox\u0000zhin.adapter\u0000sandbox~sandbox-bot`; the
 * account name is the part after the last `~`. Used only when the account list is unavailable.
 */
export function endpointShortName(endpointId: string): string | undefined {
  const tail = endpointId.split('\u0000').pop() ?? endpointId;
  const tilde = tail.lastIndexOf('~');
  const name = tilde >= 0 ? tail.slice(tilde + 1) : tail;
  return name || undefined;
}

const KIND_LABELS: Readonly<Record<ConversationKind, Readonly<Record<'zh-CN' | 'en', string>>>> = {
  private: { 'zh-CN': '私聊', en: 'Private' },
  group: { 'zh-CN': '群聊', en: 'Group' },
  channel: { 'zh-CN': '频道', en: 'Channel' },
};

export function conversationKindLabel(kind: ConversationKind, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return KIND_LABELS[kind][locale];
}

/**
 * One-line label: 「群聊 · 测试群（123456）· sandbox-bot」. Without a known name the id stands
 * alone: 「私聊 · sandbox-user · sandbox-bot」.
 */
export function formatConversationLabel(
  description: ConversationDescription,
  locale: 'zh-CN' | 'en' = 'zh-CN',
  options: { readonly showAccount?: boolean } = {},
): string {
  const { address } = description;
  const who = description.name && description.name !== description.id
    ? (locale === 'en' ? `${description.name} (${description.id})` : `${description.name}（${description.id}）`)
    : description.id;
  const parts = [conversationKindLabel(address.kind, locale), who];
  if (address.threadId) parts.push(locale === 'en' ? `thread ${address.threadId}` : `子区 ${address.threadId}`);
  if (options.showAccount !== false && description.accountName) parts.push(description.accountName);
  return parts.join(' · ');
}

// ── Loader ─────────────────────────────────────────────────────────────────

export interface ConversationDirectoryState {
  readonly directory: ConversationDirectory;
  readonly loading: boolean;
  /** Set when neither the accounts list nor the recent inbox could be read (e.g. no `endpoint.view`). */
  readonly error?: Error;
  /** Whether the recent inbox was readable; without it only account names are known. */
  readonly inboxAvailable: boolean;
  readonly refresh: () => Promise<void>;
}

interface Snapshot {
  readonly endpoints?: unknown;
  readonly messages?: unknown;
  readonly error?: Error;
  readonly inboxAvailable: boolean;
}

async function loadSnapshot(): Promise<Snapshot> {
  const [endpoints, inbox] = await Promise.allSettled([
    consoleRpc<unknown>('endpoint.list'),
    consoleRpc<unknown>('inbox.recent', { limit: 100 }),
  ]);
  return {
    ...(endpoints.status === 'fulfilled' ? { endpoints: endpoints.value } : {}),
    ...(inbox.status === 'fulfilled' ? { messages: inbox.value } : {}),
    inboxAvailable: inbox.status === 'fulfilled',
    ...(endpoints.status === 'rejected' && inbox.status === 'rejected'
      ? { error: endpoints.reason instanceof Error ? endpoints.reason : new Error(String(endpoints.reason)) }
      : {}),
  };
}

/**
 * Lets one page share a single directory: the declarative page provides it when a column or field
 * needs conversations, and every {@link useSharedConversationDirectory} below reads it instead of
 * fetching again.
 */
export const ConversationDirectoryContext = createContext<ConversationDirectoryState | undefined>(undefined);

/**
 * Accounts and recent conversations for display names and pickers, read from `endpoint.list` +
 * `inbox.recent` once per mount; pass `enabled: false` to skip loading.
 */
export function useConversationDirectory(options: { readonly enabled?: boolean } = {}): ConversationDirectoryState {
  const enabled = options.enabled !== false;
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(enabled);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    void loadSnapshot().then((next) => {
      if (!alive) return;
      setSnapshot(next);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [enabled]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSnapshot(await loadSnapshot());
    setLoading(false);
  }, []);

  const directory = useMemo(
    () => buildConversationDirectory({ endpoints: snapshot?.endpoints, messages: snapshot?.messages }),
    [snapshot],
  );
  return useMemo(() => ({
    directory,
    loading: enabled && loading,
    inboxAvailable: snapshot?.inboxAvailable ?? false,
    refresh,
    ...(snapshot?.error ? { error: snapshot.error } : {}),
  }), [directory, enabled, loading, snapshot, refresh]);
}

/** The page's shared directory when one is provided, else a directory of this component's own. */
export function useSharedConversationDirectory(options: { readonly enabled?: boolean } = {}): ConversationDirectoryState {
  const shared = useContext(ConversationDirectoryContext);
  const own = useConversationDirectory({ enabled: shared === undefined && options.enabled !== false });
  return shared ?? own;
}
