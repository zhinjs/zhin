import { randomUUID } from 'node:crypto';
import { bindOperationInput } from '@zhin.js/feature-kit';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import { jsx } from '@zhin.js/jsx';
import type { PluginId, PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { interactionMessages as t } from '../../built/interaction-messages.js';
import { resolvePayloadFromText } from '../../built/interactive-segments/action.js';
import { isKeyboardSegment } from '../../built/interactive-segments/types.js';
import type { Segment } from '../../built/segment-contract/types.js';
import type { ButtonClickHandler, ButtonProps } from '../../jsx/message-tags.js';
import { operationEndpoint, type Message, type SendRequest } from './contracts.js';

const JSX_BUTTON_PREFIX = 'zhin:jsx:';
const JSX_BUTTON_TTL_MS = 60 * 60 * 1000;

export function isJsxButtonPayload(payload: string | undefined): boolean {
  return payload?.startsWith(JSX_BUTTON_PREFIX) === true;
}

export interface PluginIncarnationRef {
  readonly requester: PluginId;
  readonly snapshot: RuntimeSnapshot;
  readonly node: PluginNodeSnapshot | undefined;
  readonly signal?: AbortSignal;
}

function hasIdenticalPluginTree(
  left: ReadonlyMap<PluginId, PluginNodeSnapshot>,
  right: ReadonlyMap<PluginId, PluginNodeSnapshot>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [id, node] of left) {
    if (right.get(id) !== node) return false;
  }
  return true;
}

/**
 * Checks whether the plugin incarnation that registered a callback/interaction
 * is still live in `currentSnapshot`.
 * Survives HMR of unrelated plugins (where another plugin's node in `tree` changed
 * while `origin.node` is unchanged), while retiring if the owning plugin was reloaded/removed,
 * its endpoint signal aborted, or the runtime performed a full-generation retirement.
 */
export function isPluginIncarnationAlive(
  origin: PluginIncarnationRef,
  currentSnapshot: RuntimeSnapshot,
): boolean {
  if (origin.signal?.aborted) {
    return false;
  }
  if (origin.snapshot === currentSnapshot) {
    return true;
  }
  if (!origin.node || hasIdenticalPluginTree(origin.snapshot.tree, currentSnapshot.tree)) {
    return false;
  }
  const currentNode = currentSnapshot.tree.get(origin.requester);
  return currentNode !== undefined && currentNode === origin.node;
}

interface ButtonBinding extends PluginIncarnationRef {
  readonly onClick: ButtonClickHandler;
  readonly conversationKey: string;
  readonly expiresAt: number;
}

export interface JsxButtonBatch {
  bind(props: ButtonProps): Segment;
  /** Publish callbacks immediately before transport; revoke them on definitive non-delivery. */
  activate(payloads: ReadonlySet<string>): () => void;
}

/** Plugin-incarnation-owned callbacks: survive unrelated plugin HMR; retired when owning plugin reloads. */
export class JsxButtonRegistry {
  readonly #bindings = new Map<string, ButtonBinding>();

  prepare(request: SendRequest, snapshot: RuntimeSnapshot): JsxButtonBatch {
    const pending = new Map<string, ButtonBinding>();
    const node = snapshot.tree.get(request.requester);
    const signal = request[operationEndpoint]?.signal;
    return {
      bind: (props) => {
        const { onClick, payload: manualPayload, children, label, id, ...options } = props;
        if (onClick !== undefined && typeof onClick !== 'function') throw new TypeError('Button onClick must be a function');
        if (onClick && manualPayload !== undefined) throw new TypeError('Button accepts onClick or payload, not both');
        if (!onClick && typeof manualPayload !== 'string') throw new TypeError('Button requires onClick or payload');
        const payload = onClick ? `${JSX_BUTTON_PREFIX}${randomUUID()}` : manualPayload!;
        if (onClick && !props.disabled) pending.set(payload, {
          onClick,
          requester: request.requester,
          snapshot,
          node,
          ...(signal ? { signal } : {}),
          conversationKey: conversationRefKey(request.conversation),
          expiresAt: 0,
        });
        return { type: 'keyboard', data: { rows: [[{
          ...options,
          id: id ?? randomUUID(),
          label: label ?? children,
          payload,
          ...(onClick ? { mode: 'callback' } : {}),
        }]] } };
      },
      activate: (payloads) => {
        const activated: string[] = [];
        this.#prune(snapshot);
        for (const [payload, binding] of pending) {
          if (!payloads.has(payload)) continue;
          this.#bindings.set(payload, { ...binding, expiresAt: Date.now() + JSX_BUTTON_TTL_MS });
          activated.push(payload);
        }
        pending.clear();
        return () => { for (const payload of activated) this.#bindings.delete(payload); };
      },
    };
  }

  async dispatch(message: Message, payload: string, snapshot: RuntimeSnapshot): Promise<boolean> {
    if (!isJsxButtonPayload(payload)) return false;
    this.#prune(snapshot);
    const binding = this.#bindings.get(payload);
    // Never invoke a retired closure. The reply uses this incoming operation's scope.
    if (!binding || !isPluginIncarnationAlive(binding, snapshot)) {
      if (binding) this.#bindings.delete(payload);
      await message.$reply(t(message.locale, 'expired'));
      return true;
    }
    if (binding.conversationKey !== conversationRefKey(message.conversation)) return true;
    const bound = bindOperationInput(message, binding.requester, snapshot);
    const content = await binding.onClick(bound);
    if (typeof content === 'number') await bound.$reply(jsx('text', { text: String(content) }));
    else if (content != null && typeof content !== 'boolean') await bound.$reply(content);
    return true;
  }

  #prune(currentSnapshot?: RuntimeSnapshot): void {
    const now = Date.now();
    for (const [payload, binding] of this.#bindings) {
      if (binding.expiresAt <= now || (currentSnapshot && !isPluginIncarnationAlive(binding, currentSnapshot))) {
        this.#bindings.delete(payload);
      }
    }
  }
}

export function collectButtonPayloads(payload: unknown): Set<string> {
  const result = new Set<string>();
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    if (isKeyboardSegment(item)) {
      for (const row of item.data.rows) for (const button of row) result.add(button.payload);
    }
  }
  return result;
}

const DEFAULT_FALLBACK_TTL_MS = 60 * 60 * 1000;

type RuntimeInteractiveHandler = (message: Message) => Promise<boolean> | boolean;

export interface InteractiveRouterOptions {
  readonly fallbackTtlMs?: number;
  /**
   * Scope for auto-allocated numeric fallback labels (`1`, `2`, ...).
   * - `'router'` (default): shared monotonic counter across the router instance.
   * - `'conversation'`: independent monotonic counter per conversation.
   */
  readonly numberingScope?: 'router' | 'conversation';
}

export interface RememberFallbackContext {
  readonly ttlMs?: number;
  readonly incarnation?: PluginIncarnationRef;
}

export interface ResolveFallbackContext {
  readonly fallbackGeneration?: number;
  readonly snapshot?: RuntimeSnapshot;
}

interface RegisteredRuntimeInteractiveHandler<Admission> {
  readonly prefix: string;
  readonly handler: RuntimeInteractiveHandler;
  readonly admission?: Admission;
}

interface InteractiveFallbackEntry {
  readonly generation: number;
  readonly incarnation?: PluginIncarnationRef;
  readonly map: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

interface ExpiredFallbackEntry {
  readonly conversationKey: string;
  readonly map: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

const MAX_EXPIRED_BATCHES = 1000;

/**
 * One ImRuntime-owned authority for interactive routing and keyboard fallback state.
 * No handler or conversation state escapes to another runtime instance.
 */
export class RuntimeInteractiveRouter<Admission = never> {
  readonly #handlers: RegisteredRuntimeInteractiveHandler<Admission>[] = [];
  readonly #fallbacks = new Map<string, InteractiveFallbackEntry[]>();
  readonly #expired: ExpiredFallbackEntry[] = [];
  readonly #conversationNumbers = new Map<string, number>();
  readonly #fallbackTtlMs: number;
  readonly #numberingScope: 'router' | 'conversation';

  #nextNumber = 1;

  constructor(
    optionsOrTtlMs: number | InteractiveRouterOptions = DEFAULT_FALLBACK_TTL_MS,
    options?: InteractiveRouterOptions,
  ) {
    if (typeof optionsOrTtlMs === 'number') {
      this.#fallbackTtlMs = optionsOrTtlMs;
      this.#numberingScope = options?.numberingScope ?? 'router';
    } else {
      this.#fallbackTtlMs = optionsOrTtlMs.fallbackTtlMs ?? DEFAULT_FALLBACK_TTL_MS;
      this.#numberingScope = optionsOrTtlMs.numberingScope ?? 'router';
    }
  }

  register(
    prefix: string,
    handler: RuntimeInteractiveHandler,
    admission?: Admission,
  ): () => void {
    if (!prefix) throw new TypeError('Interactive handler prefix must not be empty');
    const entry: RegisteredRuntimeInteractiveHandler<Admission> = Object.freeze({
      prefix,
      handler,
      admission,
    });
    this.#handlers.push(entry);
    return () => {
      const index = this.#handlers.indexOf(entry);
      if (index >= 0) this.#handlers.splice(index, 1);
    };
  }

  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
    ttlMsOrContext?: number | RememberFallbackContext | PluginIncarnationRef,
  ): Record<string, string> {
    this.#pruneFallbacks();
    const ttlMs = typeof ttlMsOrContext === 'number'
      ? ttlMsOrContext
      : (ttlMsOrContext && 'ttlMs' in ttlMsOrContext && ttlMsOrContext.ttlMs !== undefined
        ? ttlMsOrContext.ttlMs
        : this.#fallbackTtlMs);
    const incarnation = ttlMsOrContext && typeof ttlMsOrContext === 'object'
      ? ('requester' in ttlMsOrContext && 'snapshot' in ttlMsOrContext
        ? ttlMsOrContext
        : ttlMsOrContext.incarnation)
      : undefined;
    const key = conversationRefKey(conversation);
    const entries = this.#fallbacks.get(key) ?? [];
    if (this.#numberingScope === 'conversation'
      && !entries.some(entry => this.#isEntryLive(entry, generation, incarnation?.snapshot))) {
      this.#conversationNumbers.delete(key);
    }
    const allocated: Record<string, string> = {};
    for (const [label, payload] of Object.entries(map)) {
      allocated[/^\d+$/.test(label) ? String(this.#allocateNumber(key)) : label] = payload;
    }
    entries.push(Object.freeze({
      generation,
      ...(incarnation ? { incarnation } : {}),
      map: Object.freeze({ ...allocated }),
      expiresAt: Date.now() + ttlMs,
    }));
    this.#fallbacks.set(key, entries);
    return allocated;
  }

  /**
   * Content-aware probe for Room routing: would this input resolve against an unexpired keyboard
   * fallback on this exact (Endpoint-scoped) conversation and generation? A live keyboard alone is
   * not an answer. With an action segment, only a payload that belongs to one of this
   * conversation's live fallback maps counts; plain text counts only when its label / number maps
   * to a button. Strictly read-only: it never calls `#pruneFallbacks()` and never mutates state;
   * expired entries are simply ignored.
   */
  resolvesLiveFallback(
    conversation: ConversationRef,
    generation: number,
    input: { readonly content: string; readonly segments?: readonly Segment[] },
    snapshot?: RuntimeSnapshot,
  ): boolean {
    const now = Date.now();
    const entries = this.#fallbacks.get(conversationRefKey(conversation));
    const live = entries?.filter(entry => entry.expiresAt > now && this.#isEntryLive(entry, generation, snapshot));
    if (!live?.length) return false;
    const actionPayload = actionPayloadFromSegments(input.segments);
    if (actionPayload !== undefined) {
      return live.some(entry => Object.values(entry.map).includes(actionPayload));
    }
    const raw = input.content.trim();
    if (!raw) return false;
    return resolvePayloadFromText(raw, Object.assign({}, ...live.map(entry => entry.map))) !== undefined;
  }

  resolvePayload(
    message: Message,
    contextOrFallbackGeneration?: number | RuntimeSnapshot | ResolveFallbackContext,
    explicitSnapshot?: RuntimeSnapshot,
  ): string | undefined {
    const fromSegments = actionPayloadFromSegments(message.segments);
    if (fromSegments) return fromSegments;
    const raw = message.content.trim();
    if (!raw) return undefined;
    let fallbackGeneration = message.generation;
    let snapshot = explicitSnapshot;
    if (typeof contextOrFallbackGeneration === 'number') {
      fallbackGeneration = contextOrFallbackGeneration;
    } else if (contextOrFallbackGeneration && typeof contextOrFallbackGeneration === 'object') {
      if ('tree' in contextOrFallbackGeneration && 'generation' in contextOrFallbackGeneration) {
        snapshot = contextOrFallbackGeneration;
      } else {
        if (contextOrFallbackGeneration.fallbackGeneration !== undefined) {
          fallbackGeneration = contextOrFallbackGeneration.fallbackGeneration;
        }
        if (contextOrFallbackGeneration.snapshot !== undefined) {
          snapshot = contextOrFallbackGeneration.snapshot;
        }
      }
    }
    return resolvePayloadFromText(
      raw,
      this.#fallbackMap(message.conversation, message.generation, snapshot)
        ?? (fallbackGeneration !== message.generation
          ? this.#fallbackMap(message.conversation, fallbackGeneration, snapshot)
          : undefined),
    );
  }

  /** Bounded label-only history: stale text buttons are not mistaken for new input. */
  isExpiredFallback(
    message: Message,
    snapshot?: RuntimeSnapshot,
    options?: { readonly ignoreTtlExpiredBareGroupNumbers?: boolean },
  ): boolean {
    if (actionPayloadFromSegments(message.segments) || this.resolvePayload(message, { snapshot })) return false;
    const key = conversationRefKey(message.conversation);
    const matches = (map: Readonly<Record<string, string>>) =>
      resolvePayloadFromText(message.content, map) !== undefined;
    const ignoreTtlExpired = options?.ignoreTtlExpiredBareGroupNumbers === true
      && message.conversation.kind !== 'private'
      && /^\d+$/u.test(message.content.trim())
      && !(message.segments ?? []).some(
        segment => segment.type === 'mention'
          || segment.type === 'at'
          || segment.type === 'reply'
          || segment.type === 'action',
      );
    const now = Date.now();
    if (!ignoreTtlExpired && this.#expired.some(entry => entry.conversationKey === key && matches(entry.map))) return true;
    // A generation change (or owning plugin reload) invalidates even a keyboard whose TTL has not elapsed.
    const entries = this.#fallbacks.get(key);
    if (entries?.some(entry =>
      (!ignoreTtlExpired || entry.expiresAt > now)
      && !this.#isEntryLive(entry, message.generation, snapshot)
      && matches(entry.map))) {
      return true;
    }
    return false;
  }

  async dispatch(message: Message, admission?: Admission, snapshot?: RuntimeSnapshot): Promise<boolean> {
    const payload = this.resolvePayload(message, { snapshot });
    if (!payload) return false;
    let match: RegisteredRuntimeInteractiveHandler<Admission> | undefined;
    for (const entry of this.#handlers) {
      if (entry.admission && entry.admission !== admission) continue;
      if (payload.startsWith(entry.prefix)
        && (!match || entry.prefix.length > match.prefix.length)) {
        match = entry;
      }
    }
    return match ? Boolean(await match.handler(message)) : false;
  }

  #allocateNumber(conversationKey: string): number {
    if (this.#numberingScope === 'conversation') {
      const next = this.#conversationNumbers.get(conversationKey) ?? 1;
      this.#conversationNumbers.set(conversationKey, next + 1);
      if (this.#conversationNumbers.size > MAX_EXPIRED_BATCHES) {
        const oldest = this.#conversationNumbers.keys().next().value;
        if (oldest !== undefined) this.#conversationNumbers.delete(oldest);
      }
      return next;
    }
    return this.#nextNumber++;
  }

  #isEntryLive(
    entry: InteractiveFallbackEntry,
    generation: number,
    snapshot?: RuntimeSnapshot,
  ): boolean {
    if (entry.incarnation && snapshot) {
      return isPluginIncarnationAlive(entry.incarnation, snapshot);
    }
    if (entry.incarnation?.signal?.aborted) {
      return false;
    }
    return entry.generation === generation;
  }

  #fallbackMap(
    conversation: ConversationRef,
    generation: number,
    snapshot?: RuntimeSnapshot,
  ): Readonly<Record<string, string>> | undefined {
    const key = conversationRefKey(conversation);
    this.#pruneFallbacks();
    const entries = this.#fallbacks.get(key)?.filter(entry => this.#isEntryLive(entry, generation, snapshot));
    return entries?.length ? Object.assign({}, ...entries.map(entry => entry.map)) : undefined;
  }

  #pruneFallbacks(): void {
    const now = Date.now();
    for (const [key, entries] of this.#fallbacks) {
      const active = entries.filter(entry => entry.expiresAt > now);
      for (const entry of entries) {
        if (entry.expiresAt > now || entry.expiresAt + this.#fallbackTtlMs <= now) continue;
        this.#expired.push({
          conversationKey: key,
          map: Object.freeze(Object.fromEntries(Object.keys(entry.map).map(label => [label, 'expired']))),
          expiresAt: entry.expiresAt + this.#fallbackTtlMs,
        });
      }
      if (active.length) this.#fallbacks.set(key, active);
      else this.#fallbacks.delete(key);
    }
    for (let i = this.#expired.length - 1; i >= 0; i--) {
      if (this.#expired[i]!.expiresAt <= now) this.#expired.splice(i, 1);
    }
    if (this.#expired.length > MAX_EXPIRED_BATCHES) this.#expired.splice(0, this.#expired.length - MAX_EXPIRED_BATCHES);
  }
}

/** @internal Payload of the first action segment (platform callback) that carries a non-empty string. */
export function actionPayloadFromSegments(segments: readonly Segment[] | undefined): string | undefined {
  for (const segment of segments ?? []) {
    if (segment.type !== 'action') continue;
    const payload = (segment.data as { payload?: unknown } | undefined)?.payload;
    if (typeof payload === 'string' && payload) return payload;
  }
  return undefined;
}
