import { conversationRefKey } from 'zhin.js';
import { subscriptionDocument } from './migration-document.js';
import { normalizeDeliveryTarget, type DeliveryTarget, type JsonValue, type TargetMigrationScopes } from 'zhin.js/plugin-runtime';
import { resolveLocale, type Locale } from 'zhin.js/i18n';
/**
 * Conversation subscriptions, one per conversation.
 *
 * Persisted as a single JSON document in the plugin's database state when a
 * database is configured, otherwise kept in memory (lost on restart). Mutations
 * are serialised so concurrent commands cannot lose each other's writes, and
 * malformed stored entries are dropped on load instead of breaking the poller.
 */
import { isRecord, toFiniteNumber, toTrimmedString } from './sources/parse-helpers.js';

export type ConversationKind = 'private' | 'group' | 'channel';

export interface EarthquakeSubscription {
  /** Present on canonical captures; historical alias-only rows remain unchanged until migration is approved. */
  readonly target?: DeliveryTarget;
  readonly locale?: Locale;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversationKind: ConversationKind;
  readonly conversationId: string;
  readonly minMagnitude: number;
  readonly regions: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Minimal key-value surface; `PluginStateStore` from the database host satisfies it. */
export interface KeyValueState {
  get(key: string): Promise<unknown>;
  set(key: string, value: never): Promise<void>;
  update?<T extends JsonValue>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined>;
}

export const SUBSCRIPTIONS_STATE_KEY = 'subscriptions/v1';

export function subscriptionKey(target: Pick<EarthquakeSubscription, 'adapter' | 'endpointKey' | 'conversationKind' | 'conversationId' | 'target'>): string {
  if (target.target) return `canonical:${conversationRefKey(target.target)}`;
  return [target.adapter, target.endpointKey, target.conversationKind, target.conversationId].join('\u0000');
}

function isConversationKind(value: unknown): value is ConversationKind {
  return value === 'private' || value === 'group' || value === 'channel';
}

function parseStoredSubscription(value: unknown): EarthquakeSubscription | undefined {
  if (!isRecord(value)) return undefined;
  const adapter = toTrimmedString(value.adapter);
  const endpointKey = toTrimmedString(value.endpointKey);
  const conversationId = toTrimmedString(value.conversationId);
  const minMagnitude = toFiniteNumber(value.minMagnitude);
  if (!adapter || !endpointKey || !conversationId || minMagnitude === undefined) return undefined;
  if (!isConversationKind(value.conversationKind)) return undefined;
  const regions = Array.isArray(value.regions)
    ? value.regions.filter((region): region is string => typeof region === 'string' && region.trim() !== '')
    : [];
  return {
    ...(value.target === undefined ? {} : { target: normalizeDeliveryTarget(value.target) }),
    adapter,
    locale: resolveLocale(value.locale),
    endpointKey,
    conversationKind: value.conversationKind,
    conversationId,
    minMagnitude,
    regions,
    createdBy: toTrimmedString(value.createdBy) ?? '',
    createdAt: toTrimmedString(value.createdAt) ?? '',
  };
}

export function createMemoryState(): KeyValueState {
  const values = new Map<string, unknown>();
  return {
    async get(key: string) {
      return structuredClone(values.get(key));
    },
    async set(key: string, value: never) {
      values.set(key, structuredClone(value));
    },
  };
}

export class SubscriptionStore {
  readonly #state: KeyValueState;
  readonly #maxSubscriptions: number;
  #queue: Promise<unknown> = Promise.resolve();
  #migrationScopes?: TargetMigrationScopes;

  constructor(state: KeyValueState, options: { readonly maxSubscriptions: number }) {
    this.#state = state;
    this.#maxSubscriptions = options.maxSubscriptions;
  }

  bindMigrationScopes(scopes: TargetMigrationScopes): void { this.#migrationScopes = scopes; }

  async list(): Promise<EarthquakeSubscription[]> {
    const value = await this.#state.get(SUBSCRIPTIONS_STATE_KEY);
    const stored = Array.isArray(value) ? value : subscriptionDocument(value).subscriptions;
    const subscriptions: EarthquakeSubscription[] = [];
    for (const entry of stored) {
      const parsed = parseStoredSubscription(entry);
      if (parsed) subscriptions.push(parsed);
    }
    return subscriptions;
  }

  async get(key: string): Promise<EarthquakeSubscription | undefined> {
    const all = await this.list();
    return all.find((subscription) => subscriptionKey(subscription) === key);
  }

  /** Creates or replaces this conversation's subscription. */
  async upsert(subscription: EarthquakeSubscription): Promise<{ readonly created: boolean }> {
    const key = subscriptionKey(subscription);
    return this.#run(key, () => this.#serialize(() => this.#mutate(all => {
      const index = all.findIndex(existing => subscriptionKey(existing) === key);
      if (index === -1 && all.length >= this.#maxSubscriptions) throw new SubscriptionLimitError(this.#maxSubscriptions);
      if (index === -1) all.push(subscription);
      else all[index] = { ...subscription, locale: resolveLocale(all[index]?.locale) };
      return { subscriptions: all, result: { created: index === -1 } };
    })));
  }

  async remove(key: string): Promise<boolean> {
    return this.#run(key, () => this.#serialize(() => this.#mutate(all => {
      const subscriptions = all.filter(subscription => subscriptionKey(subscription) !== key);
      return { subscriptions, result: subscriptions.length !== all.length };
    })));
  }

  async #mutate<T>(change: (subscriptions: EarthquakeSubscription[]) => { subscriptions: EarthquakeSubscription[]; result: T }): Promise<T> {
    if (!this.#state.update) {
      const changed = change(await this.list());
      await this.#state.set(SUBSCRIPTIONS_STATE_KEY, changed.subscriptions as never);
      return changed.result;
    }
    let result!: T;
    await this.#state.update(SUBSCRIPTIONS_STATE_KEY, current => {
      const document = subscriptionDocument(current);
      const all = document.subscriptions.flatMap(value => { const item = parseStoredSubscription(value); return item ? [item] : []; });
      const changed = change(all); result = changed.result;
      const subscriptions = changed.subscriptions.map(subscription => ({ ...subscription, regions: [...subscription.regions] })) as unknown as JsonValue[];
      return Array.isArray(current) || current === undefined ? subscriptions : { ...document, subscriptions } as unknown as JsonValue;
    });
    return result;
  }

  #run<T>(scope: string, run: () => Promise<T>): Promise<T> {
    return this.#migrationScopes ? this.#migrationScopes.run({ scope, run }) : run();
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }
}

export class SubscriptionLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`订阅总数已达上限（${limit}），请联系管理员调整 maxSubscriptions`);
    this.name = 'SubscriptionLimitError';
    this.limit = limit;
  }
}
