/**
 * ADR 0066 D5: the one-time migration of the interjection judge.
 *
 * When the Host loads the Provider graph and finds a legacy ambient field (`defaults.ambient`,
 * `defaults.ambientFallbacks`, `decisions.ambient`) — or, with nothing stored yet, the retired yml
 * keys `ai.trigger.ambient.minConfidence` / `mode` — it computes `purposes.ambient` by the D5 table,
 * removes the legacy fields and writes both back in one CAS transaction (revision + 1) together with
 * the record `{ id, at, before, after, rows, notes }`. `before` is the complete `purposes` before
 * the migration, for `zhin ai purposes revert ambient-judge`.
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
  /** Retired yml keys read by the migration. */
  readonly triggerKeys?: readonly string[];
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
  writeMigrationRecord(input: Readonly<{ rootId: string; id: string; record: JsonObject }>): Promise<void>;
  commitMigration(input: CommitProviderGraphInput & Readonly<{ migration: Readonly<{ id: string; record: JsonObject }> }>): Promise<ProviderMutationResult>;
}

export interface AmbientJudgeMigrationLogger {
  info(message: string): void;
  error(message: string): void;
}

export type AmbientJudgeMigrationResult =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'migrated'; record: AmbientJudgeMigrationRecord }>
  | Readonly<{ status: 'failed'; record: AmbientJudgeMigrationRecord }>;

const MAX_ATTEMPTS = 3;

function asRecord(value: JsonObject | undefined): AmbientJudgeMigrationRecord | undefined {
  return value && value.id === AMBIENT_JUDGE_MIGRATION_ID ? value as unknown as AmbientJudgeMigrationRecord : undefined;
}

/** The stored record of this root's ADR 0066 migration, if any. */
export async function readAmbientJudgeMigration(store: Pick<AmbientJudgeMigrationStore, 'readMigrationRecord'>, rootId: string): Promise<AmbientJudgeMigrationRecord | undefined> {
  return asRecord(await store.readMigrationRecord({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID }));
}

/**
 * Whether this graph still needs the migration: a legacy stored field, or — while nothing is stored
 * and no migration ran — the retired yml keys. A reverted migration is not repeated automatically:
 * the legacy fields then run converted in memory (same behaviour) until someone writes `purposes.ambient`.
 */
export function needsAmbientJudgeMigration(graph: ProviderGraph, trigger: LegacyAmbientTrigger | undefined, record: AmbientJudgeMigrationRecord | undefined): boolean {
  if (record?.status === 'reverted') return false;
  if (hasLegacyAmbientJudgeFields(graph.purposes)) return true;
  return !graph.purposes.ambient && record?.status !== 'migrated' && legacyAmbientTriggerKeys(trigger).length > 0;
}

/** The graph after the migration, by the D5 table (pure; throws `ProviderError` with a path when invalid). */
export function migrateAmbientJudgeGraph(graph: ProviderGraph, trigger: LegacyAmbientTrigger | undefined, hostOwnerId: string): Readonly<{
  graph: ProviderGraph; ambient: AmbientJudgePolicy; rows: readonly AmbientJudgeMigrationRow[]; notes: readonly AmbientJudgeMigrationNote[];
}> {
  const conversion = convertLegacyAmbientJudge(graph.purposes, trigger);
  const next = normalizeProviderGraph(JSON.parse(JSON.stringify({ ...graph, revision: graph.revision + 1,
    purposes: { ...withoutLegacyAmbientJudge(graph.purposes), ambient: conversion.ambient } })));
  // Deployment policy: every judge Profile must be the Host's own (as a plan import requires).
  const ambient = next.purposes.ambient ?? {};
  const references: Array<[string | undefined, string]> = [[ambient.profile, 'purposes.ambient.profile'],
    ...(ambient.fallbacks ?? []).map((id, index): [string, string] => [id, `purposes.ambient.fallbacks[${index}]`]), [ambient.compare, 'purposes.ambient.compare']];
  for (const [id, path] of references) {
    if (id !== undefined && next.profiles[id]?.ownerId !== hostOwnerId) throw Object.assign(new ProviderError('forbidden', path), { notVisible: true });
  }
  return Object.freeze({ graph: next, ambient: conversion.ambient, rows: conversion.rows, notes: conversion.notes });
}

/**
 * Runs the migration once for `rootId` when needed (D5.1–D5.3). Never throws: a failure is
 * logged (`ambient_judge_migration_failed`) and recorded, and the generation keeps converting in memory.
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
  const fail = async (failure: NonNullable<AmbientJudgeMigrationRecord['failure']>, previous?: AmbientJudgeMigrationRecord): Promise<AmbientJudgeMigrationResult> => {
    const record: AmbientJudgeMigrationRecord = Object.freeze({ ...(previous?.status === 'failed' ? previous : {}), id: AMBIENT_JUDGE_MIGRATION_ID,
      status: 'failed', at: now(), failure: Object.freeze({ ...failure }) });
    input.logger?.error(`ambient_judge_migration_failed | reason: ${failure.reason}${failure.path ? ` | path: ${failure.path}` : ''}`
      + ' | the interjection judge runs on the legacy configuration converted in memory; the next load retries');
    try { await store.writeMigrationRecord({ rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: record as unknown as JsonObject }); } catch { /* The log line above stays. */ }
    return Object.freeze({ status: 'failed', record });
  };
  let previous: AmbientJudgeMigrationRecord | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let graph: ProviderGraph | undefined;
    try {
      graph = await store.readGraph({ rootId });
      previous = await readAmbientJudgeMigration(store, rootId);
    } catch {
      return Object.freeze({ status: 'none' });
    }
    if (!graph || !needsAmbientJudgeMigration(graph, input.trigger, previous)) return Object.freeze({ status: 'none' });
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
      ...(triggerKeys.length ? { triggerKeys } : {}) });
    const plain = JSON.parse(JSON.stringify(record)) as JsonObject;
    let result: ProviderMutationResult;
    try {
      result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:${graph.revision}`,
        fingerprint: providerPlanFingerprint({ migration: AMBIENT_JUDGE_MIGRATION_ID, before: graph.purposes, after: migrated.ambient }),
        graph: migrated.graph, result: { migration: AMBIENT_JUDGE_MIGRATION_ID }, migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: plain } });
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

export type AmbientJudgeRevertResult =
  | Readonly<{ status: 'reverted'; graphRevision: number }>
  | Readonly<{ status: 'refused'; reason: 'no-migration' | 'already-reverted' | 'changed' | 'conflict' | 'not-committed' }>;

/**
 * `zhin ai purposes revert ambient-judge` (D5.5): restores `purposes` to the record's `before`, only
 * while `purposes.ambient` is exactly what the migration wrote. Run it before a downgrade: an older
 * version cannot read a graph with `purposes.ambient`.
 */
export async function revertAmbientJudgeMigration(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number }>): Promise<AmbientJudgeRevertResult> {
  const { store, rootId } = input;
  const record = await readAmbientJudgeMigration(store, rootId);
  if (!record || !record.before || record.status === 'failed') return Object.freeze({ status: 'refused', reason: 'no-migration' });
  if (record.status === 'reverted') return Object.freeze({ status: 'refused', reason: 'already-reverted' });
  const graph = await store.readGraph({ rootId });
  if (!graph || !isDeepStrictEqual(JSON.parse(JSON.stringify(graph.purposes.ambient ?? null)), JSON.parse(JSON.stringify(record.after ?? null)))) {
    return Object.freeze({ status: 'refused', reason: 'changed' });
  }
  // Every other purpose stays as it is now; only the judge goes back to its legacy fields.
  const before = record.before;
  const { ambient: _ambient, ...current } = withoutLegacyAmbientJudge(graph.purposes);
  const purposes = { ...current,
    defaults: { ...current.defaults, ...(before.defaults.ambient !== undefined ? { ambient: before.defaults.ambient } : {}),
      ...(before.defaults.ambientFallbacks !== undefined ? { ambientFallbacks: before.defaults.ambientFallbacks } : {}) },
    ...(before.decisions?.ambient !== undefined ? { decisions: { ...current.decisions, ambient: before.decisions.ambient } } : {}) };
  let next: ProviderGraph;
  try {
    next = normalizeProviderGraph(JSON.parse(JSON.stringify({ ...graph, revision: graph.revision + 1, purposes })));
  } catch {
    return Object.freeze({ status: 'refused', reason: 'changed' });
  }
  const reverted: AmbientJudgeMigrationRecord = Object.freeze({ ...record, status: 'reverted', revertedAt: (input.now ?? Date.now)() });
  const result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:revert:${graph.revision}`,
    fingerprint: providerPlanFingerprint({ revert: AMBIENT_JUDGE_MIGRATION_ID, purposes }), graph: next, result: { revert: AMBIENT_JUDGE_MIGRATION_ID },
    migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: JSON.parse(JSON.stringify(reverted)) as JsonObject } });
  if (result.status === 'committed') return Object.freeze({ status: 'reverted', graphRevision: next.revision });
  return Object.freeze({ status: 'refused', reason: result.status === 'conflict' ? 'conflict' : 'not-committed' });
}

/** Marks the migration result as shown by `zhin doctor` (D5.4); later runs show it only with `--verbose`. */
export async function noticeAmbientJudgeMigration(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number }>): Promise<AmbientJudgeMigrationRecord | undefined> {
  const record = await readAmbientJudgeMigration(input.store, input.rootId);
  if (!record || record.status !== 'migrated' || record.noticedAt !== undefined) return record;
  const noticed: AmbientJudgeMigrationRecord = Object.freeze({ ...record, noticedAt: (input.now ?? Date.now)() });
  await input.store.writeMigrationRecord({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: JSON.parse(JSON.stringify(noticed)) as JsonObject });
  return noticed;
}
