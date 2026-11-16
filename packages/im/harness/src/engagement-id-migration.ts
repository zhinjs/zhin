/**
 * One-time migration of `engagement_events` written with the pre-b35 counter ids
 * (#1250 b35 engagement-id-reused-across-restarts).
 *
 * Engagement and mail ids came from one per-process counter (`m1`, `m2`, …) and grant ids from
 * another (`g1`, …); both restarted with every instance, so one `engagement_id` collected the
 * events of unrelated engagements from different runs. The database journal kept appending to
 * the same id (`seq` = max + 1), so within one id the rows are still in append order and every
 * engagement starts with its own `engagement_opened` event.
 *
 * The migration splits each legacy id that holds more than one `engagement_opened` at those
 * boundaries (rows ordered by `seq`, then `at`, then row id) and gives every part a new id in the
 * run-scoped format (`m-<run>-<n>`, see `ids.ts`). The `<run>` token of a part is derived from the
 * old id and the part's opening event, so the mail (`mailId`, `rootMailId`, `causationId`,
 * `mails`, …) and grant (`grantId`, `rootGrantId`, `parentId`) ids recorded inside that part are
 * rewritten consistently with it. Legacy ids that hold a single engagement are left unchanged:
 * they are already unique and links to them keep working.
 *
 * Applying it (#1250 b35 review): a project that ran for weeks holds a large share of its rows
 * under reused ids, so the work is done in bounded batches, each in its own transaction, and
 * every statement addresses rows by primary key (`engagement_id` has no index: one delete per
 * legacy id was a full table scan each, minutes on MySQL with 100k rows). First the
 * `carriedBy` / `engagementId` references to split ids are rewritten in place (every row, in
 * batches); then each batch of legacy ids is replaced by its parts in one transaction, so a
 * reader sees a legacy id either whole or fully split, never half of it. An interrupted run
 * (stop, crash, timeout) keeps the batches it committed: the plan is deterministic, so the next
 * run plans the remaining ids the same way and continues. The marker row in
 * `engagement_event_migrations` is written last and makes later runs a no-op. Concurrent runners
 * (two instances on one database, or a new generation while the last run still finishes) write identical rows: a batch that loses a
 * primary-key race rolls back, and the caller's contention retry re-plans from what is committed.
 */
import { ENGAGEMENT_EVENTS_TABLE } from './journal.js';
import { isLegacyCounterId } from './ids.js';

export const ENGAGEMENT_EVENT_MIGRATIONS_TABLE = 'engagement_event_migrations';
/** Version written by the id split; later migrations of this table use higher versions. */
export const ENGAGEMENT_ID_MIGRATION_VERSION = 1;

export const ENGAGEMENT_EVENT_MIGRATION_MODEL = {
  id: { type: 'integer' as const, primary: true, nullable: false },
  version: { type: 'integer' as const, nullable: false },
  applied_at: { type: 'bigint' as const, nullable: false },
  detail: { type: 'text' as const, nullable: true },
};

/** Registers the marker table next to `engagement_events`. */
export function defineEngagementEventMigrationModel(
  database: Readonly<{ define(name: string, definition: unknown): unknown }>,
): void {
  database.define(ENGAGEMENT_EVENT_MIGRATIONS_TABLE, ENGAGEMENT_EVENT_MIGRATION_MODEL);
}

export interface EngagementEventRow {
  readonly id: string;
  readonly engagement_id: string;
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly data: string;
}

export interface EngagementIdSplit {
  readonly oldId: string;
  readonly newIds: readonly string[];
  /** Row ids (`<oldId>:<seq>`) this split replaces. */
  readonly rowIds: readonly string[];
}

export interface EngagementIdMigrationPlan {
  /** Legacy ids that are replaced, with the ids of their parts in order. */
  readonly splits: readonly EngagementIdSplit[];
  /** Complete replacement rows for every split id (same count as the rows they replace). */
  readonly rows: readonly EngagementEventRow[];
  /**
   * Rows (of any engagement, split ones included) whose `carriedBy` / `engagementId` pointed at a
   * split id, with the reference resolved to the part active at that row; same row id. Applied
   * before any split, so a resumed run never meets a reference to an id that is already gone.
   */
  readonly updates: readonly EngagementEventRow[];
}

const MAIL_KEYS = new Set(['mailId', 'rootMailId', 'causationId', 'inReplyTo', 'replyTo', 'parentMailId', 'mails', 'mailIds']);
const GRANT_KEYS = new Set(['grantId', 'rootGrantId', 'parentId', 'parentGrantId']);
const ENGAGEMENT_KEYS = new Set(['carriedBy', 'engagementId']);

/** FNV-1a (32-bit, two seeds) in base36: a short deterministic token. */
function hashToken(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x2f) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

function counterOf(id: string): string {
  return id.slice(1);
}

interface Segment {
  readonly newId: string;
  readonly token: string;
  readonly startAt: number;
  readonly rows: EngagementEventRow[];
}

function sortRows(rows: EngagementEventRow[]): EngagementEventRow[] {
  return rows.sort((x, y) => x.seq - y.seq || x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function parseData(data: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(data) };
  } catch {
    return { ok: false };
  }
}

/**
 * Pure planning step: which legacy ids hold several engagements and the rows that replace them.
 * Rows of ids that need no split are not part of the plan.
 */
export function planEngagementIdMigration(input: readonly EngagementEventRow[]): EngagementIdMigrationPlan {
  const groups = new Map<string, EngagementEventRow[]>();
  for (const row of input) {
    const list = groups.get(row.engagement_id);
    if (list) list.push(row);
    else groups.set(row.engagement_id, [row]);
  }
  const taken = new Set(groups.keys());
  const segmentsByOldId = new Map<string, Segment[]>();
  const segmentOfRow = new Map<string, Segment>();
  for (const [oldId, list] of groups) {
    if (!isLegacyCounterId(oldId, 'm')) continue;
    const ordered = sortRows([...list]);
    if (ordered.filter(row => row.type === 'engagement_opened').length < 2) continue;
    const segments: Segment[] = [];
    for (const row of ordered) {
      if (segments.length === 0 || row.type === 'engagement_opened' && segments[segments.length - 1]!.rows.some(r => r.type === 'engagement_opened')) {
        let salt = 0;
        let token: string;
        let newId: string;
        do {
          token = `x${hashToken(`${oldId}:${row.seq}:${row.at}:${row.id}:${salt++}`)}`;
          newId = `m-${token}-${counterOf(oldId)}`;
        } while (taken.has(newId));
        taken.add(newId);
        segments.push({ newId, token, startAt: row.at, rows: [row] });
      } else {
        segments[segments.length - 1]!.rows.push(row);
      }
      segmentOfRow.set(row.id, segments[segments.length - 1]!);
    }
    segmentsByOldId.set(oldId, segments);
  }

  /** The part of split id `value` a row written at `at` refers to (its own part for its own id). */
  const resolveEngagement = (value: string, row: EngagementEventRow): string => {
    if (value === row.engagement_id) {
      const own = segmentOfRow.get(row.id);
      if (own) return own.newId;
    }
    const segments = segmentsByOldId.get(value);
    if (!segments) return value;
    let match = segments[0]!;
    for (const segment of segments) if (segment.startAt <= row.at) match = segment;
    return match.newId;
  };

  const rewriteReferences = (value: unknown, key: string | undefined, row: EngagementEventRow): unknown => {
    if (typeof value === 'string') {
      return key !== undefined && ENGAGEMENT_KEYS.has(key) && segmentsByOldId.has(value)
        ? resolveEngagement(value, row)
        : value;
    }
    if (Array.isArray(value)) return value.map(item => rewriteReferences(item, key, row));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewriteReferences(v, k, row);
      return out;
    }
    return value;
  };

  const rewriteIds = (value: unknown, key: string | undefined, segment: Segment): unknown => {
    if (typeof value === 'string' && key !== undefined) {
      if (MAIL_KEYS.has(key) && isLegacyCounterId(value, 'm')) return `m-${segment.token}-${counterOf(value)}`;
      if (GRANT_KEYS.has(key) && isLegacyCounterId(value, 'g')) return `g-${segment.token}-${counterOf(value)}`;
      return value;
    }
    if (Array.isArray(value)) return value.map(item => rewriteIds(item, key, segment));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewriteIds(v, k, segment);
      return out;
    }
    return value;
  };

  // Phase 1: engagement references, in place (any row; unparseable data is left alone).
  const updates: EngagementEventRow[] = [];
  const referenced = new Map<string, EngagementEventRow>();
  if (segmentsByOldId.size > 0) {
    for (const row of input) {
      const parsed = parseData(row.data);
      if (!parsed.ok) continue;
      const data = JSON.stringify(rewriteReferences(parsed.value, undefined, row));
      if (data === JSON.stringify(parsed.value)) continue;
      const updated = { ...row, data };
      updates.push(updated);
      referenced.set(row.id, updated);
    }
  }

  // Phase 2: replacement rows, built from the phase-1 data.
  const splits: EngagementIdSplit[] = [];
  const rows: EngagementEventRow[] = [];
  for (const [oldId, segments] of segmentsByOldId) {
    splits.push({ oldId, newIds: segments.map(segment => segment.newId), rowIds: segments.flatMap(segment => segment.rows.map(row => row.id)) });
    for (const segment of segments) {
      segment.rows.forEach((original, seq) => {
        const row = referenced.get(original.id) ?? original;
        const parsed = parseData(row.data);
        // Unparseable data is kept byte for byte; the row still moves to its part.
        const data = parsed.ok ? JSON.stringify(rewriteIds(parsed.value, undefined, segment)) : row.data;
        rows.push({ id: `${segment.newId}:${seq}`, engagement_id: segment.newId, seq, at: row.at, type: row.type, data });
      });
    }
  }
  return { splits, rows, updates };
}

type Condition = Record<string, unknown>;

/** The slice of a started DatabaseHost the migration uses (callback-scoped transaction models). */
export interface EngagementMigrationModel {
  select(...fields: string[]): { where(condition: Condition): PromiseLike<Record<string, unknown>[]> };
  insert(row: Record<string, unknown>): PromiseLike<unknown>;
  delete(): { where(condition: Condition): PromiseLike<unknown> };
  update?(patch: Record<string, unknown>): { where(condition: Condition): PromiseLike<unknown> };
}
export interface EngagementMigrationDatabase {
  transaction?<T>(callback: (transaction: { model(name: string): EngagementMigrationModel }) => Promise<T>): Promise<T>;
}

export interface EngagementIdMigrationResult {
  readonly status: 'applied' | 'already_applied' | 'unsupported';
  /** Rows in `engagement_events` (unchanged by the migration). */
  readonly rows: number;
  readonly splits: readonly EngagementIdSplit[];
}

export interface EngagementIdMigrationOptions {
  readonly now?: () => number;
  /** Rows written per transaction (default 500); a legacy id is never split across two. */
  readonly batchRows?: number;
  /** Checked between batches: a stopping instance leaves the remaining ids for its next start. */
  readonly signal?: AbortSignal;
}

function toRow(raw: Record<string, unknown>): EngagementEventRow {
  return {
    id: String(raw.id),
    engagement_id: String(raw.engagement_id),
    seq: Number(raw.seq),
    at: Number(raw.at),
    type: String(raw.type),
    data: typeof raw.data === 'string' ? raw.data : JSON.stringify(raw.data ?? {}),
  };
}

/** Primary keys per `IN (…)` list: far below every engine's bound-parameter limit. */
const KEYS_PER_STATEMENT = 200;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectByIds(model: EngagementMigrationModel, ids: readonly string[]): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  for (const part of chunks(ids, KEYS_PER_STATEMENT)) found.push(...await model.select('id', 'data').where({ id: { $in: part } }));
  return found;
}

/**
 * Runs the id split once. Needs both tables defined and the database started. Wrap it in the
 * Host's contention retry: a concurrent runner loses a primary-key race and then re-plans.
 */
export async function migrateEngagementEventIds(
  database: EngagementMigrationDatabase,
  options: EngagementIdMigrationOptions = {},
): Promise<EngagementIdMigrationResult> {
  if (typeof database.transaction !== 'function') return { status: 'unsupported', rows: 0, splits: [] };
  const transaction = database.transaction.bind(database);
  const batchRows = Math.max(1, Math.floor(options.batchRows ?? 500));
  const checkpoint = () => options.signal?.throwIfAborted();

  const loaded = await transaction(async (tx) => {
    const markers = await tx.model(ENGAGEMENT_EVENT_MIGRATIONS_TABLE).select('id', 'version').where({ id: 1 });
    if (markers[0] && Number(markers[0].version) >= ENGAGEMENT_ID_MIGRATION_VERSION) return undefined;
    return (await tx.model(ENGAGEMENT_EVENTS_TABLE).select('id', 'engagement_id', 'seq', 'at', 'type', 'data').where({})).map(toRow);
  });
  if (!loaded) return { status: 'already_applied', rows: 0, splits: [] };
  const plan = planEngagementIdMigration(loaded);
  const originalData = new Map(loaded.map(row => [row.id, row.data]));

  // Phase 1: references, in place. A row whose data changed since it was read (or that is gone)
  // is left alone; its id is not split yet, so the next run resolves it again.
  for (const batch of chunks(plan.updates, batchRows)) {
    checkpoint();
    await transaction(async (tx) => {
      const events = tx.model(ENGAGEMENT_EVENTS_TABLE);
      const current = new Map((await selectByIds(events, batch.map(row => row.id))).map(raw => [String(raw.id), raw.data]));
      for (const row of batch) {
        const data = current.get(row.id);
        if (data === row.data || data !== originalData.get(row.id)) continue;
        if (events.update) await events.update({ data: row.data }).where({ id: row.id });
        else {
          await events.delete().where({ id: row.id });
          await events.insert({ ...row });
        }
      }
    });
  }

  // Phase 2: whole legacy ids, a batch per transaction.
  const replacements = new Map<string, EngagementEventRow[]>();
  for (const row of plan.rows) {
    const list = replacements.get(row.engagement_id);
    if (list) list.push(row);
    else replacements.set(row.engagement_id, [row]);
  }
  const batches: EngagementIdSplit[][] = [];
  let size = 0;
  for (const split of plan.splits) {
    if (batches.length === 0 || size + split.rowIds.length > batchRows) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1]!.push(split);
    size += split.rowIds.length;
  }
  /** Splits of the batch whose rows are all still there (the others are done or vanished). */
  const pending = async (events: EngagementMigrationModel, batch: readonly EngagementIdSplit[]): Promise<EngagementIdSplit[]> => {
    const present = new Set((await selectByIds(events, batch.flatMap(split => split.rowIds))).map(raw => String(raw.id)));
    return batch.filter((split) => {
      const count = split.rowIds.filter(id => present.has(id)).length;
      // None left: split by a concurrent runner, or pruned meanwhile.
      if (count === 0) return false;
      if (count !== split.rowIds.length) {
        throw new Error(`engagement id migration: ${split.oldId} changed while it was split (${count} of ${split.rowIds.length} rows); rolled back`);
      }
      return true;
    });
  };
  for (const batch of batches) {
    checkpoint();
    try {
      await transaction(async (tx) => {
        const events = tx.model(ENGAGEMENT_EVENTS_TABLE);
        const todo = await pending(events, batch);
        if (todo.length === 0) return;
        const parts = todo.flatMap(split => split.newIds.flatMap(id => replacements.get(id) ?? []));
        const replaced = todo.reduce((sum, split) => sum + split.rowIds.length, 0);
        if (parts.length !== replaced) {
          throw new Error(`engagement id migration would change the row count (${replaced} → ${parts.length})`);
        }
        for (const ids of chunks(todo.flatMap(split => split.rowIds), KEYS_PER_STATEMENT)) await events.delete().where({ id: { $in: ids } });
        for (const row of parts) await events.insert({ ...row });
        const written = (await selectByIds(events, parts.map(row => row.id))).length;
        if (written !== parts.length) {
          throw new Error(`engagement id migration changed the row count (${replaced} → ${written}); rolled back`);
        }
      });
    } catch (error) {
      // A concurrent runner committed the same batch first (its rows are identical): go on.
      const done = await transaction(async tx => (await pending(tx.model(ENGAGEMENT_EVENTS_TABLE), batch)).length === 0).catch(() => false);
      if (!done) throw error;
    }
  }

  checkpoint();
  const detail = JSON.stringify({ rows: loaded.length, splitIds: plan.splits.length, parts: plan.splits.reduce((sum, split) => sum + split.newIds.length, 0) });
  await transaction(async (tx) => {
    const marker = tx.model(ENGAGEMENT_EVENT_MIGRATIONS_TABLE);
    const markers = await marker.select('id', 'version').where({ id: 1 });
    if (markers[0]) await marker.delete().where({ id: 1 });
    await marker.insert({ id: 1, version: ENGAGEMENT_ID_MIGRATION_VERSION, applied_at: (options.now ?? Date.now)(), detail });
  });
  return { status: 'applied', rows: loaded.length, splits: plan.splits };
}
