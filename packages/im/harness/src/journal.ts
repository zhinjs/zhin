/**
 * Engagement journal implementations (ADR 0048 §3.5).
 *
 * Depends on `contracts.ts` only. The database store targets a narrow query
 * interface (`EngagementJournalDatabase`) that `@zhin.js/database` satisfies,
 * so the host registers `ENGAGEMENT_EVENT_MODEL` and passes its database in.
 */
import {
  BUDGET_KEYS,
  DEFAULT_JOURNAL_RETENTION,
  JournalFullError,
  type ActorId,
  type BoardEntry,
  type BoardEntryKind,
  type BoardReadFilter,
  type BoardTodoStatus,
  type BudgetAmounts,
  type EngagementEvent,
  type EngagementHopSummary,
  type EngagementId,
  type EngagementJournal,
  type EngagementSummary,
  type GuardBlockReason,
  type JournalRecord,
  type JournalRetention,
  type MailId,
  type MailKind,
  type Principal,
  type VenueRef,
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordPayload(record: JournalRecord): Record<string, unknown> {
  const data = isPlainRecord(record.data) ? record.data : {};
  const event = isPlainRecord(record.event) ? record.event : {};
  return { ...event, ...data };
}

function recordType(record: JournalRecord): string {
  if (typeof record.type === 'string' && record.type) return record.type;
  if (isPlainRecord(record.event) && typeof record.event.type === 'string') return record.event.type;
  return '';
}

function isActorRef(value: unknown): value is ActorId {
  return (
    typeof value === 'string'
    && value.length > 0
    && !value.startsWith('human:')
    && !value.startsWith('system:')
    && value !== 'human'
    && value !== 'system'
  );
}

/** Reconstructs blackboard entries from a sequence of journal records. */
export function reconstructBoardFromEvents(
  records: readonly JournalRecord[],
  filter?: BoardReadFilter,
): readonly BoardEntry[] {
  const byKey = new Map<string, BoardEntry>();
  for (const record of records) {
    if (recordType(record) !== 'board_written') continue;
    const payload = recordPayload(record);
    const key = typeof payload.key === 'string' ? payload.key.trim() : '';
    if (!key) continue;
    const prev = byKey.get(key);
    const kind: BoardEntryKind =
      payload.kind === 'artifact' || payload.kind === 'todo' || payload.kind === 'note'
        ? payload.kind
        : prev?.kind ?? 'note';
    const content = typeof payload.content === 'string' ? payload.content : prev?.content ?? '';
    const author = typeof payload.actor === 'string'
      ? payload.actor
      : typeof payload.author === 'string'
        ? payload.author
        : prev?.author ?? '';
    const version = typeof payload.version === 'number' && Number.isFinite(payload.version)
      ? payload.version
      : (prev?.version ?? 0) + 1;
    const status: BoardTodoStatus | undefined =
      payload.status === 'pending' || payload.status === 'in_progress' || payload.status === 'done'
        ? payload.status
        : prev?.status;
    byKey.set(
      key,
      deepFreeze({
        key,
        kind,
        content,
        author,
        updatedAt: record.at,
        version,
        ...(status !== undefined ? { status } : {}),
      }),
    );
  }
  const entries = [...byKey.values()].filter((entry) => {
    if (filter?.key !== undefined && entry.key !== filter.key) return false;
    if (filter?.kind !== undefined && entry.kind !== filter.kind) return false;
    return true;
  });
  return Object.freeze(entries);
}

/** Pure helper that summarizes an engagement's journal records into a collaboration graph and metrics. */
export function summarizeEngagementEvents(
  engagementId: EngagementId,
  records: readonly JournalRecord[],
): EngagementSummary {
  let initiator: Principal | undefined;
  let venue: VenueRef | undefined;
  let startedAt = records[0]?.at ?? 0;
  let endedAt: number | undefined;
  let closedStatus: EngagementSummary['status'] | undefined;
  let reason: string | undefined;
  let toolCallCount = 0;

  const actors: ActorId[] = [];
  const seenActors = new Set<ActorId>();
  const addActor = (actor: unknown): void => {
    if (isActorRef(actor) && !seenActors.has(actor)) {
      seenActors.add(actor);
      actors.push(actor);
    }
  };

  const guardBlocks: Array<{
    readonly from: ActorId;
    readonly to?: ActorId;
    readonly reason: GuardBlockReason;
    readonly at: number;
  }> = [];
  const escalations: Array<{
    readonly by: ActorId;
    readonly reason: string;
    readonly at: number;
  }> = [];
  const projections: Array<{
    readonly venue: VenueRef;
    readonly actor: ActorId;
    readonly mailId: MailId;
    readonly mode: 'visible' | 'summary';
    readonly at: number;
  }> = [];

  const consumed = { modelCalls: 0, tokens: 0, wallMs: 0, sideEffects: 0 };
  let closedSpent: Partial<BudgetAmounts> | undefined;

  const hopsById = new Map<MailId, {
    mailId: MailId;
    kind: MailKind;
    from: string;
    to: ActorId;
    causationId?: MailId;
    status: 'sent' | 'delivered' | 'completed' | 'cancelled';
  }>();
  const hopOrder: MailId[] = [];
  const seenMailIds = new Set<string>();
  let anonymousMailCount = 0;

  for (const record of records) {
    const type = recordType(record);
    const payload = recordPayload(record);

    switch (type) {
      case 'engagement_opened': {
        startedAt = record.at;
        if (isPlainRecord(payload.initiator) && typeof payload.initiator.id === 'string') {
          initiator = payload.initiator as unknown as Principal;
        } else if (isPlainRecord(payload.principal) && typeof payload.principal.id === 'string') {
          initiator = payload.principal as unknown as Principal;
        } else if (typeof payload.principal === 'string' && payload.principal) {
          initiator = {
            kind: 'human',
            id: payload.principal,
            trust: 'group_member',
          };
        }
        if (isPlainRecord(payload.venue) && typeof payload.venue.kind === 'string' && typeof payload.venue.id === 'string') {
          venue = { kind: payload.venue.kind, id: payload.venue.id };
        }
        addActor(payload.entry);
        break;
      }

      case 'mail_admitted':
      case 'mail_sent': {
        const mailId = typeof payload.mailId === 'string' ? payload.mailId : '';
        const kind = (typeof payload.kind === 'string' ? payload.kind : 'ask') as MailKind;
        const from = typeof payload.from === 'string' ? payload.from : '';
        const to = typeof payload.to === 'string' ? payload.to : '';
        const causationId = typeof payload.causationId === 'string' && payload.causationId ? payload.causationId : undefined;
        addActor(from);
        addActor(to);
        if (mailId) {
          seenMailIds.add(mailId);
          if (!hopsById.has(mailId)) {
            hopsById.set(mailId, {
              mailId,
              kind,
              from,
              to,
              ...(causationId !== undefined ? { causationId } : {}),
              status: 'sent',
            });
            hopOrder.push(mailId);
          }
          if (kind === 'result' && causationId) {
            const parentHop = hopsById.get(causationId);
            if (parentHop) {
              parentHop.status = payload.status === 'cancelled' ? 'cancelled' : 'completed';
            }
          }
        } else {
          anonymousMailCount++;
        }
        break;
      }

      case 'turn_started':
      case 'mail_delivered': {
        addActor(payload.actor);
        const ids: string[] = [];
        if (typeof payload.mailId === 'string') ids.push(payload.mailId);
        if (Array.isArray(payload.mails)) {
          for (const id of payload.mails) if (typeof id === 'string') ids.push(id);
        }
        for (const id of ids) {
          const hop = hopsById.get(id);
          if (hop && hop.status === 'sent') hop.status = 'delivered';
        }
        break;
      }

      case 'turn_finished':
      case 'mail_completed': {
        addActor(payload.actor);
        const nextStatus = payload.status === 'cancelled' ? 'cancelled' : 'completed';
        const ids: string[] = [];
        if (typeof payload.mailId === 'string') ids.push(payload.mailId);
        if (Array.isArray(payload.mails)) {
          for (const id of payload.mails) if (typeof id === 'string') ids.push(id);
        }
        for (const id of ids) {
          const hop = hopsById.get(id);
          if (hop) hop.status = nextStatus;
        }
        break;
      }

      case 'mail_cancelled': {
        const mailId = typeof payload.mailId === 'string' ? payload.mailId : '';
        const hop = mailId ? hopsById.get(mailId) : undefined;
        if (hop) hop.status = 'cancelled';
        break;
      }

      case 'tool_called': {
        toolCallCount++;
        addActor(payload.actor);
        break;
      }

      case 'board_written': {
        addActor(payload.actor ?? payload.author);
        break;
      }

      case 'guard_blocked':
      case 'mail_denied': {
        const from = typeof payload.from === 'string'
          ? payload.from
          : typeof payload.actor === 'string'
            ? payload.actor
            : '';
        const to = typeof payload.to === 'string' ? payload.to : undefined;
        addActor(from);
        addActor(to);
        const blockReason: GuardBlockReason = isPlainRecord(payload.reason) && typeof payload.reason.code === 'string'
          ? {
              code: payload.reason.code,
              ...(typeof payload.reason.detail === 'string' ? { detail: payload.reason.detail } : {}),
            }
          : {
              code: typeof payload.code === 'string' ? payload.code : 'denied',
              ...(typeof payload.reason === 'string' ? { detail: payload.reason } : {}),
            };
        guardBlocks.push({
          from,
          ...(to !== undefined ? { to } : {}),
          reason: blockReason,
          at: record.at,
        });
        break;
      }

      case 'escalated': {
        const by = typeof payload.by === 'string'
          ? payload.by
          : typeof payload.from === 'string'
            ? payload.from
            : typeof payload.actor === 'string'
              ? payload.actor
              : '';
        addActor(by);
        const escReason = typeof payload.reason === 'string' ? payload.reason : '';
        escalations.push({ by, reason: escReason, at: record.at });
        break;
      }

      case 'venue_projected': {
        addActor(payload.actor);
        if (isPlainRecord(payload.venue) && typeof payload.venue.kind === 'string' && typeof payload.venue.id === 'string') {
          projections.push({
            venue: { kind: payload.venue.kind, id: payload.venue.id },
            actor: typeof payload.actor === 'string' ? payload.actor : '',
            mailId: typeof payload.mailId === 'string' ? payload.mailId : '',
            mode: payload.mode === 'summary' ? 'summary' : 'visible',
            at: record.at,
          });
        }
        break;
      }

      case 'budget_charged': {
        const usage = isPlainRecord(payload.usage)
          ? payload.usage
          : isPlainRecord(payload.amount)
            ? payload.amount
            : isPlainRecord(payload.consumed)
              ? payload.consumed
              : payload;
        for (const key of BUDGET_KEYS) {
          const val = usage[key];
          if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
            consumed[key] += val;
          }
        }
        break;
      }

      case 'engagement_closed': {
        endedAt = record.at;
        if (
          payload.status === 'completed'
          || payload.status === 'escalated'
          || payload.status === 'cancelled'
          || payload.status === 'blocked'
        ) {
          closedStatus = payload.status;
        }
        if (typeof payload.reason === 'string') {
          reason = payload.reason;
        }
        if (isPlainRecord(payload.budget) && isPlainRecord(payload.budget.spent)) {
          closedSpent = payload.budget.spent as Partial<BudgetAmounts>;
        } else if (isPlainRecord(payload.consumed)) {
          closedSpent = payload.consumed as Partial<BudgetAmounts>;
        }
        break;
      }

      default:
        break;
    }
  }

  if (closedSpent) {
    for (const key of BUDGET_KEYS) {
      const val = closedSpent[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        consumed[key] = Math.max(consumed[key], val);
      }
    }
  }

  const status: EngagementSummary['status'] = closedStatus
    ?? (endedAt !== undefined
      ? escalations.length > 0
        ? 'escalated'
        : 'completed'
      : escalations.length > 0
        ? 'escalated'
        : 'open');

  if (reason === undefined && escalations.length > 0) {
    reason = escalations[escalations.length - 1]?.reason;
  }

  const boardEntries = reconstructBoardFromEvents(records);
  const hops: EngagementHopSummary[] = [];
  for (const id of hopOrder) {
    const hop = hopsById.get(id);
    if (hop) hops.push({ ...hop });
  }

  return deepFreeze({
    engagementId,
    ...(initiator !== undefined ? { initiator } : {}),
    ...(venue !== undefined ? { venue } : {}),
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    status,
    ...(reason !== undefined ? { reason } : {}),
    actors,
    mailCount: seenMailIds.size + anonymousMailCount,
    toolCallCount,
    boardEntries,
    guardBlocks,
    escalations,
    projections,
    consumed,
    hops,
  });
}

const COMPACTABLE_EVENT_TYPES = new Set<string>([
  'budget_charged',
  'budget_granted',
  'mail_delivered',
  'turn_started',
]);

function compactRecordList(
  engagementId: EngagementId,
  records: readonly EngagementEvent[],
): readonly EngagementEvent[] | undefined {
  if (records.length <= 20) return undefined;
  let closedRecord: EngagementEvent | undefined;
  for (const record of records) {
    const type = recordType(record);
    if (type === 'guard_blocked' || type === 'mail_denied' || type === 'escalated') {
      return undefined;
    }
    if (type === 'engagement_closed') {
      closedRecord = record;
    }
  }
  if (!closedRecord) return undefined;
  const closedStatus = closedRecord.data.status;
  if (closedStatus !== undefined && closedStatus !== 'completed') {
    return undefined;
  }

  const summary = summarizeEngagementEvents(engagementId, records);
  const filtered = records.filter((record) => !COMPACTABLE_EVENT_TYPES.has(recordType(record)));
  if (filtered.length === records.length) return undefined;

  return filtered.map((record, index) => {
    const data = record === closedRecord
      ? (cloneJson(
          {
            ...record.data,
            status: 'completed',
            consumed: summary.consumed,
          },
          'data',
          new Set(),
        ) as Record<string, unknown>)
      : (cloneJson(record.data, 'data', new Set()) as Record<string, unknown>);
    return buildEvent(
      { engagementId: record.engagementId, at: record.at, type: record.type, data },
      index,
      data,
    );
  });
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

  async listEngagements(limit?: number): Promise<readonly EngagementId[]> {
    const entries: Array<{ id: EngagementId; lastAt: number; order: number }> = [];
    let order = 0;
    for (const [id, list] of this.#events) {
      const last = list[list.length - 1];
      if (!last) continue;
      const lastAt = last.at;
      entries.push({ id, lastAt, order: order++ });
    }
    entries.sort((a, b) => (b.lastAt !== a.lastAt ? b.lastAt - a.lastAt : b.order - a.order));
    const ids = entries.map((entry) => entry.id);
    return Object.freeze(limit !== undefined ? ids.slice(0, Math.max(0, limit)) : ids);
  }

  async summarize(engagementId: EngagementId): Promise<EngagementSummary | undefined> {
    const records = await this.read(engagementId);
    if (records.length === 0) return undefined;
    return summarizeEngagementEvents(engagementId, records);
  }

  async compact(engagementId: EngagementId): Promise<void> {
    await this.#serial.run(engagementId, async () => {
      const list = this.#events.get(engagementId);
      if (!list) return;
      const compacted = compactRecordList(engagementId, list);
      if (compacted) {
        this.#events.set(engagementId, [...compacted]);
      }
    });
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

  async listEngagements(limit?: number): Promise<readonly EngagementId[]> {
    const rows = await this.#db
      .select(ENGAGEMENT_EVENTS_TABLE, ['engagement_id', 'at', 'seq'])
      .where({});
    const meta = new Map<string, { lastAt: number; order: number }>();
    let order = 0;
    for (const row of rows) {
      const id = String(row.engagement_id);
      const at = Number(row.at);
      const existing = meta.get(id);
      if (!existing) {
        meta.set(id, { lastAt: at, order: order++ });
      } else {
        if (at >= existing.lastAt) existing.lastAt = at;
        existing.order = order++;
      }
    }
    const entries = [...meta.entries()].sort(([, a], [, b]) =>
      b.lastAt !== a.lastAt ? b.lastAt - a.lastAt : b.order - a.order,
    );
    const ids = entries.map(([id]) => id);
    return Object.freeze(limit !== undefined ? ids.slice(0, Math.max(0, limit)) : ids);
  }

  async summarize(engagementId: EngagementId): Promise<EngagementSummary | undefined> {
    const records = await this.read(engagementId);
    if (records.length === 0) return undefined;
    return summarizeEngagementEvents(engagementId, records);
  }

  async compact(engagementId: EngagementId): Promise<void> {
    await this.#serial.run(engagementId, async () => {
      const records = await this.read(engagementId);
      const compacted = compactRecordList(engagementId, records);
      if (!compacted) return;
      await this.#db.delete(ENGAGEMENT_EVENTS_TABLE, { engagement_id: engagementId });
      for (const record of compacted) {
        await this.#db.insert(ENGAGEMENT_EVENTS_TABLE, {
          id: `${engagementId}:${record.seq}`,
          engagement_id: engagementId,
          seq: record.seq,
          at: record.at,
          type: record.type,
          data: JSON.stringify(record.data),
        });
      }
    });
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
