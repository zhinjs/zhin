/**
 * ADR 0066 D5: the one-time migration of the interjection judge, and keeping it faithful afterwards.
 *
 * When the Host loads the Provider graph and finds a legacy ambient field (`defaults.ambient`,
 * `defaults.ambientFallbacks`, `decisions.ambient`) — or the retired yml keys
 * `ai.trigger.ambient.minConfidence` / `mode` while no migration has stored them — it computes
 * `purposes.ambient` by the D5 table (a stored `purposes.ambient`, e.g. seeded from `ai.plan.yml`,
 * keeps its own values and only takes the yml keys it lacks), removes the legacy fields and writes
 * both back in one CAS transaction (revision + 1) together with the record `{ id, at, before,
 * after, rows, notes, triggerValues }`. `before` is the complete `purposes` before the migration and
 * `triggerValues` the yml values read, for `zhin ai purposes revert ambient-judge`.
 *
 * After the migration the yml keys no longer apply by themselves; a later write to them (an older
 * Console page, a hand edit, `config set`) is converted into `purposes.ambient` on the next load
 * (`triggerSeen` remembers the values already acted on), so nothing a person sets is silently lost.
 *
 * A failed migration (the result does not validate, a referenced Profile is not visible, three CAS
 * conflicts) writes no graph: the generation runs on the same table in memory, the record says why
 * (`zhin doctor` reports it) and the next load tries again.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  AMBIENT_JUDGE_MIGRATION_ID,
  convertLegacyAmbientJudge,
  hasLegacyAmbientJudgeFields,
  legacyAmbientTriggerKeys,
  legacyAmbientTriggerValues,
  normalizeProviderGraph,
  providerPlanFingerprint,
  ProviderError,
  withoutLegacyAmbientJudge,
  type AmbientJudgeMigrationNote,
  type AmbientJudgeMigrationRow,
  type AmbientJudgePolicy,
  type JsonObject,
  type LegacyAmbientTrigger,
  type ProviderGraph,
  type ProviderMutationResult,
  type PurposePolicy,
  type CommitProviderGraphInput,
} from '@zhin.js/ai/provider';

/** Usable values of the retired yml keys. */
export type AmbientTriggerValues = Readonly<{ minConfidence?: number; mode?: 'active' | 'shadow' }>;

/** The record kept by the migration (one per root). Never secrets: Profile ids, numbers and modes only. */
export interface AmbientJudgeMigrationRecord {
  readonly id: typeof AMBIENT_JUDGE_MIGRATION_ID;
  /** `migrated`: stored; `failed`: last attempt failed (in-memory conversion runs); `reverted`: undone by the CLI. */
  readonly status: 'migrated' | 'failed' | 'reverted';
  /** Epoch ms of the migration (or of the last failed attempt). */
  readonly at: number;
  /** Graph revision written by the migration. */
  readonly graphRevision?: number;
  /** Complete `purposes` before the migration (revert source). */
  readonly before?: PurposePolicy;
  /** The `purposes.ambient` the migration wrote. */
  readonly after?: AmbientJudgePolicy;
  readonly rows?: readonly AmbientJudgeMigrationRow[];
  readonly notes?: readonly AmbientJudgeMigrationNote[];
  /** Retired yml keys read by the migration (`ai.trigger.ambient.<key>`). */
  readonly triggerKeys?: readonly string[];
  /** Their values when read: a revert writes back the ones `zhin doctor --fix` removed since. */
  readonly triggerValues?: AmbientTriggerValues;
  /** The yml values last acted on; a change to them is a write converted into `purposes.ambient`. */
  readonly triggerSeen?: AmbientTriggerValues;
  /** First `zhin doctor` that showed the result (shown once; `--verbose` shows it again). */
  readonly noticedAt?: number;
  readonly revertedAt?: number;
  /** `failed` only: why, and the configuration path when known. */
  readonly failure?: Readonly<{ reason: 'invalid-graph' | 'not-visible' | 'conflict' | 'not-committed' | 'unavailable'; path?: string }>;
}

/** The store the migration needs (the Host's `DatabaseInferenceRepository`). */
export interface AmbientJudgeMigrationStore {
  readGraph(input: Readonly<{ rootId: string }>): Promise<ProviderGraph | undefined>;
  readMigrationRecord(input: Readonly<{ rootId: string; id: string }>): Promise<JsonObject | undefined>;
  readMigrationRecordEntry(input: Readonly<{ rootId: string; id: string }>): Promise<Readonly<{ revision: number; record: JsonObject }> | undefined>;
  /** Compare-and-set with `expectedRevision` (0: absent) / `requireStatus`; `conflict` when either moved on. */
  writeMigrationRecord(input: Readonly<{ rootId: string; id: string; record: JsonObject; expectedRevision?: number; requireStatus?: string }>): Promise<'written' | 'conflict'>;
  commitMigration(input: CommitProviderGraphInput & Readonly<{ migration: Readonly<{ id: string; record: JsonObject }> }>): Promise<ProviderMutationResult>;
}

export interface AmbientJudgeMigrationLogger {
  info(message: string): void;
  error(message: string): void;
}

export type AmbientJudgeMigrationResult =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'migrated'; record: AmbientJudgeMigrationRecord }>
  /** A later write to the retired yml keys was converted into `purposes.ambient`. */
  | Readonly<{ status: 'converted'; record: AmbientJudgeMigrationRecord; keys: readonly string[] }>
  | Readonly<{ status: 'failed'; record: AmbientJudgeMigrationRecord }>;

const MAX_ATTEMPTS = 3;

function asRecord(value: JsonObject | undefined): AmbientJudgeMigrationRecord | undefined {
  return value && value.id === AMBIENT_JUDGE_MIGRATION_ID ? value as unknown as AmbientJudgeMigrationRecord : undefined;
}

function plain<T>(value: T): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** The stored record of this root's ADR 0066 migration, if any. */
export async function readAmbientJudgeMigration(store: Pick<AmbientJudgeMigrationStore, 'readMigrationRecord'>, rootId: string): Promise<AmbientJudgeMigrationRecord | undefined> {
  return asRecord(await store.readMigrationRecord({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID }));
}

/**
 * Whether this graph still needs the migration: a legacy stored field, or the retired yml keys
 * while no migration has taken them (also when `purposes.ambient` was seeded or written without
 * them). A reverted migration is not repeated automatically: the legacy fields and the yml keys
 * then apply as before (converted in memory) until someone writes `purposes.ambient`.
 */
export function needsAmbientJudgeMigration(graph: ProviderGraph, trigger: LegacyAmbientTrigger | undefined, record: AmbientJudgeMigrationRecord | undefined): boolean {
  if (record?.status === 'reverted') return false;
  if (hasLegacyAmbientJudgeFields(graph.purposes)) return true;
  return record?.status !== 'migrated' && legacyAmbientTriggerKeys(trigger).length > 0;
}

/** The graph after the migration, by the D5 table (pure; throws `ProviderError` with a path when invalid). */
export function migrateAmbientJudgeGraph(graph: ProviderGraph, trigger: LegacyAmbientTrigger | undefined, hostOwnerId: string): Readonly<{
  graph: ProviderGraph; ambient: AmbientJudgePolicy; rows: readonly AmbientJudgeMigrationRow[]; notes: readonly AmbientJudgeMigrationNote[];
}> {
  let ambient: AmbientJudgePolicy, rows: readonly AmbientJudgeMigrationRow[], notes: readonly AmbientJudgeMigrationNote[];
  const stored = graph.purposes.ambient;
  if (stored) {
    // A stored judge (seeded, or written while the yml keys still applied) was in effect: it keeps
    // its values and takes only the yml keys it lacks (M1: a shadow mode or threshold in force is never lost).
    const values = legacyAmbientTriggerValues(trigger);
    const taken = (['minConfidence', 'mode'] as const).filter(key => stored[key] === undefined && values[key] !== undefined);
    ambient = Object.freeze({ ...stored, ...Object.fromEntries(taken.map(key => [key, values[key]])) });
    rows = Object.freeze(taken.map(key => Object.freeze({ field: key, value: values[key]!, from: `ai.trigger.ambient.${key}` })));
    notes = Object.freeze([]);
  } else {
    ({ ambient, rows, notes } = convertLegacyAmbientJudge(graph.purposes, trigger));
  }
  const next = normalizeProviderGraph(plain({ ...graph, revision: graph.revision + 1,
    purposes: { ...withoutLegacyAmbientJudge(graph.purposes), ambient } }));
  // Deployment policy: every judge Profile must be the Host's own (as a plan import requires).
  const result = next.purposes.ambient ?? {};
  const references: Array<[string | undefined, string]> = [[result.profile, 'purposes.ambient.profile'],
    ...(result.fallbacks ?? []).map((id, index): [string, string] => [id, `purposes.ambient.fallbacks[${index}]`]), [result.compare, 'purposes.ambient.compare']];
  for (const [id, path] of references) {
    if (id !== undefined && next.profiles[id]?.ownerId !== hostOwnerId) throw Object.assign(new ProviderError('forbidden', path), { notVisible: true });
  }
  return Object.freeze({ graph: next, ambient, rows, notes });
}

/**
 * Runs the migration once for `rootId` when needed (D5.1–D5.3); afterwards converts a later write
 * to the retired yml keys into `purposes.ambient` (H2). Never throws: a failure is logged
 * (`ambient_judge_migration_failed`) and recorded, and the generation keeps converting in memory.
 */
export async function migrateAmbientJudge(input: Readonly<{
  store: AmbientJudgeMigrationStore;
  rootId: string;
  hostOwnerId: string;
  trigger?: LegacyAmbientTrigger;
  now?: () => number;
  logger?: AmbientJudgeMigrationLogger;
}>): Promise<AmbientJudgeMigrationResult> {
  const { store, rootId } = input;
  const now = input.now ?? Date.now;
  const values = legacyAmbientTriggerValues(input.trigger);
  const fail = async (failure: NonNullable<AmbientJudgeMigrationRecord['failure']>, previous: Readonly<{ revision: number; record?: AmbientJudgeMigrationRecord }>): Promise<AmbientJudgeMigrationResult> => {
    const record: AmbientJudgeMigrationRecord = Object.freeze({ ...(previous.record?.status === 'failed' ? previous.record : {}), id: AMBIENT_JUDGE_MIGRATION_ID,
      status: 'failed', at: now(), failure: Object.freeze({ ...failure }) });
    input.logger?.error(`ambient_judge_migration_failed | reason: ${failure.reason}${failure.path ? ` | path: ${failure.path}` : ''}`
      + ' | the interjection judge runs on the legacy configuration converted in memory; the next load retries');
    // Never over a record that moved on meanwhile (another instance migrated).
    try { await store.writeMigrationRecord({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(record), expectedRevision: previous.revision }); } catch { /* The log line above stays. */ }
    return Object.freeze({ status: 'failed', record });
  };
  let previous: Readonly<{ revision: number; record?: AmbientJudgeMigrationRecord }> = { revision: 0 };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let graph: ProviderGraph | undefined;
    try {
      graph = await store.readGraph({ rootId });
      const entry = await store.readMigrationRecordEntry({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID });
      previous = { revision: entry?.revision ?? 0, ...(asRecord(entry?.record) ? { record: asRecord(entry?.record)! } : {}) };
    } catch {
      return Object.freeze({ status: 'none' });
    }
    if (!graph) return Object.freeze({ status: 'none' });
    if (!needsAmbientJudgeMigration(graph, input.trigger, previous.record)) {
      const converted = await convertTriggerWrites({ ...input, graph, previous, values, now });
      if (converted === 'retry') continue;
      return converted;
    }
    let migrated: ReturnType<typeof migrateAmbientJudgeGraph>;
    try {
      migrated = migrateAmbientJudgeGraph(graph, input.trigger, input.hostOwnerId);
    } catch (error) {
      const path = error instanceof ProviderError ? error.path : undefined;
      return fail({ reason: (error as { notVisible?: boolean }).notVisible ? 'not-visible' : 'invalid-graph', ...(path ? { path } : {}) }, previous);
    }
    const triggerKeys = legacyAmbientTriggerKeys(input.trigger).map(key => `ai.trigger.ambient.${key}`);
    const record: AmbientJudgeMigrationRecord = Object.freeze({ id: AMBIENT_JUDGE_MIGRATION_ID, status: 'migrated', at: now(),
      graphRevision: migrated.graph.revision, before: graph.purposes, after: migrated.ambient, rows: migrated.rows, notes: migrated.notes,
      ...(triggerKeys.length ? { triggerKeys, triggerValues: values } : {}), triggerSeen: values });
    let result: ProviderMutationResult;
    try {
      result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:${graph.revision}`,
        fingerprint: providerPlanFingerprint({ migration: AMBIENT_JUDGE_MIGRATION_ID, before: graph.purposes, after: migrated.ambient }),
        graph: migrated.graph, result: { migration: AMBIENT_JUDGE_MIGRATION_ID }, migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(record) } });
    } catch {
      return fail({ reason: 'unavailable' }, previous);
    }
    if (result.status === 'committed') {
      input.logger?.info(`ambient_judge_migrated | revision: ${migrated.graph.revision} | ${migrated.rows.map(row => `${row.field}: ${Array.isArray(row.value) ? row.value.join(',') : row.value} (${row.from})`).join(' | ') || 'defaults only'}`
        + ' | revert: zhin ai purposes revert ambient-judge');
      return Object.freeze({ status: 'migrated', record });
    }
    if (result.status === 'conflict' && result.reason === 'revision') continue;
    return fail({ reason: result.status === 'conflict' ? 'conflict' : 'not-committed' }, previous);
  }
  return fail({ reason: 'conflict' }, previous);
}

/**
 * After the migration (H2): a value of the retired yml keys that differs from the one last acted
 * on is a new write (an older Console, a hand edit) and is converted into `purposes.ambient`; a key
 * removed from the file (`zhin doctor --fix`) changes nothing but the record.
 */
async function convertTriggerWrites(input: Readonly<{
  store: AmbientJudgeMigrationStore; rootId: string; graph: ProviderGraph; values: AmbientTriggerValues; now: () => number;
  previous: Readonly<{ revision: number; record?: AmbientJudgeMigrationRecord }>; logger?: AmbientJudgeMigrationLogger;
}>): Promise<AmbientJudgeMigrationResult | 'retry'> {
  const { store, rootId, graph, values, previous } = input;
  const record = previous.record;
  const stored = graph.purposes.ambient;
  if (record?.status !== 'migrated' || !stored) return Object.freeze({ status: 'none' });
  const seen = record.triggerSeen ?? record.triggerValues ?? {};
  if (isDeepStrictEqual(plain(seen), plain(values))) return Object.freeze({ status: 'none' });
  const changed = (['minConfidence', 'mode'] as const).filter(key => values[key] !== undefined && values[key] !== seen[key]);
  const next: AmbientJudgeMigrationRecord = Object.freeze({ ...record, triggerSeen: values });
  if (!changed.length) {
    await store.writeMigrationRecord({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(next), expectedRevision: previous.revision, requireStatus: 'migrated' }).catch(() => 'conflict');
    return Object.freeze({ status: 'none' });
  }
  const ambient: AmbientJudgePolicy = Object.freeze({ ...stored, ...Object.fromEntries(changed.map(key => [key, values[key]])) });
  const nextGraph = normalizeProviderGraph(plain({ ...graph, revision: graph.revision + 1, purposes: { ...graph.purposes, ambient } }));
  let result: ProviderMutationResult;
  try {
    result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:trigger:${graph.revision}`,
      fingerprint: providerPlanFingerprint({ trigger: AMBIENT_JUDGE_MIGRATION_ID, ambient }), graph: nextGraph, result: { trigger: AMBIENT_JUDGE_MIGRATION_ID },
      migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(next) } });
  } catch {
    return Object.freeze({ status: 'none' });
  }
  if (result.status === 'conflict' && result.reason === 'revision') return 'retry';
  if (result.status !== 'committed') return Object.freeze({ status: 'none' });
  const keys = changed.map(key => `ai.trigger.ambient.${key}`);
  input.logger?.info(`ambient_trigger_write_converted | ${changed.map(key => `${key}: ${String(values[key])}`).join(' | ')}`
    + ' | the retired keys were written after the migration: applied to purposes.ambient (Console「插话判断」)');
  return Object.freeze({ status: 'converted', record: next, keys: Object.freeze(keys) });
}

export type AmbientJudgeRevertResult =
  | Readonly<{ status: 'reverted'; graphRevision: number }>
  | Readonly<{ status: 'refused'; reason: 'no-migration' | 'already-reverted' | 'changed' | 'conflict' | 'not-committed' }>
  /** The restored form does not validate (e.g. a Profile it names was removed since); `path` names it. */
  | Readonly<{ status: 'refused'; reason: 'invalid-graph'; path?: string }>;

/**
 * `zhin ai purposes revert ambient-judge` (D5.5): restores the stored legacy fields of the record's
 * `before`, only while `purposes.ambient` is exactly what the migration wrote. The yml keys it read
 * are written back by the CLI (it owns the configuration file). Run it before a downgrade: an older
 * version cannot read a graph with `purposes.ambient`.
 */
export async function revertAmbientJudgeMigration(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number }>): Promise<AmbientJudgeRevertResult> {
  const { store, rootId } = input;
  const record = await readAmbientJudgeMigration(store, rootId);
  if (!record || !record.before || record.status === 'failed') return Object.freeze({ status: 'refused', reason: 'no-migration' });
  if (record.status === 'reverted') return Object.freeze({ status: 'refused', reason: 'already-reverted' });
  const graph = await store.readGraph({ rootId });
  if (!graph || !isDeepStrictEqual(plain(graph.purposes.ambient ?? null), plain(record.after ?? null))) {
    return Object.freeze({ status: 'refused', reason: 'changed' });
  }
  // Every other purpose stays as it is now; only the judge goes back to its stored form before the
  // migration (a `purposes.ambient` seeded before it is restored as well).
  const before = record.before;
  const { ambient: _ambient, ...current } = withoutLegacyAmbientJudge(graph.purposes);
  const purposes = { ...current,
    ...(before.ambient ? { ambient: before.ambient } : {}),
    defaults: { ...current.defaults, ...(before.defaults.ambient !== undefined ? { ambient: before.defaults.ambient } : {}),
      ...(before.defaults.ambientFallbacks !== undefined ? { ambientFallbacks: before.defaults.ambientFallbacks } : {}) },
    ...(before.decisions?.ambient !== undefined ? { decisions: { ...current.decisions, ambient: before.decisions.ambient } } : {}) };
  let next: ProviderGraph;
  try {
    next = normalizeProviderGraph(plain({ ...graph, revision: graph.revision + 1, purposes }));
  } catch (error) {
    const path = error instanceof ProviderError ? error.path : undefined;
    return Object.freeze({ status: 'refused', reason: 'invalid-graph', ...(path ? { path } : {}) });
  }
  const reverted: AmbientJudgeMigrationRecord = Object.freeze({ ...record, status: 'reverted', revertedAt: (input.now ?? Date.now)() });
  const result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:revert:${graph.revision}`,
    fingerprint: providerPlanFingerprint({ revert: AMBIENT_JUDGE_MIGRATION_ID, purposes }), graph: next, result: { revert: AMBIENT_JUDGE_MIGRATION_ID },
    migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(reverted) } });
  if (result.status === 'committed') return Object.freeze({ status: 'reverted', graphRevision: next.revision });
  return Object.freeze({ status: 'refused', reason: result.status === 'conflict' ? 'conflict' : 'not-committed' });
}

/**
 * Marks the migration result as shown by `zhin doctor` (D5.4); later runs show it only with
 * `--verbose`. A compare-and-set on the record's revision while it is still `migrated`: a revert
 * (or another doctor) in between wins and nothing is overwritten.
 */
export async function noticeAmbientJudgeMigration(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number }>): Promise<AmbientJudgeMigrationRecord | undefined> {
  const entry = await input.store.readMigrationRecordEntry({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID });
  const record = asRecord(entry?.record);
  if (!entry || !record || record.status !== 'migrated' || record.noticedAt !== undefined) return record;
  const noticed: AmbientJudgeMigrationRecord = Object.freeze({ ...record, noticedAt: (input.now ?? Date.now)() });
  const written = await input.store.writeMigrationRecord({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(noticed),
    expectedRevision: entry.revision, requireStatus: 'migrated' });
  return written === 'written' ? noticed : readAmbientJudgeMigration(input.store, input.rootId);
}
