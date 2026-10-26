/**
 * Subscription / watcher-state tables.
 *
 * The model surface matches the Plugin Runtime `DatabaseHostModel`, so the
 * scoped `databaseHostToken` facade is used directly when a database is
 * configured; otherwise an in-memory store keeps chat-only bots working
 * (subscriptions are then lost on restart).
 */

export type BiliRow = Record<string, unknown>;

export interface BiliModel {
  select: (...fields: string[]) => {
    where: (query: Record<string, unknown>) => PromiseLike<BiliRow[]>;
    then: <TResult1 = BiliRow[], TResult2 = never>(
      onfulfilled?: ((value: BiliRow[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
  };
  insert: (row: Record<string, unknown>) => Promise<unknown>;
  delete: () => { where: (query: Record<string, unknown>) => Promise<unknown> };
  update: (patch: Record<string, unknown>) => {
    where: (query: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface BiliDb {
  models: { get: (name: string) => BiliModel | undefined };
}

export const BILI_SUBS_TABLE = 'bilibili_subscriptions';
export const BILI_STATE_TABLE = 'bilibili_watch_state';

export const BILI_TABLE_DEFINITIONS: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  [BILI_SUBS_TABLE]: {
    uid: { type: 'text', nullable: false },
    uname: { type: 'text', default: '' },
    /** `all` | `live` | `dynamic` */
    kinds: { type: 'text', default: 'all' },
    adapter_name: { type: 'text', nullable: false },
    endpoint_id: { type: 'text', default: '' },
    channel_type: { type: 'text', default: 'private' },
    channel_id: { type: 'text', nullable: false },
    creator_id: { type: 'text', default: '' },
    locale: { type: 'text', length: 16, nullable: true },
    created_at: { type: 'text', default: '' },
  },
  [BILI_STATE_TABLE]: {
    uid: { type: 'text', nullable: false },
    live_status: { type: 'integer', default: -1 },
    live_time: { type: 'integer', default: 0 },
    last_dynamic_ts: { type: 'integer', default: 0 },
    /** JSON array of recently pushed dynamic ids (dedupe across restarts). */
    seen_dynamics: { type: 'text', default: '[]' },
    dynamic_ready: { type: 'integer', default: 0 },
    updated_at: { type: 'text', default: '' },
  },
});

export function defineBiliTables(db: { define: (name: string, schema: Record<string, unknown>, options?: {addColumns: readonly string[]}) => void }): void {
  for (const [name, definition] of Object.entries(BILI_TABLE_DEFINITIONS)) db.define(name, definition, name === BILI_SUBS_TABLE ? { addColumns: ['locale'] } : undefined);
}

function createMemoryModel(): BiliModel {
  const rows: BiliRow[] = [];
  let nextId = 1;
  const matches = (row: BiliRow, query: Record<string, unknown>): boolean =>
    Object.entries(query).every(([key, value]) => row[key] === value);
  return {
    select: () => {
      const promise = Promise.resolve().then(() => rows.map((row) => ({ ...row })));
      return {
        where: async (query: Record<string, unknown>) => rows.filter((row) => matches(row, query)).map((row) => ({ ...row })),
        then: (onfulfilled, onrejected) => promise.then(onfulfilled, onrejected),
      };
    },
    insert: async (row: Record<string, unknown>) => {
      const withId: BiliRow = { id: String(nextId++), ...row };
      rows.push(withId);
      return { ...withId };
    },
    delete: () => ({
      where: async (query: Record<string, unknown>) => {
        for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index]!, query)) rows.splice(index, 1);
      },
    }),
    update: (patch: Record<string, unknown>) => ({
      where: async (query: Record<string, unknown>) => {
        for (const row of rows) if (matches(row, query)) Object.assign(row, patch);
      },
    }),
  };
}

export function createInMemoryBiliDb(): BiliDb {
  const models = new Map<string, BiliModel>(Object.keys(BILI_TABLE_DEFINITIONS).map((name) => [name, createMemoryModel()]));
  return { models: { get: (name: string) => models.get(name) } };
}

export function getBiliSubs(db: BiliDb): BiliModel | null {
  return db.models.get(BILI_SUBS_TABLE) ?? null;
}

export function getBiliState(db: BiliDb): BiliModel | null {
  return db.models.get(BILI_STATE_TABLE) ?? null;
}

export type SubscriptionKinds = 'all' | 'live' | 'dynamic';

export function parseKinds(input: string): SubscriptionKinds | undefined {
  const text = input.trim().toLowerCase();
  if (!text || text === 'all' || text === '全部') return 'all';
  if (text === 'live' || text === '直播' || text === '开播') return 'live';
  if (text === 'dynamic' || text === 'dyn' || text === '动态') return 'dynamic';
  return undefined;
}

export function wantsLive(kinds: unknown): boolean {
  return kinds === 'all' || kinds === 'live' || kinds === undefined || kinds === '';
}

export function wantsDynamic(kinds: unknown): boolean {
  return kinds === 'all' || kinds === 'dynamic' || kinds === undefined || kinds === '';
}

export interface WatchState {
  uid: string;
  liveStatus: number;
  liveTime: number;
  lastDynamicTs: number;
  seenDynamics: string[];
  dynamicReady: boolean;
}

function intOf(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadState(model: BiliModel, uid: string): Promise<WatchState | undefined> {
  const [row] = await model.select().where({ uid });
  if (!row) return undefined;
  let seen: string[] = [];
  try {
    const parsed: unknown = JSON.parse(typeof row.seen_dynamics === 'string' ? row.seen_dynamics : '[]');
    if (Array.isArray(parsed)) seen = parsed.filter((id): id is string => typeof id === 'string');
  } catch { /* corrupted cache: start over */ }
  return {
    uid,
    liveStatus: intOf(row.live_status, -1),
    liveTime: intOf(row.live_time, 0),
    lastDynamicTs: intOf(row.last_dynamic_ts, 0),
    seenDynamics: seen,
    dynamicReady: intOf(row.dynamic_ready, 0) === 1,
  };
}

export const SEEN_DYNAMICS_LIMIT = 40;

export async function saveState(model: BiliModel, state: WatchState): Promise<void> {
  const patch = {
    live_status: state.liveStatus,
    live_time: state.liveTime,
    last_dynamic_ts: state.lastDynamicTs,
    seen_dynamics: JSON.stringify(state.seenDynamics.slice(-SEEN_DYNAMICS_LIMIT)),
    dynamic_ready: state.dynamicReady ? 1 : 0,
    updated_at: new Date().toISOString(),
  };
  const existing = await model.select().where({ uid: state.uid });
  if (existing.length > 0) await model.update(patch).where({ uid: state.uid });
  else await model.insert({ uid: state.uid, ...patch });
}

export function emptyState(uid: string): WatchState {
  return { uid, liveStatus: -1, liveTime: 0, lastDynamicTs: 0, seenDynamics: [], dynamicReady: false };
}
