import { normalizeDeliveryTarget, type DeliveryTarget } from './delivery-target.js';
import type { PluginId } from './identity.js';
import type { GenerationAdmissionGate } from './admission.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type StateScope =
  | Readonly<{ kind: 'plugin' }>
  | Readonly<{ kind: 'user'; endpoint: DeliveryTarget['endpoint']; senderId: string }>
  | Readonly<{ kind: 'conversation'; target: DeliveryTarget }>;

/** Opaque database revision, including expired rows so updates cannot resurrect stale values. */
export interface StateRecord {
  readonly revision: string;
  readonly value: JsonValue;
  readonly expiresAt: number | null;
}

/** Process-owned port backed by the existing database, never an in-memory persistence fallback. */
export interface PersistentStatePort {
  read(owner: PluginId, scope: StateScope, key: string): Promise<StateRecord | undefined>;
  compareExchange(owner: PluginId, scope: StateScope, key: string, revision: string | undefined,
    value: JsonValue | undefined, expiresAt: number | null): Promise<boolean>;
}

export interface StateWriteOptions {
  /** Milliseconds from this write attempt; omission stores without expiry. */
  readonly ttlMs?: number;
}

/** Owner-bound small-object state. Updaters must be pure: contention can replay them. */
export class PluginStateStore {
  readonly #owner: PluginId;
  readonly #port: PersistentStatePort;
  readonly #scope: StateScope;
  readonly #admission?: GenerationAdmissionGate;

  constructor(owner: PluginId, port: PersistentStatePort,
    scope: StateScope = Object.freeze({ kind: 'plugin' }), admission?: GenerationAdmissionGate) {
    this.#owner = owner;
    this.#port = port;
    this.#scope = scope;
    this.#admission = admission;
  }

  get owner(): PluginId { return this.#owner; }

  forUser(endpoint: DeliveryTarget['endpoint'], senderId: string): PluginStateStore {
    if (!senderId) throw new TypeError('State senderId must be nonempty');
    const canonical = normalizeDeliveryTarget({ endpoint, kind: 'private', id: senderId });
    return new PluginStateStore(this.#owner, this.#port,
      Object.freeze({ kind: 'user', endpoint: canonical.endpoint, senderId }), this.#admission);
  }

  forConversation(target: DeliveryTarget): PluginStateStore {
    return new PluginStateStore(this.#owner, this.#port,
      Object.freeze({ kind: 'conversation', target: normalizeDeliveryTarget(target) }), this.#admission);
  }

  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    return this.#withAdmission(async () => {
      assertKey(key);
      const record = await this.#port.read(this.#owner, this.#scope, key);
      return record && (record.expiresAt === null || record.expiresAt > Date.now())
        ? copyJson(record.value) as T : undefined;
    });
  }

  async set<T extends JsonValue>(key: string, value: T, options?: StateWriteOptions): Promise<void> {
    const json = copyJson(value);
    await this.update(key, () => json, options);
  }

  async delete(key: string): Promise<void> {
    await this.update(key, () => undefined);
  }

  async update<T extends JsonValue = JsonValue>(key: string,
    updater: (current: T | undefined) => T | undefined,
    options?: StateWriteOptions): Promise<T | undefined> {
    return this.#withAdmission(async () => {
      assertKey(key);
      const ttl = options?.ttlMs;
      if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl <= 0)) throw new TypeError('ttlMs must be a positive integer');
      for (let attempt = 0; attempt < 64; attempt++) {
        const record = await this.#port.read(this.#owner, this.#scope, key);
        const live = record && (record.expiresAt === null || record.expiresAt > Date.now());
        const next = updater(live ? copyJson(record.value) as T : undefined);
        const value = next === undefined ? undefined : copyJson(next);
        const expiresAt = ttl === undefined ? null : Date.now() + ttl;
        if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) throw new TypeError('ttlMs exceeds supported time range');
        if (await this.#port.compareExchange(this.#owner, this.#scope, key, record?.revision, value, expiresAt)) {
          return value === undefined ? undefined : copyJson(value) as T;
        }
      }
      throw new Error('Persistent state update contention exceeded 64 retries; retry the operation');
    });
  }

  async #withAdmission<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.#admission) return operation();
    const release = this.#admission.acquire();
    if (!release) throw new Error('Persistent state operation belongs to an inactive generation');
    try { return await operation(); }
    finally { release(); }
  }
}

function assertKey(key: string): void {
  if (!key || key.length > 256) throw new TypeError('State key must contain 1–256 characters');
}

/** Reject lossy JSON conversions instead of silently losing a Date, NaN, undefined or callback. */
export function copyJson(value: JsonValue): JsonValue {
  const ancestors = new Set<object>();
  const visit = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') throw new TypeError('Persistent state must be JSON-safe');
    if (ancestors.has(item)) throw new TypeError('Persistent state must not contain cycles');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Persistent state objects must be plain JSON objects');
    }
    ancestors.add(item);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Persistent state must contain ordinary enumerable JSON properties');
      if (Array.isArray(item) && (!/^\d+$/u.test(key) || String(Number(key)) !== key || Number(key) >= item.length)) {
        throw new TypeError('Persistent state arrays must contain only indexed JSON values');
      }
    }
    for (const child of Array.isArray(item) ? item : Object.values(item)) visit(child);
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Persistent state must not contain symbol properties');
    ancestors.delete(item);
  };
  visit(value);
  const serialized = JSON.stringify(value);
  // MySQL TEXT has a 65535-byte limit. Keep the same contract on every supported dialect.
  if (new TextEncoder().encode(serialized).byteLength >= 64 * 1024) throw new TypeError('Persistent state value must be below 64 KiB');
  return JSON.parse(serialized) as JsonValue;
}
