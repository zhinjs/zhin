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
 * Safety: everything runs in one database transaction (SQLite, PostgreSQL and MySQL, the
 * engines the database journal supports), the row count is checked before commit, and a marker
 * row in `engagement_event_migrations` makes it a no-op afterwards. Concurrent runners conflict
 * on the marker's primary key; the caller retries and then sees the marker.
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
}

export interface EngagementIdMigrationPlan {
  /** Legacy ids that are replaced, with the ids of their parts in order. */
  readonly splits: readonly EngagementIdSplit[];
  /** Complete replacement rows for every split id (same count as the rows they replace). */
  readonly rows: readonly EngagementEventRow[];
  /** Rows of other engagements whose `carriedBy` / `engagementId` pointed at a split id (same row id). */
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
    }
    segmentsByOldId.set(oldId, segments);
  }

  const resolveEngagement = (value: string, at: number, own: { oldId: string; newId: string }): string => {
    if (value === own.oldId) return own.newId;
    const segments = segmentsByOldId.get(value);
    if (!segments) return value;
    let match = segments[0]!;
    for (const segment of segments) if (segment.startAt <= at) match = segment;
    return match.newId;
  };

  const rewrite = (value: unknown, key: string | undefined, segment: Segment, oldId: string, at: number): unknown => {
    if (typeof value === 'string' && key !== undefined) {
      if (MAIL_KEYS.has(key) && isLegacyCounterId(value, 'm')) return `m-${segment.token}-${counterOf(value)}`;
      if (GRANT_KEYS.has(key) && isLegacyCounterId(value, 'g')) return `g-${segment.token}-${counterOf(value)}`;
      if (ENGAGEMENT_KEYS.has(key) && isLegacyCounterId(value, 'm')) return resolveEngagement(value, at, { oldId, newId: segment.newId });
      return value;
    }
    if (Array.isArray(value)) return value.map(item => rewrite(item, key, segment, oldId, at));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, k, segment, oldId, at);
      return out;
    }
    return value;
  };

  const rewriteReferences = (value: unknown, key: string | undefined, at: number): unknown => {
    if (typeof value === 'string') {
      return key !== undefined && ENGAGEMENT_KEYS.has(key) && segmentsByOldId.has(value)
        ? resolveEngagement(value, at, { oldId: '', newId: '' })
        : value;
    }
    if (Array.isArray(value)) return value.map(item => rewriteReferences(item, key, at));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewriteReferences(v, k, at);
      return out;
    }
    return value;
  };
  const updates: EngagementEventRow[] = [];
  if (segmentsByOldId.size > 0) {
    for (const [id, list] of groups) {
      if (segmentsByOldId.has(id)) continue;
      for (const row of list) {
        let data: string;
        try {
          data = JSON.stringify(rewriteReferences(JSON.parse(row.data), undefined, row.at));
        } catch {
          continue;
        }
        if (data !== JSON.stringify(JSON.parse(row.data))) updates.push({ ...row, data });
      }
    }
  }

  const splits: EngagementIdSplit[] = [];
  const rows: EngagementEventRow[] = [];
  for (const [oldId, segments] of segmentsByOldId) {
    splits.push({ oldId, newIds: segments.map(segment => segment.newId) });
    for (const segment of segments) {
      segment.rows.forEach((row, seq) => {
        let data = row.data;
        try {
          data = JSON.stringify(rewrite(JSON.parse(row.data), undefined, segment, oldId, row.at));
        } catch {
          // Unparseable data is kept byte for byte; the row still moves to its part.
        }
        rows.push({ id: `${segment.newId}:${seq}`, engagement_id: segment.newId, seq, at: row.at, type: row.type, data });
      });
    }
  }
  return { splits, rows, updates };
}

/** The slice of a started DatabaseHost the migration uses (callback-scoped transaction models). */
export interface EngagementMigrationModel {
  select(...fields: string[]): { where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]> };
  insert(row: Record<string, unknown>): PromiseLike<unknown>;
  delete(): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
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

/**
 * Runs the id split once. Needs both tables defined and the database started. Wrap it in the
 * Host's contention retry: a concurrent runner loses on the marker row and then finds it.
 */
export async function migrateEngagementEventIds(
  database: EngagementMigrationDatabase,
  options: { readonly now?: () => number } = {},
): Promise<EngagementIdMigrationResult> {
  if (typeof database.transaction !== 'function') return { status: 'unsupported', rows: 0, splits: [] };
  return database.transaction(async (transaction) => {
    const marker = transaction.model(ENGAGEMENT_EVENT_MIGRATIONS_TABLE);
    const markers = await marker.select('id', 'version').where({ id: 1 });
    if (markers[0] && Number(markers[0].version) >= ENGAGEMENT_ID_MIGRATION_VERSION) {
      return { status: 'already_applied' as const, rows: 0, splits: [] };
    }
    const events = transaction.model(ENGAGEMENT_EVENTS_TABLE);
    const before = (await events.select('id', 'engagement_id', 'seq', 'at', 'type', 'data').where({})).map(toRow);
    const plan = planEngagementIdMigration(before);
    const replaced = new Set(plan.splits.map(split => split.oldId));
    const replacedCount = before.filter(row => replaced.has(row.engagement_id)).length;
    if (replacedCount !== plan.rows.length) {
      throw new Error(`engagement id migration would change the row count (${replacedCount} → ${plan.rows.length})`);
    }
    for (const oldId of replaced) await events.delete().where({ engagement_id: oldId });
    for (const row of plan.rows) await events.insert({ ...row });
    for (const row of plan.updates) {
      await events.delete().where({ id: row.id });
      await events.insert({ ...row });
    }
    const after = await events.select('id').where({});
    if (after.length !== before.length) {
      throw new Error(`engagement id migration changed the row count (${before.length} → ${after.length}); rolled back`);
    }
    const detail = JSON.stringify({ rows: before.length, splitIds: plan.splits.length, parts: plan.splits.reduce((sum, split) => sum + split.newIds.length, 0) });
    if (markers[0]) {
      await marker.delete().where({ id: 1 });
    }
    await marker.insert({ id: 1, version: ENGAGEMENT_ID_MIGRATION_VERSION, applied_at: (options.now ?? Date.now)(), detail });
    return { status: 'applied' as const, rows: before.length, splits: plan.splits };
  });
}
