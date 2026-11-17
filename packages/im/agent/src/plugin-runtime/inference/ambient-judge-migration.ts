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
  /**
   * Set by `zhin ai purposes revert ambient-judge` while it writes the yml keys back and reverts
   * (N1): no yml change is converted meanwhile. Ignored after {@link AMBIENT_JUDGE_REVERT_PENDING_MS}.
   */
  readonly revertPending?: Readonly<{ at: number }>;
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
/** A revert that never cleared its pending mark (a crashed CLI) stops pausing conversions after this long. */
export const AMBIENT_JUDGE_REVERT_PENDING_MS = 10 * 60_000;

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
  // A revert is writing the yml keys back right now: nothing it writes is a new value (N1).
  if (record.revertPending && input.now() - record.revertPending.at < AMBIENT_JUDGE_REVERT_PENDING_MS) return Object.freeze({ status: 'none' });
  const seen = record.triggerSeen ?? record.triggerValues ?? {};
  if (isDeepStrictEqual(plain(seen), plain(values))) return Object.freeze({ status: 'none' });
  // Both sides are normalized values (`legacyAmbientTriggerValues`). A value equal to the one the
  // migration read is no new information while the stored judge still holds what the migration
  // folded it into (N1); once that key was changed since (an older Console switched it, R1), the
  // original value is a real write back and is converted like any other.
  const changed = pendingAmbientTriggerWrites(record, stored, values);
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

/**
 * The yml keys whose (normalized) value is a write not yet converted into `purposes.ambient`
 * (R1 / S1): different from the value already acted on, and not the migration's own value while
 * the stored judge still holds what the migration wrote for that key. One rule for the conversion
 * on load, the revert's refusal and `zhin doctor`.
 */
export function pendingAmbientTriggerWrites(record: AmbientJudgeMigrationRecord, stored: AmbientJudgePolicy, values: AmbientTriggerValues): ('minConfidence' | 'mode')[] {
  const seen = record.triggerSeen ?? record.triggerValues ?? {};
  const original = record.triggerValues ?? {};
  const after = record.after ?? {};
  return (['minConfidence', 'mode'] as const).filter(key => values[key] !== undefined && values[key] !== seen[key]
    && !(values[key] === original[key] && stored[key] === after[key]));
}

export type AmbientJudgeRevertResult =
  /**
   * `yml`: threshold / mode of a `purposes.ambient` seeded before the migration, which an older
   * version reads from `ai.trigger.ambient` (the CLI writes them); `lost`: what the legacy form
   * cannot express (an older version would run differently), with the reason.
   */
  | Readonly<{ status: 'reverted'; graphRevision: number; yml?: AmbientTriggerValues; lost?: readonly string[] }>
  /** `dryRun`: the revert would succeed with these yml values and losses; nothing was written. */
  | Readonly<{ status: 'ready'; yml?: AmbientTriggerValues; lost?: readonly string[] }>
  | Readonly<{ status: 'refused'; reason: 'no-migration' | 'already-reverted' | 'changed' | 'conflict' | 'not-committed' }>
  /** The restored form does not validate (e.g. a Profile it names was removed since); `path` names it. */
  | Readonly<{ status: 'refused'; reason: 'invalid-graph'; path?: string }>
  /**
   * The yml has a write to the retired keys not converted yet (S1): reverting now would replace it
   * with the migration's values. Reload or restart the instance, then revert.
   */
  | Readonly<{ status: 'refused'; reason: 'pending-trigger-writes'; keys: readonly string[] }>;

/**
 * `zhin ai purposes revert ambient-judge` (D5.5): restores the stored legacy fields of the record's
 * `before`, only while `purposes.ambient` is exactly what the migration wrote. The yml keys it read
 * are written back by the CLI (it owns the configuration file). Run it before a downgrade: an older
 * version cannot read a graph with `purposes.ambient`.
 */
export async function revertAmbientJudgeMigration(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number;
  /** Compute only (R2): the yml values and what cannot be expressed, without committing anything. */
  dryRun?: boolean;
  /** The yml's retired keys as the file says now (read before the revert writes it, S1). */
  trigger?: LegacyAmbientTrigger }>): Promise<AmbientJudgeRevertResult> {
  const { store, rootId } = input;
  const record = await readAmbientJudgeMigration(store, rootId);
  if (!record || !record.before || record.status === 'failed') return Object.freeze({ status: 'refused', reason: 'no-migration' });
  if (record.status === 'reverted') return Object.freeze({ status: 'refused', reason: 'already-reverted' });
  const graph = await store.readGraph({ rootId });
  if (!graph) return Object.freeze({ status: 'refused', reason: 'changed' });
  // Unchanged since the migration, except for threshold / mode values converted from the yml (they
  // are still in the yml and go back there, S1): anything else changed is not reverted automatically.
  const stored: AmbientJudgePolicy = graph.purposes.ambient ?? {};
  const after: AmbientJudgePolicy = record.after ?? {};
  const seen = record.triggerSeen ?? record.triggerValues ?? {};
  const converted = (['minConfidence', 'mode'] as const).filter(key => stored[key] !== after[key]);
  const rest = (policy: AmbientJudgePolicy) => { const { minConfidence: _m, mode: _o, ...others } = policy; return plain(others); };
  if (!graph.purposes.ambient || !isDeepStrictEqual(rest(stored), rest(after)) || converted.some(key => stored[key] === undefined || seen[key] !== stored[key])) {
    return Object.freeze({ status: 'refused', reason: 'changed' });
  }
  // A write to the yml keys not converted yet would be overwritten by the migration's values (S1).
  if (input.trigger) {
    const pending = pendingAmbientTriggerWrites(record, graph.purposes.ambient ?? {}, legacyAmbientTriggerValues(input.trigger));
    if (pending.length) return Object.freeze({ status: 'refused', reason: 'pending-trigger-writes', keys: Object.freeze(pending.map(key => `ai.trigger.ambient.${key}`)) });
  }
  // Every other purpose stays as it is now; only the judge goes back to its legacy stored form. A
  // `purposes.ambient` that existed before the migration (seeded) is converted back by the D5 table
  // too (N2), so an older version can read the graph; what it cannot express is reported.
  const before = record.before;
  const { ambient: _ambient, ...current } = withoutLegacyAmbientJudge(graph.purposes);
  const reversed = before.ambient ? reverseAmbientJudge(before.ambient, graph) : undefined;
  const language = reversed ? reversed.language : { profile: before.defaults.ambient, fallbacks: before.defaults.ambientFallbacks };
  let decision = reversed ? reversed.decision : before.decisions?.ambient;
  // A threshold converted from the yml since: an active legacy decision gates with it too, so the
  // older version's max(yml, decision) is that value (S1).
  if (converted.includes('minConfidence') && decision?.mode === 'active' && stored.minConfidence !== undefined) {
    decision = { ...decision, minConfidence: stored.minConfidence };
  }
  const purposes = { ...current,
    defaults: { ...current.defaults, ...(language.profile !== undefined ? { ambient: language.profile } : {}),
      ...(language.profile !== undefined && language.fallbacks?.length ? { ambientFallbacks: language.fallbacks } : {}) },
    ...(decision !== undefined ? { decisions: { ...current.decisions, ambient: decision } } : {}) };
  let next: ProviderGraph;
  try {
    next = normalizeProviderGraph(plain({ ...graph, revision: graph.revision + 1, purposes }));
  } catch (error) {
    const path = error instanceof ProviderError ? error.path : undefined;
    return Object.freeze({ status: 'refused', reason: 'invalid-graph', ...(path ? { path } : {}) });
  }
  // The yml values an older version must read so it runs as this version does now (R2): the yml
  // values the migration read, overridden by the seeded judge's own threshold / mode (which won
  // over them in the migration).
  const yml: AmbientTriggerValues = Object.freeze({ ...(record.triggerValues ?? {}), ...(reversed?.yml ?? {}),
    // Values converted from the yml since the migration are what this version runs with now.
    ...Object.fromEntries(converted.map(key => [key, stored[key]])) });
  const facts = { ...(Object.keys(yml).length ? { yml } : {}), ...(reversed?.lost.length ? { lost: Object.freeze([...reversed.lost]) } : {}) };
  if (input.dryRun) return Object.freeze({ status: 'ready', ...facts });
  const { revertPending: _pending, ...settled } = record;
  const reverted: AmbientJudgeMigrationRecord = Object.freeze({ ...settled, status: 'reverted', revertedAt: (input.now ?? Date.now)() });
  const result = await store.commitMigration({ rootId, expectedRevision: graph.revision, mutationId: `${AMBIENT_JUDGE_MIGRATION_ID}:revert:${graph.revision}`,
    fingerprint: providerPlanFingerprint({ revert: AMBIENT_JUDGE_MIGRATION_ID, purposes }), graph: next, result: { revert: AMBIENT_JUDGE_MIGRATION_ID },
    migration: { id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(reverted) } });
  if (result.status === 'committed') return Object.freeze({ status: 'reverted', graphRevision: next.revision, ...facts });
  return Object.freeze({ status: 'refused', reason: result.status === 'conflict' ? 'conflict' : 'not-committed' });
}

/**
 * `purposes.ambient` in the legacy stored form, by the D5 table read backwards (N2): a decision
 * main judge becomes an active `decisions.ambient` (its language fallbacks the language purpose), a
 * decision compared model a shadow `decisions.ambient`; the threshold and mode go to the yml keys an
 * older version reads. `lost` names what the legacy form cannot express.
 */
export function reverseAmbientJudge(policy: AmbientJudgePolicy, graph: ProviderGraph): Readonly<{
  language: Readonly<{ profile?: string; fallbacks?: readonly string[] }>;
  decision?: Readonly<{ profile: string; mode: 'active' | 'shadow'; timeoutMs?: number; minConfidence?: number }>;
  yml: AmbientTriggerValues;
  lost: readonly string[];
}> {
  const decisionOnly = (id: string | undefined): boolean => {
    if (id === undefined) return false;
    const profile = Object.hasOwn(graph.profiles, id) ? graph.profiles[id] : undefined;
    const account = profile ? graph.accounts[profile.accountId] : undefined;
    const kinds = profile && account ? graph.services[account.serviceId]?.models[profile.model]?.kinds ?? [] : [];
    return kinds.includes('decision') && !kinds.includes('language');
  };
  const lost: string[] = [];
  const fallbacks = policy.fallbacks ?? [];
  const languages = fallbacks.filter(id => !decisionOnly(id));
  fallbacks.filter(decisionOnly).forEach(id => lost.push(`purposes.ambient.fallbacks 中的决策模型 ${id}（旧版本的备用链只能是语言模型）`));
  const timeout = policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {};
  let language: { profile?: string; fallbacks?: readonly string[] } = {};
  let decision: { profile: string; mode: 'active' | 'shadow'; timeoutMs?: number; minConfidence?: number } | undefined;
  if (decisionOnly(policy.profile)) {
    decision = { profile: policy.profile!, mode: 'active', ...timeout, ...(policy.minConfidence !== undefined ? { minConfidence: policy.minConfidence } : {}) };
    if (languages.length) {
      language = { profile: languages[0], ...(languages.length > 1 ? { fallbacks: languages.slice(1) } : {}) };
      lost.push(`决策模型 ${policy.profile} 失败时换到语言模型 ${languages[0]}（旧版本此时不插话）`);
    }
    if (policy.compare !== undefined) lost.push(`对照模型 ${policy.compare}（旧版本不能同时启用决策模型和对照）`);
  } else {
    language = { ...(policy.profile !== undefined ? { profile: policy.profile } : {}), ...(policy.profile !== undefined && languages.length ? { fallbacks: languages } : {}) };
    if (policy.profile === undefined && languages.length) lost.push('purposes.ambient.fallbacks（没有主项时旧版本跟随聊天的备用链）');
    if (decisionOnly(policy.compare)) decision = { profile: policy.compare!, mode: 'shadow', ...timeout };
    else if (policy.compare !== undefined) lost.push(`对照模型 ${policy.compare}（旧版本只能用决策模型陪跑）`);
  }
  const yml: AmbientTriggerValues = Object.freeze({ ...(policy.minConfidence !== undefined ? { minConfidence: policy.minConfidence } : {}),
    ...(policy.mode ? { mode: policy.mode } : {}) });
  return Object.freeze({ language: Object.freeze(language), ...(decision ? { decision: Object.freeze(decision) } : {}), yml, lost: Object.freeze(lost) });
}

/** Pauses yml conversions while the revert command writes the yml keys back (N1). */
export async function beginAmbientJudgeRevert(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string; now?: () => number }>): Promise<'pending' | 'no-migration' | 'conflict'> {
  const entry = await input.store.readMigrationRecordEntry({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID });
  const record = asRecord(entry?.record);
  if (!entry || record?.status !== 'migrated') return 'no-migration';
  const written = await input.store.writeMigrationRecord({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID,
    record: plain({ ...record, revertPending: { at: (input.now ?? Date.now)() } }), expectedRevision: entry.revision, requireStatus: 'migrated' });
  return written === 'written' ? 'pending' : 'conflict';
}

/** Clears the pending mark of {@link beginAmbientJudgeRevert}, whether the revert succeeded or not. */
export async function endAmbientJudgeRevert(input: Readonly<{ store: AmbientJudgeMigrationStore; rootId: string }>): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const entry = await input.store.readMigrationRecordEntry({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID });
    const record = asRecord(entry?.record);
    if (!entry || !record?.revertPending) return;
    const { revertPending: _pending, ...cleared } = record;
    if (await input.store.writeMigrationRecord({ rootId: input.rootId, id: AMBIENT_JUDGE_MIGRATION_ID, record: plain(cleared), expectedRevision: entry.revision }) === 'written') return;
  }
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
