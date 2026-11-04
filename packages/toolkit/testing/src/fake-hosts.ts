import { randomUUID } from 'node:crypto';
import type {
  DatabaseHost, DatabaseHostModel, DatabaseHostSelection, DeliveryTarget, JsonValue,
  OutboundEditInput, OutboundReactionInput, OutboundRecallInput, OutboundRootHost, OutboundSendInput,
  OutboundTypingInput, PersistentStatePort, PluginId, StateRecord, StateScope,
} from 'zhin.js/plugin-runtime';

type Row = Record<string, unknown>;
const matches = (row: Row, query: Row): boolean => Object.entries(query).every(([k, v]) => row[k] === v);

class MemoryModel implements DatabaseHostModel {
  readonly rows: Row[] = [];

  select<Fields extends string[]>(...fields: Fields): DatabaseHostSelection {
    let query: Row = {};
    let order: { field: string; direction: 'ASC' | 'DESC' } | undefined;
    let max = Infinity;
    const run = (): Row[] => {
      let out = this.rows.filter(row => matches(row, query));
      if (order) {
        const { field, direction } = order;
        out = [...out].sort((a, b) => ((a[field] as never) < (b[field] as never) ? -1
          : (a[field] as never) > (b[field] as never) ? 1 : 0) * (direction === 'DESC' ? -1 : 1));
      }
      return out.slice(0, max).map(row => fields.length === 0 ? { ...row }
        : Object.fromEntries(fields.map(f => [f, row[f]])));
    };
    const selection: DatabaseHostSelection = {
      where: (q) => { query = { ...query, ...q }; return selection; },
      orderBy: (field, direction = 'ASC') => { order = { field, direction }; return selection; },
      limit: (count) => { max = count; return selection; },
      then: (ok, bad) => Promise.resolve().then(run).then(ok, bad),
    };
    return selection;
  }

  async insert(row: Row): Promise<unknown> { this.rows.push({ ...row }); return undefined; }
  delete(): { where(query: Row): Promise<unknown> } {
    return { where: async (query: Row) => {
      for (let i = this.rows.length - 1; i >= 0; i--) if (matches(this.rows[i]!, query)) this.rows.splice(i, 1);
    } };
  }
  update(patch: Row): { where(query: Row): Promise<unknown> } {
    return { where: async (query: Row) => { for (const row of this.rows) if (matches(row, query)) Object.assign(row, patch); } };
  }
  async count(where: Row = {}): Promise<number> { return this.rows.filter(row => matches(row, where)).length; }
}

class MemoryState implements PersistentStatePort {
  readonly #entries = new Map<string, StateRecord>();
  static key(owner: PluginId, scope: StateScope, key: string): string { return JSON.stringify([owner, scope, key]); }

  async read(owner: PluginId, scope: StateScope, key: string): Promise<StateRecord | undefined> {
    return this.#entries.get(MemoryState.key(owner, scope, key));
  }
  async compareExchange(owner: PluginId, scope: StateScope, key: string, revision: string | undefined,
    value: JsonValue | undefined, expiresAt: number | null): Promise<boolean> {
    const id = MemoryState.key(owner, scope, key);
    if (this.#entries.get(id)?.revision !== revision) return false;
    if (value === undefined) this.#entries.delete(id);
    else this.#entries.set(id, { revision: randomUUID(), value: JSON.parse(JSON.stringify(value)) as JsonValue, expiresAt });
    return true;
  }
}

/**
 * Process-wide in-memory Database Host. Tables appear on `define()` (plugins define in `setup`);
 * `where` is equality-only, there are no SQL semantics. `state` is a real compare-exchange port, so
 * `PluginStateStore` behaves as in production (TTL uses the real `Date.now()`).
 */
export class FakeDatabaseRootHost implements DatabaseHost {
  readonly dialect = 'memory';
  started = true;
  readonly state: PersistentStatePort = new MemoryState();
  readonly #models = new Map<string, MemoryModel>();
  readonly models = { get: (name: string): DatabaseHostModel | undefined => this.#models.get(name) };

  define(name: string, _definition: Record<string, unknown>): void {
    if (!this.#models.has(name)) this.#models.set(name, new MemoryModel());
  }
  tables(): readonly string[] { return [...this.#models.keys()]; }
  getRawDatabase(): undefined { return undefined; }
  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }
  /** Rows by physical (owner-qualified) table name. */
  rowsOf(physical: string): readonly Row[] { return this.#models.get(physical)?.rows ?? []; }
}

export interface FakeOutboundCall {
  readonly kind: 'send' | 'sendTarget' | 'addReaction' | 'removeReaction' | 'recall' | 'edit' | 'typing';
  readonly input: unknown;
  /** Present for `sendTarget`: the sending plugin, as bound by the real facade. */
  readonly requester?: PluginId;
  readonly id: string | null;
}

/**
 * Records proactive sends. It stands in for the Root outbound port, so the real `PluginOutboundHost`
 * facade (owner binding) still wraps it. It does NOT run the renderer/middleware chain; for that use
 * `PluginTestKit` with a synthetic endpoint.
 */
export class FakeOutboundRootHost implements OutboundRootHost {
  readonly calls: FakeOutboundCall[] = [];
  #failure: unknown;
  #nextId = 1;

  /** Make the next outbound operation reject once. */
  failNext(error: unknown = new Error('fake outbound failure')): void { this.#failure = error; }

  #record(kind: FakeOutboundCall['kind'], input: unknown, requester?: PluginId, hasId = true): Promise<string | null> {
    if (this.#failure !== undefined) {
      const error = this.#failure;
      this.#failure = undefined;
      return Promise.reject(error);
    }
    const id = hasId ? `fake-${this.#nextId++}` : null;
    this.calls.push(Object.freeze({ kind, input, ...(requester === undefined ? {} : { requester }), id }));
    return Promise.resolve(id);
  }

  send(input: OutboundSendInput): Promise<string | null> { return this.#record('send', input); }
  sendTarget(target: DeliveryTarget, content: unknown, requester: PluginId, options?: Readonly<{ locale?: import('@zhin.js/plugin-runtime').Locale }>): Promise<string | null> {
    return this.#record('sendTarget', { target, content, ...(options?.locale ? { locale: options.locale } : {}) }, requester);
  }
  addReaction(input: OutboundReactionInput): Promise<string | null> { return this.#record('addReaction', input); }
  async removeReaction(input: unknown): Promise<void> { await this.#record('removeReaction', input, undefined, false); }
  async recall(input: OutboundRecallInput): Promise<void> { await this.#record('recall', input, undefined, false); }
  edit(input: OutboundEditInput): Promise<string | null> { return this.#record('edit', input); }
  async typing(input: OutboundTypingInput): Promise<void> { await this.#record('typing', input, undefined, false); }
  runWithView<T>(operation: () => Promise<T>): Promise<T> { return operation(); }
}
