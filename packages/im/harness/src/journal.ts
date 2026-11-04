/**
 * Engagement journal implementations (ADR 0048 §3.5).
 *
 * Depends on `contracts.ts` only. The database store targets a narrow query
 * interface (`EngagementJournalDatabase`) that `@zhin.js/database` satisfies,
 * so the host registers `ENGAGEMENT_EVENT_MODEL` and passes its database in.
 */
import {
  DEFAULT_JOURNAL_RETENTION,
  JournalFullError,
  type EngagementEvent,
  type EngagementId,
  type EngagementJournal,
  type JournalRetention,
} from './contracts.js';

export interface JournalOptions {
  readonly retention?: JournalRetention;
}

type AppendInput = Omit<EngagementEvent, 'seq'>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Deep-copies a JSON value, throwing TypeError for anything JSON cannot round-trip. */
function cloneJson(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Journal data at ${path} is not a finite number`);
      return value;
    case 'object':
      break;
    default:
      throw new TypeError(`Journal data at ${path} is not JSON-serializable (${typeof value})`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new TypeError(`Journal data at ${path} contains a cycle`);
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item, i) => cloneJson(item, `${path}[${i}]`, seen));
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`Journal data at ${path} is not a plain object`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(obj)) {
      out[key] = cloneJson(item, `${path}.${key}`, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as object)) deepFreeze(item);
  }
  return value;
}

function buildEvent(input: AppendInput, seq: number, data: Record<string, unknown>): EngagementEvent {
  return deepFreeze({
    engagementId: input.engagementId,
    seq,
    at: input.at,
    type: input.type,
    data,
  });
}

function validateInput(input: AppendInput): Record<string, unknown> {
  if (typeof input.engagementId !== 'string' || input.engagementId === '') {
    throw new TypeError('engagementId must be a non-empty string');
  }
  if (!Number.isFinite(input.at)) throw new TypeError('at must be a finite number');
  const data = cloneJson(input.data, 'data', new Set());
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('data must be a JSON object');
  }
  return data as Record<string, unknown>;
}

/** Runs tasks one at a time per key, in call order. */
class KeyedSerializer {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const result = prev.then(task, task);
    const tail = result.catch(() => undefined);
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export class InMemoryEngagementJournal implements EngagementJournal {
  readonly #retention: JournalRetention;
  readonly #events = new Map<EngagementId, EngagementEvent[]>();
  readonly #serial = new KeyedSerializer();

  constructor(options: JournalOptions = {}) {
    this.#retention = options.retention ?? DEFAULT_JOURNAL_RETENTION;
  }

  append(event: AppendInput): Promise<EngagementEvent> {
    let data: Record<string, unknown>;
    try {
      data = validateInput(event);
    } catch (error) {
      return Promise.reject(error);
    }
    const input = { ...event };
    return this.#serial.run(input.engagementId, async () => {
      const list = this.#events.get(input.engagementId) ?? [];
      if (list.length >= this.#retention.maxEventsPerEngagement) {
        throw new JournalFullError(input.engagementId, this.#retention.maxEventsPerEngagement);
      }
      const stored = buildEvent(input, list.length, data);
      list.push(stored);
      this.#events.set(input.engagementId, list);
      return stored;
    });
  }

  async read(engagementId: EngagementId): Promise<readonly EngagementEvent[]> {
    return Object.freeze([...(this.#events.get(engagementId) ?? [])]);
  }

  async prune(now: number): Promise<number> {
    const cutoff = now - this.#retention.maxAgeMs;
    let removed = 0;
    for (const [id, list] of this.#events) {
      const last = list[list.length - 1];
      if (last !== undefined && last.at < cutoff) {
        this.#events.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Database-backed
// ---------------------------------------------------------------------------

export const ENGAGEMENT_EVENTS_TABLE = 'engagement_events';

/**
 * Table schema. `id` (`<engagement_id>:<seq>`) is the primary key and therefore
 * the unique (engagement_id, seq) constraint: `@zhin.js/database` column
 * definitions have no composite unique key.
 */
export const ENGAGEMENT_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  engagement_id: { type: 'text' as const, nullable: false },
  seq: { type: 'integer' as const, nullable: false },
  at: { type: 'bigint' as const, nullable: false },
  type: { type: 'text' as const, nullable: false },
  data: { type: 'text' as const, nullable: false },
};

/** Registers the table on a `@zhin.js/database` instance. */
export function defineEngagementEventModel(
  database: Readonly<{ define(name: string, definition: unknown): unknown }>,
): void {
  database.define(ENGAGEMENT_EVENTS_TABLE, ENGAGEMENT_EVENT_MODEL);
}

/** The slice of `@zhin.js/database`'s `Database` the journal uses. */
export interface EngagementJournalDatabase {
  select(table: string, fields: string[]): {
    where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]>;
  };
  insert(table: string, row: Record<string, unknown>): PromiseLike<unknown>;
  delete(table: string, condition: Record<string, unknown>): PromiseLike<unknown>;
}

export interface DatabaseJournalOptions extends JournalOptions {
  /** Bounded retries when another process wins a seq (default 5). */
  readonly maxConflictRetries?: number;
}

export class DatabaseEngagementJournal implements EngagementJournal {
  readonly #db: EngagementJournalDatabase;
  readonly #retention: JournalRetention;
  readonly #maxRetries: number;
  readonly #serial = new KeyedSerializer();

  constructor(database: EngagementJournalDatabase, options: DatabaseJournalOptions = {}) {
    this.#db = database;
    this.#retention = options.retention ?? DEFAULT_JOURNAL_RETENTION;
    this.#maxRetries = options.maxConflictRetries ?? 5;
  }

  append(event: AppendInput): Promise<EngagementEvent> {
    let data: Record<string, unknown>;
    try {
      data = validateInput(event);
    } catch (error) {
      return Promise.reject(error);
    }
    const input = { ...event };
    return this.#serial.run(input.engagementId, async () => {
      const json = JSON.stringify(data);
      let lastError: unknown;
      for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
        const seq = await this.#nextSeq(input.engagementId);
        if (seq >= this.#retention.maxEventsPerEngagement) {
          throw new JournalFullError(input.engagementId, this.#retention.maxEventsPerEngagement);
        }
        try {
          await this.#db.insert(ENGAGEMENT_EVENTS_TABLE, {
            id: `${input.engagementId}:${seq}`,
            engagement_id: input.engagementId,
            seq,
            at: input.at,
            type: input.type,
            data: json,
          });
          return buildEvent(input, seq, JSON.parse(json) as Record<string, unknown>);
        } catch (error) {
          lastError = error;
          // A unique-key conflict means another writer took this seq: re-read and retry.
          // If the max seq did not advance, the failure was something else.
          if ((await this.#nextSeq(input.engagementId)) <= seq) throw error;
        }
      }
      throw lastError;
    });
  }

  async read(engagementId: EngagementId): Promise<readonly EngagementEvent[]> {
    const rows = await this.#db
      .select(ENGAGEMENT_EVENTS_TABLE, ['engagement_id', 'seq', 'at', 'type', 'data'])
      .where({ engagement_id: engagementId });
    return Object.freeze(
      rows
        .map(row => ({ row, seq: Number(row.seq) }))
        .sort((a, b) => a.seq - b.seq)
        .map(({ row, seq }) =>
          buildEvent(
            { engagementId, at: Number(row.at), type: row.type as EngagementEvent['type'], data: {} },
            seq,
            JSON.parse(String(row.data)) as Record<string, unknown>,
          ),
        ),
    );
  }

  async prune(now: number): Promise<number> {
    const cutoff = now - this.#retention.maxAgeMs;
    const rows = await this.#db
      .select(ENGAGEMENT_EVENTS_TABLE, ['engagement_id', 'at'])
      .where({});
    const lastAt = new Map<string, number>();
    for (const row of rows) {
      const id = String(row.engagement_id);
      lastAt.set(id, Math.max(lastAt.get(id) ?? -Infinity, Number(row.at)));
    }
    let removed = 0;
    for (const [id, last] of lastAt) {
      if (last >= cutoff) continue;
      await this.#serial.run(id, async () => {
        await this.#db.delete(ENGAGEMENT_EVENTS_TABLE, { engagement_id: id });
      });
      removed++;
    }
    return removed;
  }

  async #nextSeq(engagementId: EngagementId): Promise<number> {
    const rows = await this.#db
      .select(ENGAGEMENT_EVENTS_TABLE, ['seq'])
      .where({ engagement_id: engagementId });
    let max = -1;
    for (const row of rows) max = Math.max(max, Number(row.seq));
    return max + 1;
  }
}
