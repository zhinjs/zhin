import {
  generationAdmissionSource,
  DataMigrationError,
  TargetMigrationScopes,
  normalizeDeliveryTarget,
  targetMigrationDigest,
  type DataMigrationInspection,
  type DataMigrationPlan,
  type DataMigrationReceipt,
  type JsonValue,
  type PluginDatabaseHost,
  type PluginDataMigrationProvider,
  type PluginStateStore,
} from 'zhin.js/plugin-runtime';
import { SUBSCRIPTIONS_STATE_KEY, subscriptionKey, type EarthquakeSubscription } from './subscriptions.js';
import {
  subscriptionDocument,
  type SubscriptionDocument,
  type SubscriptionMigrationJournal,
} from './migration-document.js';

type PlanData = Readonly<{
  format: 'earthquake-target-v2';
  before: readonly JsonValue[];
  after: readonly JsonValue[];
  scopes: readonly string[];
}>;
function plain(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : undefined;
}
function legacySelector(row: Record<string, JsonValue>) {
  return {
    adapter: row.adapter ?? null,
    endpointKey: row.endpointKey ?? null,
    conversationKind: row.conversationKind ?? null,
    conversationId: row.conversationId ?? null,
    target: row.target ?? null,
  };
}
function units(document: SubscriptionDocument) {
  const groups = new Map<string, { indices: number[]; rows: JsonValue[]; selector: Record<string, JsonValue> }>();
  for (const [index, value] of document.subscriptions.entries()) {
    const row = plain(value);
    if (!row) continue;
    const selector = legacySelector(row),
      id = targetMigrationDigest(selector);
    const group: { indices: number[]; rows: JsonValue[]; selector: Record<string, JsonValue> } = groups.get(id) ?? {
      indices: [],
      rows: [],
      selector,
    };
    group.indices.push(index);
    group.rows.push(value);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    let status: 'canonical' | 'unresolved' | 'corrupt' = Object.entries(group.selector).some(
      ([key, value]) => key !== 'target' && (typeof value !== 'string' || !value),
    )
      ? 'corrupt'
      : 'unresolved';
    if (status !== 'corrupt' && group.selector.target !== null) {
      try {
        normalizeDeliveryTarget(group.selector.target);
        status = 'canonical';
      } catch {
        status = 'corrupt';
      }
    }
    const first = group.rows[0] as unknown as EarthquakeSubscription;
    return { ...group, id, status, scope: subscriptionKey(first), beforeDigest: targetMigrationDigest(group.rows) };
  });
}
function receipt(plan: DataMigrationPlan, journal: SubscriptionMigrationJournal): DataMigrationReceipt | undefined {
  if (!journal.operation) return undefined;
  return {
    operation: journal.operation,
    planId: plan.id,
    candidateId: plan.candidateId,
    beforeDigest: plan.beforeDigest,
    afterDigest: journal.afterDigest,
    recordCount: journal.recordCount,
    status: 'applied',
    maintenance: 'paused',
  };
}

/** The selected subscription and its receipt commit in the same existing StateStore CAS. */
export function createEarthquakeTargetMigration(
  input: Readonly<{ database: PluginDatabaseHost; state: PluginStateStore; scopes: TargetMigrationScopes }>,
): PluginDataMigrationProvider {
  const { database, state, scopes } = input,
    inFlight = new Set<string>();
  let revision = 0;
  const read = async () => subscriptionDocument(await state.get(SUBSCRIPTIONS_STATE_KEY));
  const dataOf = (plan: DataMigrationPlan): PlanData => {
    if (plan.domain !== 'earthquake' || plan.sourceVersion !== 'subscription-alias-v0')
      throw new DataMigrationError('invalid_input', 'Plan belongs to another domain');
    const data = plan.data as unknown as PlanData;
    if (!data || data.format !== 'earthquake-target-v2')
      throw new DataMigrationError('invalid_input', 'Unsupported earthquake migration plan');
    return data;
  };
  const update = async (change: (document: SubscriptionDocument) => SubscriptionDocument) => {
    await state.update(
      SUBSCRIPTIONS_STATE_KEY,
      (current) => change(subscriptionDocument(current)) as unknown as JsonValue,
    );
  };
  scopes.bindInitialization(async () => {
    for (const [planId, entry] of Object.entries((await read()).migrations))
      if (entry.phase !== 'resumed') scopes.restorePause(planId, entry.scopes);
  });
  const snapshots = (plan: DataMigrationPlan, document: SubscriptionDocument) => {
    const data = dataOf(plan),
      all = units(document);
    const source = all.find((unit) => unit.id === plan.candidateId);
    const destinationId = targetMigrationDigest(legacySelector(plain(data.after[0]!)!));
    const destination = all.find((unit) => unit.id === destinationId);
    return { source, destination, before: source?.rows ?? [], after: destination?.rows ?? [] };
  };
  const baseline = (plan: DataMigrationPlan, document: SubscriptionDocument) => {
    const snapshot = snapshots(plan, document);
    return targetMigrationDigest({ source: snapshot.before, destination: snapshot.after });
  };
  const rewrite = (rows: readonly JsonValue[], target: DataMigrationPlan['target']): readonly JsonValue[] =>
    rows.map(
      (row) =>
        ({
          ...plain(row)!,
          target,
          adapter: target.endpoint.adapter,
          endpointKey: target.endpoint.id,
          conversationKind: target.kind,
          conversationId: target.id,
        } as unknown as JsonValue),
    );
  const inspect = (plan: DataMigrationPlan, document: SubscriptionDocument): DataMigrationInspection => {
    const data = dataOf(plan),
      entry = document.migrations[plan.id],
      snapshot = snapshots(plan, document);
    const local = scopes.maintenance(plan.id, data.scopes);
    const maintenance =
      local === 'unknown'
        ? 'unknown'
        : local === 'paused' || (entry && entry.phase !== 'resumed')
        ? 'paused'
        : 'resumed';
    if (entry && entry.planDigest !== targetMigrationDigest(plan))
      return { data: 'conflict', maintenance: 'unknown', resumable: false };
    if (!scopes.drained(data.scopes)) return { data: 'unknown', maintenance, resumable: false };
    if (entry?.rejectedDigest)
      return {
        data: baseline(plan, document) === entry.rejectedDigest && !entry.operation ? 'not_applied' : 'conflict',
        maintenance,
        resumable: maintenance === 'paused' && baseline(plan, document) === entry.rejectedDigest,
      };
    const confirmed = entry ? receipt(plan, entry) : undefined;
    if (
      confirmed?.operation === 'apply' &&
      snapshot.before.length === 0 &&
      targetMigrationDigest(snapshot.after) === targetMigrationDigest(data.after)
    )
      return { data: 'applied', maintenance, receipt: confirmed, resumable: maintenance === 'paused' };
    if (
      confirmed?.operation === 'restore' &&
      snapshot.after.length === 0 &&
      targetMigrationDigest(snapshot.before) === targetMigrationDigest(data.before)
    )
      return { data: 'restored', maintenance, receipt: confirmed, resumable: maintenance === 'paused' };
    if (
      !confirmed &&
      snapshot.after.length === 0 &&
      targetMigrationDigest(snapshot.before) === targetMigrationDigest(data.before)
    )
      return { data: 'not_applied', maintenance, resumable: maintenance === 'paused' };
    return { data: 'conflict', maintenance, resumable: false };
  };
  const mutate = async <T>(plan: DataMigrationPlan, run: () => Promise<T>): Promise<T> => {
    if (inFlight.has(plan.id)) throw new DataMigrationError('conflict', 'Migration operation is already in progress');
    revision += 1;
    inFlight.add(plan.id);
    try {
      return await run();
    } finally {
      inFlight.delete(plan.id);
    }
  };
  const intent = (plan: DataMigrationPlan): SubscriptionMigrationJournal => ({
    planDigest: targetMigrationDigest(plan),
    candidateId: plan.candidateId,
    beforeDigest: plan.beforeDigest,
    afterDigest: '',
    recordCount: plan.recordCount,
    scopes: dataOf(plan).scopes,
    phase: 'pausing',
  });
  const rejected = async (plan: DataMigrationPlan, phase: SubscriptionMigrationJournal['phase']) => {
    await update((document) => {
      const entry = document.migrations[plan.id];
      if (!entry || entry.planDigest !== targetMigrationDigest(plan) || entry.phase !== phase)
        throw new DataMigrationError('commit_unknown', 'Cannot confirm rejected subscription migration');
      return {
        ...document,
        migrations: {
          ...document.migrations,
          [plan.id]: { ...entry, phase: 'rejected', rejectedDigest: baseline(plan, document) },
        },
      };
    });
  };
  return {
    title: 'Earthquake subscription destinations',
    get [generationAdmissionSource]() {
      return database[generationAdmissionSource];
    },
    async preview(request) {
      request?.signal?.throwIfAborted();
      const document = await read();
      const candidates = units(document).map((unit) => ({
        id: unit.id,
        domain: 'earthquake',
        title: `Earthquake: ${String(unit.selector.conversationId)}`,
        sourceVersion: 'subscription-alias-v0',
        recordCount: unit.rows.length,
        beforeDigest: unit.beforeDigest,
        status: unit.status,
        summary: unit.selector,
        executable: unit.status === 'unresolved',
      }));
      return { revision: targetMigrationDigest(candidates), candidates };
    },
    async prepare(request) {
      request.signal?.throwIfAborted();
      const document = await read(),
        unit = units(document).find((value) => value.id === request.candidateId);
      if (!unit) throw new DataMigrationError('not_found', 'Historical earthquake subscription no longer exists');
      if (unit.status !== 'unresolved')
        throw new DataMigrationError('unsupported', 'Only unresolved historical subscriptions need binding');
      if (unit.beforeDigest !== request.expectedDigest)
        throw new DataMigrationError('conflict', 'Subscriptions changed since preview');
      const target = normalizeDeliveryTarget(request.target),
        after = rewrite(unit.rows, target);
      const destinationScope = subscriptionKey(after[0] as unknown as EarthquakeSubscription);
      if (
        document.subscriptions.some(
          (row, index) =>
            !unit.indices.includes(index) &&
            subscriptionKey(row as unknown as EarthquakeSubscription) === destinationScope,
        )
      )
        throw new DataMigrationError('conflict', 'Selected destination already has an earthquake subscription');
      return {
        id: request.planId,
        candidateId: unit.id,
        domain: 'earthquake',
        sourceVersion: 'subscription-alias-v0',
        beforeDigest: unit.beforeDigest,
        target,
        recordCount: unit.rows.length,
        data: { format: 'earthquake-target-v2', before: unit.rows, after, scopes: [unit.scope, destinationScope] },
        description: [
          'Bind the selected subscriptions without changing filters, creation facts or any other subscription.',
          'The existing subscriptions document and migration journal share one CAS; remain paused until explicit resumption.',
        ],
        authorizationCandidates: [],
      };
    },
    async inspect({ plan, signal }) {
      signal?.throwIfAborted();
      const started = revision;
      if (inFlight.has(plan.id)) return { data: 'unknown', maintenance: 'unknown', resumable: false };
      const result = inspect(plan, await read());
      return revision === started && !inFlight.has(plan.id)
        ? result
        : { data: 'unknown', maintenance: 'unknown', resumable: false };
    },
    async apply({ plan, signal }) {
      return mutate(plan, async () => {
        const data = dataOf(plan);
        signal?.throwIfAborted();
        await scopes.pause({
          planId: plan.id,
          scopes: data.scopes,
          persist: async () =>
            update((document) => {
              const entry = document.migrations[plan.id];
              if (entry && entry.planDigest !== targetMigrationDigest(plan))
                throw new DataMigrationError('conflict', 'Plan ID refers to another migration');
              return entry
                ? document
                : { ...document, migrations: { ...document.migrations, [plan.id]: intent(plan) } };
            }),
        });
        let callbackFailure: unknown;
        try {
          await update((document) => {
            try {
              signal?.throwIfAborted();
              const entry = document.migrations[plan.id];
              if (!entry || entry.phase !== 'pausing' || entry.planDigest !== targetMigrationDigest(plan))
                throw new DataMigrationError('conflict', 'Migration is not waiting for application');
              const snapshot = snapshots(plan, document);
              if (
                snapshot.after.length ||
                targetMigrationDigest(snapshot.before) !== targetMigrationDigest(data.before)
              )
                throw new DataMigrationError('conflict', 'Subscriptions changed before the atomic migration');
              if (targetMigrationDigest(rewrite(snapshot.before, plan.target)) !== targetMigrationDigest(data.after))
                throw new DataMigrationError('invalid_input', 'Plan changes more than subscription routing');
              let position = 0;
              const subscriptions = document.subscriptions.map((row, index) =>
                snapshot.source!.indices.includes(index) ? data.after[position++]! : row,
              );
              return {
                ...document,
                subscriptions,
                migrations: {
                  ...document.migrations,
                  [plan.id]: {
                    ...entry,
                    phase: 'applied',
                    operation: 'apply',
                    afterDigest: targetMigrationDigest(data.after),
                  },
                },
              };
            } catch (error) {
              callbackFailure = error;
              throw error;
            }
          });
        } catch (error) {
          if (error === callbackFailure && error instanceof DataMigrationError) await rejected(plan, 'pausing');
          throw error;
        }
        const entry = (await read()).migrations[plan.id];
        if (!entry?.operation) throw new DataMigrationError('commit_unknown', 'Migration receipt cannot be confirmed');
        return receipt(plan, entry)!;
      });
    },
    async resume({ plan, signal }) {
      return mutate(plan, async () => {
        const data = dataOf(plan);
        signal?.throwIfAborted();
        await update((document) => {
          const inspection = inspect(plan, document);
          if (!inspection.resumable && inspection.maintenance !== 'resumed')
            throw new DataMigrationError('conflict', 'Actual subscriptions do not permit resumption');
          const entry = document.migrations[plan.id] ?? intent(plan);
          return { ...document, migrations: { ...document.migrations, [plan.id]: { ...entry, phase: 'resumed' } } };
        });
        scopes.resume(plan.id, data.scopes);
      });
    },
    async restore({ plan, receipt: original, signal }) {
      return mutate(plan, async () => {
        const data = dataOf(plan);
        signal?.throwIfAborted();
        await scopes.pause({
          planId: plan.id,
          scopes: data.scopes,
          persist: async () =>
            update((document) => {
              const entry = document.migrations[plan.id];
              if (
                !entry ||
                entry.operation !== 'apply' ||
                entry.afterDigest !== original.afterDigest ||
                entry.planDigest !== targetMigrationDigest(plan)
              )
                throw new DataMigrationError('conflict', 'Restoration needs the matching committed receipt');
              return {
                ...document,
                migrations: { ...document.migrations, [plan.id]: { ...entry, phase: 'restoring' } },
              };
            }),
        });
        let callbackFailure: unknown;
        try {
          await update((document) => {
            try {
              signal?.throwIfAborted();
              const entry = document.migrations[plan.id];
              const snapshot = snapshots(plan, document);
              if (
                !entry ||
                entry.phase !== 'restoring' ||
                snapshot.before.length ||
                targetMigrationDigest(snapshot.after) !== targetMigrationDigest(data.after)
              )
                throw new DataMigrationError(
                  'conflict',
                  'Subscriptions changed after migration; no records were overwritten',
                );
              let position = 0;
              const subscriptions = document.subscriptions.map((row, index) =>
                snapshot.destination!.indices.includes(index) ? data.before[position++]! : row,
              );
              return {
                ...document,
                subscriptions,
                migrations: {
                  ...document.migrations,
                  [plan.id]: {
                    ...entry,
                    phase: 'restored',
                    operation: 'restore',
                    afterDigest: targetMigrationDigest(data.before),
                  },
                },
              };
            } catch (error) {
              callbackFailure = error;
              throw error;
            }
          });
        } catch (error) {
          if (error === callbackFailure && error instanceof DataMigrationError) await rejected(plan, 'restoring');
          throw error;
        }
        const entry = (await read()).migrations[plan.id];
        if (!entry?.operation)
          throw new DataMigrationError('commit_unknown', 'Restoration receipt cannot be confirmed');
        return receipt(plan, entry)!;
      });
    },
  };
}
