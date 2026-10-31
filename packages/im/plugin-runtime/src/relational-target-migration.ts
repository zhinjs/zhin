import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { generationAdmissionSource } from './admission.js';
import type { DatabaseHostTransaction, PluginDatabaseHost } from './database-host.js';
import { normalizeDeliveryTarget, type DeliveryTarget } from './delivery-target.js';
import {
  DataMigrationError,
  type DataMigrationCandidate,
  type DataMigrationPlan,
  type DataMigrationReceipt,
  type DataMigrationInspection,
  type PluginDataMigrationProvider,
} from './data-migration.js';
import type { JsonValue } from './persistent-state.js';

const JOURNAL_TABLE = 'target_migration_journal';
type Row = Record<string, unknown>;

/** One business-key row set; identical keyless rows remain an indivisible group. */
export interface TargetMigrationRows {
  readonly table: string;
  readonly query: Readonly<Row>;
  readonly rows: readonly Row[];
}
export interface TargetMigrationWrite {
  readonly before: TargetMigrationRows;
  readonly after: TargetMigrationRows;
  readonly patch: Readonly<Row>;
}
export interface RelationalTargetMigrationUnit {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly status: DataMigrationCandidate['status'];
  readonly records: readonly TargetMigrationRows[];
  readonly summary: Readonly<Record<string, JsonValue>>;
  readonly authorizationCandidates?: readonly JsonValue[];
}
export interface RelationalTargetMigrationOptions {
  /** Owner-qualified Host facade; raw process tables never enter the provider. */
  readonly database: PluginDatabaseHost;
  readonly domain: string;
  readonly title: string;
  readonly sourceVersion: string;
  /** All tables that this domain is allowed to read or change. */
  readonly tables: readonly string[];
  readonly scopes: TargetMigrationScopes;
  readUnits(reader: DatabaseHostTransaction): Promise<readonly RelationalTargetMigrationUnit[]>;
  /** Rewrites routing only. Domain state, deadlines, IDs and revision fields are retained. */
  rewrite(
    unit: RelationalTargetMigrationUnit,
    target: DeliveryTarget,
  ): {
    readonly writes: readonly TargetMigrationWrite[];
    readonly destinationScope: string;
  };
}

/** Stable, lossless digest; this does not impose the small-object StateStore size limit. */
export function targetMigrationDigest(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined || typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol') {
      throw new DataMigrationError('unsupported', 'Migration records must contain lossless JSON values');
    }
    if (typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0))) {
      throw new DataMigrationError('unsupported', 'Migration records contain an unsupported numeric value');
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new DataMigrationError('unsupported', 'Migration records must be plain database rows');
      }
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
  return createHash('sha256').update(json).digest('hex');
}
export function orderedMigrationRows(rows: readonly Row[]): readonly Row[] {
  return rows
    .map((row) => ({ row, digest: targetMigrationDigest(row) }))
    .sort((a, b) => a.digest.localeCompare(b.digest))
    .map((item) => item.row);
}
function unitDigest(unit: RelationalTargetMigrationUnit): string {
  return targetMigrationDigest(unit.records.map((set) => ({ ...set, rows: orderedMigrationRows(set.rows) })));
}

/** Per-instance scope admission. Existing work drains; unrelated scopes continue. */
export class TargetMigrationScopes {
  readonly #pending: (scope: string) => boolean;
  readonly #paused = new Map<string, string>();
  readonly #running = new Map<string, Set<Promise<unknown>>>();
  readonly #context = new AsyncLocalStorage<ReadonlyMap<string, { active: boolean }>>();
  #initialize: () => Promise<void> = async () => undefined;
  #ready?: Promise<void>;
  constructor(input: Readonly<{ pending: (scope: string) => boolean }>) {
    this.#pending = input.pending;
  }
  bindInitialization(initialize: () => Promise<void>): void {
    this.#initialize = initialize;
  }
  async run<T>(input: Readonly<{ scope: string; run: () => Promise<T> }>): Promise<T> {
    const inherited = this.#context.getStore();
    // Accepted work may continue inside its scope, but every nested call owns its actual wait.
    if (!inherited?.get(input.scope)?.active) {
      await this.#ensureReady();
      if (this.#paused.has(input.scope) || this.#pending(input.scope)) {
        throw new DataMigrationError(
          'unavailable',
          'This historical scope is awaiting target binding or maintenance resumption',
        );
      }
    }
    const lease = { active: true },
      context = new Map(inherited);
    context.set(input.scope, lease);
    const jobs = this.#running.get(input.scope) ?? new Set();
    this.#running.set(input.scope, jobs);
    const work = Promise.resolve().then(() => this.#context.run(context, input.run));
    jobs.add(work);
    try {
      return await work;
    } finally {
      lease.active = false;
      jobs.delete(work);
      if (!jobs.size) this.#running.delete(input.scope);
    }
  }
  async pause(
    input: Readonly<{ planId: string; scopes: readonly string[]; persist: () => Promise<void> }>,
  ): Promise<void> {
    await this.#ensureReady();
    for (const scope of input.scopes) {
      const owner = this.#paused.get(scope);
      if (owner && owner !== input.planId)
        throw new DataMigrationError('conflict', 'Scope belongs to another maintenance plan');
    }
    for (const scope of input.scopes) this.#paused.set(scope, input.planId);
    await input.persist();
    // A running operation can admit a nested continuation while this pause is awaiting it.
    while (!this.drained(input.scopes)) {
      await Promise.allSettled(input.scopes.flatMap((scope) => [...(this.#running.get(scope) ?? [])]));
    }
  }
  drained(scopes: readonly string[]): boolean {
    return scopes.every(scope => !this.#running.get(scope)?.size);
  }

  maintenance(planId: string, scopes: readonly string[]): 'paused' | 'resumed' | 'unknown' {
    const owners = scopes.map((scope) => this.#paused.get(scope)).filter((owner) => owner !== undefined);
    if (owners.some((owner) => owner !== planId)) return 'unknown';
    return owners.length ? 'paused' : 'resumed';
  }
  restorePause(planId: string, scopes: readonly string[]): void {
    for (const scope of scopes) this.#paused.set(scope, planId);
  }
  resume(planId: string, scopes: readonly string[]): void {
    for (const scope of scopes) if (this.#paused.get(scope) === planId) this.#paused.delete(scope);
  }
  #ensureReady(): Promise<void> {
    if (this.#ready) return this.#ready;
    const ready = Promise.resolve().then(this.#initialize).catch(error => {
      if (this.#ready === ready) this.#ready = undefined;
      throw error;
    });
    this.#ready = ready;
    return ready;
  }
}

interface RelationalPlanData {
  readonly format: 'relational-target-v1';
  readonly scopes: readonly string[];
  readonly writes: readonly TargetMigrationWrite[];
  readonly observed: readonly TargetMigrationRows[];
}
function planData(plan: DataMigrationPlan): RelationalPlanData {
  const value = plan.data as unknown as RelationalPlanData;
  if (!value || value.format !== 'relational-target-v1')
    throw new DataMigrationError('invalid_input', 'Unexpected domain migration plan format');
  return value;
}
function jsonValue(value: unknown): JsonValue {
  targetMigrationDigest(value);
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
function journalReceipt(row: Row): DataMigrationReceipt | undefined {
  if (row.last_operation !== 'apply' && row.last_operation !== 'restore') return undefined;
  return {
    operation: row.last_operation,
    planId: String(row.plan_id),
    candidateId: String(row.candidate_id),
    beforeDigest: String(row.before_digest),
    afterDigest: String(row.after_digest),
    recordCount: Number(row.record_count),
    status: 'applied',
    maintenance: 'paused',
  };
}

/** Shared only by the concrete game and subscription target migrations. No raw-SQL or generic schema discovery. */
export function createRelationalTargetMigration(
  options: RelationalTargetMigrationOptions,
): PluginDataMigrationProvider {
  const { database, scopes } = options;
  database.define(JOURNAL_TABLE, {
    plan_id: { type: 'text', primary: true },
    candidate_id: { type: 'text', nullable: false },
    plan_digest: { type: 'text', nullable: false },
    before_digest: { type: 'text', nullable: false },
    after_digest: { type: 'text', default: '' },
    record_count: { type: 'integer', default: 0 },
    scopes_json: { type: 'text', nullable: false },
    phase: { type: 'text', nullable: false },
    last_operation: { type: 'text', default: '' },
    rejected_digest: { type: 'text', default: '' },
  });
  const executable = ['sqlite', 'mysql', 'pg'].includes(database.dialect);
  const model = (table: string) => {
    if (table !== JOURNAL_TABLE && !options.tables.includes(table))
      throw new DataMigrationError('invalid_input', `Unowned migration table: ${table}`);
    const result = database.models.get(table);
    if (!result) throw new DataMigrationError('unavailable', `Migration table unavailable: ${table}`);
    return result;
  };
  const reader: DatabaseHostTransaction = { model };
  scopes.bindInitialization(async () => {
    const rows = await model(JOURNAL_TABLE).select();
    for (const row of rows)
      if (row.phase !== 'resumed')
        scopes.restorePause(String(row.plan_id), JSON.parse(String(row.scopes_json)) as string[]);
  });
  const readJournal = async (planId: string, tx: DatabaseHostTransaction = reader) =>
    (await tx.model(JOURNAL_TABLE).select().where({ plan_id: planId }))[0];
  const assertPlan = (plan: DataMigrationPlan) => {
    if (plan.domain !== options.domain || plan.sourceVersion !== options.sourceVersion)
      throw new DataMigrationError('invalid_input', 'Migration plan belongs to another domain/version');
    const data = planData(plan);
    for (const set of [...data.writes.flatMap((write) => [write.before, write.after]), ...data.observed]) {
      if (!options.tables.includes(set.table))
        throw new DataMigrationError('invalid_input', 'Migration plan contains an unowned table');
    }
    return data;
  };
  const verify = async (sets: readonly TargetMigrationRows[], tx: DatabaseHostTransaction) => {
    for (const set of sets) {
      const rows = await tx
        .model(set.table)
        .select()
        .where({ ...set.query });
      if (targetMigrationDigest(orderedMigrationRows(rows)) !== targetMigrationDigest(orderedMigrationRows(set.rows))) {
        throw new DataMigrationError('conflict', `Migration records changed in ${set.table}`);
      }
    }
  };
  const inFlight = new Set<string>();
  let mutationRevision = 0;
  const mutate = async <T>(planId: string, run: () => Promise<T>): Promise<T> => {
    if (inFlight.has(planId))
      throw new DataMigrationError('conflict', 'This migration already has an operation in progress');
    mutationRevision += 1;
    inFlight.add(planId);
    try {
      return await run();
    } finally {
      inFlight.delete(planId);
    }
  };
  const matches = async (sets: readonly TargetMigrationRows[], tx: DatabaseHostTransaction): Promise<boolean> => {
    for (const set of sets) {
      const rows = await tx
        .model(set.table)
        .select()
        .where({ ...set.query });
      if (targetMigrationDigest(orderedMigrationRows(rows)) !== targetMigrationDigest(orderedMigrationRows(set.rows)))
        return false;
    }
    return true;
  };
  const readBaseline = async (data: RelationalPlanData, tx: DatabaseHostTransaction) => {
    const sets = [...data.writes.flatMap((write) => [write.before, write.after]), ...data.observed];
    const actual = [];
    for (const set of sets)
      actual.push({
        table: set.table,
        query: set.query,
        rows: orderedMigrationRows(
          await tx
            .model(set.table)
            .select()
            .where({ ...set.query }),
        ),
      });
    return targetMigrationDigest(actual);
  };
  const inspect = async (plan: DataMigrationPlan, tx: DatabaseHostTransaction): Promise<DataMigrationInspection> => {
    const data = assertPlan(plan),
      journal = await readJournal(plan.id, tx);
    if (journal && journal.plan_digest !== targetMigrationDigest(plan))
      return { data: 'conflict', maintenance: 'unknown', resumable: false };
    const local = scopes.maintenance(plan.id, data.scopes);
    const maintenance =
      local === 'unknown'
        ? 'unknown'
        : local === 'paused' || (journal && journal.phase !== 'resumed')
        ? 'paused'
        : 'resumed';
    if (!scopes.drained(data.scopes)) return { data: 'unknown', maintenance, resumable: false };
    if (journal?.rejected_digest) {
      const verified = (await readBaseline(data, tx)) === journal.rejected_digest;
      return {
        data: verified && !journal.last_operation ? 'not_applied' : 'conflict',
        maintenance,
        resumable: verified && maintenance === 'paused',
      };
    }
    if (!(await matches(data.observed, tx))) return { data: 'conflict', maintenance, resumable: false };
    const before = await matches(
        data.writes.map((write) => write.before),
        tx,
      ),
      after = await matches(
        data.writes.map((write) => write.after),
        tx,
      );
    const emptyOtherSide = async (side: 'before' | 'after') => {
      for (const write of data.writes)
        if (targetMigrationDigest(write.before.query) !== targetMigrationDigest(write.after.query)) {
          if (
            (
              await tx
                .model(write[side].table)
                .select()
                .where({ ...write[side].query })
            ).length
          )
            return false;
        }
      return true;
    };
    const receipt = journal ? journalReceipt(journal) : undefined;
    if (receipt?.operation === 'apply' && after && (await emptyOtherSide('before')))
      return { data: 'applied', maintenance, receipt, resumable: maintenance === 'paused' };
    if (receipt?.operation === 'restore' && before && (await emptyOtherSide('after')))
      return { data: 'restored', maintenance, receipt, resumable: maintenance === 'paused' };
    if (!receipt && before && (await emptyOtherSide('after')))
      return { data: 'not_applied', maintenance, resumable: maintenance === 'paused' };
    return { data: 'conflict', maintenance, resumable: false };
  };
  const provider: PluginDataMigrationProvider = {
    title: options.title,
    get [generationAdmissionSource]() {
      return database[generationAdmissionSource];
    },
    async preview(request) {
      request?.signal?.throwIfAborted();
      const units = await options.readUnits(reader);
      const candidates = units.map((unit) => ({
        id: unit.id,
        domain: options.domain,
        title: unit.title,
        sourceVersion: options.sourceVersion,
        recordCount: unit.records.reduce((n, set) => n + set.rows.length, 0),
        beforeDigest: unitDigest(unit),
        status: unit.status,
        summary: unit.summary,
        executable: executable && unit.status === 'unresolved',
      }));
      return { revision: targetMigrationDigest(candidates), candidates };
    },
    async prepare(request) {
      request.signal?.throwIfAborted();
      const target = normalizeDeliveryTarget(request.target);
      const unit = (await options.readUnits(reader)).find((item) => item.id === request.candidateId);
      if (!unit) throw new DataMigrationError('not_found', 'Historical migration unit no longer exists');
      if (!executable || unit.status !== 'unresolved')
        throw new DataMigrationError('unsupported', 'This migration unit cannot be changed by this provider');
      if (unitDigest(unit) !== request.expectedDigest)
        throw new DataMigrationError('conflict', 'Historical migration unit changed since preview');
      const rewrite = options.rewrite(unit, target),
        writes = rewrite.writes;
      const observed = unit.records.filter((set) => !writes.some((write) => write.before === set));
      return {
        id: request.planId,
        candidateId: unit.id,
        domain: options.domain,
        sourceVersion: options.sourceVersion,
        beforeDigest: request.expectedDigest,
        target,
        recordCount: unit.records.reduce((n, set) => n + set.rows.length, 0),
        data: jsonValue({
          format: 'relational-target-v1',
          scopes: [...new Set([unit.scope, rewrite.destinationScope])],
          writes,
          observed,
        }),
        description: [
          'Bind only the selected historical scope to the administrator-selected exact target.',
          'Preserve domain state, IDs, deadlines and delivery cursors; leave the scope paused after commit.',
        ],
        authorizationCandidates: unit.authorizationCandidates ?? [],
      };
    },
    async inspect({ plan, signal }) {
      signal?.throwIfAborted();
      if (inFlight.has(plan.id)) return { data: 'unknown', maintenance: 'unknown', resumable: false };
      const revision = mutationRevision;
      const result = await database.transaction((tx) => inspect(plan, tx));
      return revision === mutationRevision && !inFlight.has(plan.id)
        ? result
        : { data: 'unknown', maintenance: 'unknown', resumable: false };
    },
    async apply({ plan, signal }) {
      return mutate(plan.id, async () => {
        const data = assertPlan(plan);
        signal?.throwIfAborted();
        const digest = targetMigrationDigest(plan);
        await scopes.pause({
          planId: plan.id,
          scopes: data.scopes,
          persist: async () => {
            await database.transaction(async (tx) => {
              const existing = await readJournal(plan.id, tx);
              if (existing) {
                if (existing.plan_digest !== digest)
                  throw new DataMigrationError('conflict', 'Plan ID already refers to different content');
              } else
                await tx
                  .model(JOURNAL_TABLE)
                  .insert({
                    plan_id: plan.id,
                    candidate_id: plan.candidateId,
                    plan_digest: digest,
                    before_digest: plan.beforeDigest,
                    scopes_json: JSON.stringify(data.scopes),
                    phase: 'pausing',
                    last_operation: '',
                    after_digest: '',
                    record_count: plan.recordCount,
                  });
            });
          },
        });
        let callbackFailure: unknown;
        try {
          return await database.transaction(async (tx) => {
            try {
              signal?.throwIfAborted();
              const existing = await readJournal(plan.id, tx);
              if (!existing || existing.plan_digest !== digest)
                throw new DataMigrationError('conflict', 'Maintenance intent changed');
              if (existing.phase === 'applied') {
                await verify(
                  data.writes.map((write) => write.after),
                  tx,
                );
                const committed = journalReceipt(existing);
                if (!committed || committed.operation !== 'apply') throw new DataMigrationError('conflict', 'Applied journal lacks matching commit evidence');
                return { ...committed, status: 'already_applied' };
              }
              if (existing.phase !== 'pausing')
                throw new DataMigrationError('conflict', 'Plan is not awaiting application');
              const fresh = await options.readUnits(tx),
                unit = fresh.find((item) => item.id === plan.candidateId);
              if (!unit || unitDigest(unit) !== plan.beforeDigest)
                throw new DataMigrationError('conflict', 'Historical unit changed before commit');
              const rewrite = options.rewrite(unit, plan.target);
              if (targetMigrationDigest(jsonValue(rewrite.writes)) !== targetMigrationDigest(jsonValue(data.writes)))
                throw new DataMigrationError('conflict', 'Plan write set differs from current domain rules');
              await verify([...data.writes.map((write) => write.before), ...data.observed], tx);
              for (const write of data.writes) {
                const source = targetMigrationDigest(write.before.query),
                  destination = targetMigrationDigest(write.after.query);
                if (
                  source !== destination &&
                  (
                    await tx
                      .model(write.after.table)
                      .select()
                      .where({ ...write.after.query })
                  ).length
                ) {
                  throw new DataMigrationError(
                    'conflict',
                    'Selected destination already contains records in this domain',
                  );
                }
                await tx
                  .model(write.before.table)
                  .update({ ...write.patch })
                  .where({ ...write.before.query });
              }
              await verify([...data.writes.map((write) => write.after), ...data.observed], tx);
              const afterDigest = targetMigrationDigest(data.writes.map((write) => write.after));
              await tx
                .model(JOURNAL_TABLE)
                .update({ phase: 'applied', last_operation: 'apply', after_digest: afterDigest })
                .where({ plan_id: plan.id, phase: 'pausing' });
              return {
                operation: 'apply',
                planId: plan.id,
                candidateId: plan.candidateId,
                beforeDigest: plan.beforeDigest,
                afterDigest,
                recordCount: plan.recordCount,
                status: 'applied',
                maintenance: 'paused',
              };
            } catch (error) {
              callbackFailure = error;
              throw error;
            }
          });
        } catch (error) {
          // The database propagates a typed callback error only after rollback succeeds.
          // Commit/rollback transport failures remain unknown and never create this evidence.
          if (
            error === callbackFailure &&
            error instanceof DataMigrationError &&
            ['conflict', 'unsupported', 'invalid_input', 'not_found'].includes(error.code)
          ) {
            await database.transaction(async (tx) => {
              const row = await readJournal(plan.id, tx);
              if (!row || row.phase !== 'pausing' || row.plan_digest !== digest)
                throw new DataMigrationError('commit_unknown', 'Cannot confirm rejected migration maintenance');
              await tx
                .model(JOURNAL_TABLE)
                .update({ phase: 'rejected', rejected_digest: await readBaseline(data, tx) })
                .where({ plan_id: plan.id, phase: 'pausing' });
            });
          }
          throw error;
        }
      });
    },
    async resume({ plan, signal }) {
      return mutate(plan.id, async () => {
        const data = assertPlan(plan);
        signal?.throwIfAborted();
        await database.transaction(async (tx) => {
          const state = await inspect(plan, tx);
          if (!state.resumable && state.maintenance !== 'resumed')
            throw new DataMigrationError('conflict', 'Actual migration records cannot be safely resumed');
          if (state.maintenance === 'paused') {
            const row = await readJournal(plan.id, tx);
            if (row) await tx.model(JOURNAL_TABLE).update({ phase: 'resumed' }).where({ plan_id: plan.id });
            else
              await tx
                .model(JOURNAL_TABLE)
                .insert({
                  plan_id: plan.id,
                  candidate_id: plan.candidateId,
                  plan_digest: targetMigrationDigest(plan),
                  before_digest: plan.beforeDigest,
                  after_digest: '',
                  record_count: plan.recordCount,
                  scopes_json: JSON.stringify(data.scopes),
                  phase: 'resumed',
                  last_operation: '',
                  rejected_digest: '',
                });
          }
        });
        scopes.resume(plan.id, data.scopes);
      });
    },
    async restore({ plan, receipt, signal }) {
      return mutate(plan.id, async () => {
        const data = assertPlan(plan);
        signal?.throwIfAborted();
        await scopes.pause({
          planId: plan.id,
          scopes: data.scopes,
          persist: async () => {
            await database.transaction(async (tx) => {
              const row = await readJournal(plan.id, tx);
              if (
                !row ||
                row.plan_digest !== targetMigrationDigest(plan) ||
                row.after_digest !== receipt.afterDigest ||
                (row.phase !== 'applied' && row.phase !== 'resumed') ||
                row.last_operation !== 'apply'
              )
                throw new DataMigrationError('conflict', 'Only the unchanged confirmed migration can be restored');
              await tx.model(JOURNAL_TABLE).update({ phase: 'restoring' }).where({ plan_id: plan.id });
            });
          },
        });
        let callbackFailure: unknown;
        try {
          return await database.transaction(async (tx) => {
            try {
              signal?.throwIfAborted();
              await verify([...data.writes.map((write) => write.after), ...data.observed], tx);
              for (const write of data.writes) {
                // All rows in a keyless unit must share the same routing patch; other values remain individual.
                const keys = Object.keys(write.patch),
                  original = write.before.rows[0];
                if (!original) continue;
                const patch = Object.fromEntries(keys.map((key) => [key, original[key] ?? null]));
                if (
                  write.before.rows.some(
                    (row) =>
                      targetMigrationDigest(Object.fromEntries(keys.map((key) => [key, row[key] ?? null]))) !==
                      targetMigrationDigest(patch),
                  )
                ) {
                  throw new DataMigrationError(
                    'unsupported',
                    'Indistinguishable rows require different restoration patches',
                  );
                }
                await tx
                  .model(write.after.table)
                  .update(patch)
                  .where({ ...write.after.query });
              }
              await verify([...data.writes.map((write) => write.before), ...data.observed], tx);
              const afterDigest = targetMigrationDigest(data.writes.map((write) => write.before));
              await tx
                .model(JOURNAL_TABLE)
                .update({ phase: 'restored', last_operation: 'restore', after_digest: afterDigest })
                .where({ plan_id: plan.id, phase: 'restoring' });
              return {
                operation: 'restore',
                planId: plan.id,
                candidateId: plan.candidateId,
                beforeDigest: plan.beforeDigest,
                afterDigest,
                recordCount: plan.recordCount,
                status: 'applied',
                maintenance: 'paused',
              };
            } catch (error) {
              callbackFailure = error;
              throw error;
            }
          });
        } catch (error) {
          if (
            error === callbackFailure &&
            error instanceof DataMigrationError &&
            ['conflict', 'unsupported', 'invalid_input', 'not_found'].includes(error.code)
          ) {
            await database.transaction(async (tx) => {
              const row = await readJournal(plan.id, tx);
              if (!row || row.phase !== 'restoring' || row.plan_digest !== targetMigrationDigest(plan))
                throw new DataMigrationError('commit_unknown', 'Cannot confirm rejected restoration maintenance');
              await tx
                .model(JOURNAL_TABLE)
                .update({ phase: 'rejected', rejected_digest: await readBaseline(data, tx) })
                .where({ plan_id: plan.id, phase: 'restoring' });
            });
          }
          throw error;
        }
      });
    },
  };
  return provider;
}
