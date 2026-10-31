import { randomUUID } from 'node:crypto';
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { DataMigrationError, normalizeDeliveryTarget, pluginDataMigrationProviderToken, generationAdmissionSource,
  type DataMigrationInventory, type DataMigrationPlan, type DataMigrationReceipt, type DataMigrationInspection, type DeliveryTarget,
  type PluginDataMigrationProvider, type PluginId, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { DataMigrationPlanStore, type StoredDataMigrationPlan } from './plan-store.js';

/** Authentication is enforced by the Host route; owner is only a resource-selection key. */
export interface DataMigrationOwnerInput { readonly owner: PluginId; readonly signal?: AbortSignal }
/** The selected destination must name a current canonical account; aliases confer no authority. */
export interface PrepareHostDataMigrationInput extends DataMigrationOwnerInput {
  readonly candidateId: string;
  readonly expectedDigest: string;
  readonly target: DeliveryTarget;
}
/** Subsequent requests carry only this opaque ID, never a caller-supplied plan or authorization. */
export interface DataMigrationPlanInput { readonly planId: string; readonly signal?: AbortSignal }
export interface DataMigrationProviderSummary { readonly owner: PluginId; readonly title: string }
export interface DataMigrationPlanSummary {
  readonly planId: string;
  readonly owner: PluginId;
  readonly providerTitle: string;
  readonly phase: StoredDataMigrationPlan['phase'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly candidateId: string;
  readonly domain: string;
  readonly sourceVersion: string;
  readonly beforeDigest: string;
  readonly recordCount: number;
  readonly target: DeliveryTarget;
  readonly description: readonly string[];
  readonly authorizationCandidateCount: number;
  readonly receipt?: DataMigrationReceipt;
  readonly inspection?: DataMigrationInspection;
}
export interface DataMigrationControllerOptions {
  readonly snapshots: SnapshotReader;
  readonly store: DataMigrationPlanStore;
}

/** Domain admission and directory validation share the same captured Root generation. */
interface DataMigrationMutationContext {
  readonly stored: StoredDataMigrationPlan;
  readonly provider: PluginDataMigrationProvider;
  readonly signal: AbortSignal;
  readonly snapshot: RuntimeSnapshot;
}

/** Coordinates existing Plugin-owned atomic migration units from authenticated Host operations. */
export class DataMigrationController {
  readonly #snapshots: SnapshotReader;
  readonly #store: DataMigrationPlanStore;
  constructor(options: DataMigrationControllerOptions) { this.#snapshots = options.snapshots; this.#store = options.store; }

  async listProviders(input: { readonly signal?: AbortSignal } = {}): Promise<readonly DataMigrationProviderSummary[]> {
    return this.#withSnapshot(input.signal, async snapshot => localProviders(snapshot).map(({ owner, provider }) => ({ owner, title: provider.title })));
  }
  async preview(input: DataMigrationOwnerInput): Promise<DataMigrationInventory> {
    return this.#withSnapshot(input.signal, async (snapshot, signal) => withProvider({ snapshot, owner: input.owner }, provider => provider.preview({ signal })));
  }
  async prepare(input: PrepareHostDataMigrationInput): Promise<DataMigrationPlanSummary> {
    return this.#withSnapshot(input.signal, async (snapshot, signal) => withProvider({ snapshot, owner: input.owner }, async provider => {
      const target = normalizeDeliveryTarget(input.target);
      if (migrationAccountStatus(snapshot, target) !== 'available') {
        throw new DataMigrationError('invalid_input', 'Migration target must select a current canonical account and its Adapter');
      }
      const planId = randomUUID();
      const plan = await provider.prepare({ planId, candidateId: input.candidateId, expectedDigest: input.expectedDigest, target, signal });
      if (plan.id !== planId || plan.candidateId !== input.candidateId || plan.beforeDigest !== input.expectedDigest
        || JSON.stringify(normalizeDeliveryTarget(plan.target)) !== JSON.stringify(target)) {
        throw new DataMigrationError('conflict', 'Provider prepared a different migration scope');
      }
      const now = new Date().toISOString();
      const stored: StoredDataMigrationPlan = { version: 1, owner: input.owner, providerTitle: provider.title,
        createdAt: now, updatedAt: now, phase: 'prepared', plan };
      await this.#store.exclusive(planId, () => this.#store.write(stored));
      return summarizeDataMigrationPlan(stored);
    }));
  }
  async read(input: DataMigrationPlanInput): Promise<DataMigrationPlanSummary> {
    input.signal?.throwIfAborted();
    return summarizeDataMigrationPlan(await this.#requireStored(input.planId));
  }
  async apply(input: DataMigrationPlanInput): Promise<DataMigrationPlanSummary> {
    return this.#mutate(input, async ({ stored, provider, signal, snapshot }) => {
      if (stored.phase === 'applied' || (stored.phase === 'resumed' && stored.receipt?.operation === 'apply')) return stored;
      if (stored.phase !== 'prepared') throw unknownCommit();
      const account = migrationAccountStatus(snapshot, stored.plan.target);
      if (account === 'missing') throw new DataMigrationError('not_found', 'The selected migration account no longer exists');
      if (account === 'adapter_mismatch') throw new DataMigrationError('conflict', 'The selected migration account belongs to another Adapter');
      const pending = advance(stored, { phase: 'applying', intent: 'apply' });
      await this.#store.write(pending);
      try {
        const receipt = await provider.apply({ plan: stored.plan, signal });
        requireReceipt(stored.plan, receipt, 'apply');
        const applied = advance(pending, { phase: 'applied', receipt });
        await this.#store.write(applied); return applied;
      } catch (error) {
        await this.#store.write(advance(pending, { phase: noDataCommit(error) ? 'inspection_required' : 'commit_unknown' })).catch(() => undefined);
        if (noDataCommit(error)) throw error;
        throw unknownCommit(error);
      }
    });
  }
  async reconcile(input: DataMigrationPlanInput): Promise<DataMigrationPlanSummary> {
    return this.#mutate(input, async ({ stored, provider, signal }) => {
      const inspection = await provider.inspect({ plan: stored.plan, signal });
      const confirmed = reconcileInspection(stored, inspection);
      await this.#store.write(confirmed); return confirmed;
    });
  }
  async resume(input: DataMigrationPlanInput): Promise<DataMigrationPlanSummary> {
    return this.#mutate(input, async ({ stored, provider, signal }) => {
      const inspection = await provider.inspect({ plan: stored.plan, signal });
      const checked = reconcileInspection(stored, inspection);
      await this.#store.write(checked);
      if (inspection.data === 'unknown' || inspection.maintenance === 'unknown') throw unknownCommit();
      if (inspection.maintenance === 'resumed') return checked;
      if (!inspection.resumable) throw new DataMigrationError('conflict', 'Provider has not verified a safe maintenance recovery baseline');
      const pending = advance(checked, { phase: 'resuming' }); await this.#store.write(pending);
      try {
        await provider.resume({ plan: stored.plan, signal });
        const resumed = advance(pending, { phase: 'resumed', inspection: { ...inspection, maintenance: 'resumed', resumable: false } });
        await this.#store.write(resumed); return resumed;
      } catch (error) {
        await this.#store.write(advance(pending, { phase: 'resume_unknown', inspection: { ...inspection, maintenance: 'unknown', resumable: false } })).catch(() => undefined);
        if (noDataCommit(error)) throw error;
        throw unknownCommit(error);
      }
    });
  }
  async restore(input: DataMigrationPlanInput): Promise<DataMigrationPlanSummary> {
    return this.#mutate(input, async ({ stored, provider, signal }) => {
      if (stored.phase === 'restored') return stored;
      if (!['applied', 'resumed'].includes(stored.phase) || !stored.receipt) {
        throw new DataMigrationError('conflict', 'Restoration requires a confirmed application receipt');
      }
      const pending = advance(stored, { phase: 'restoring', intent: 'restore' }); await this.#store.write(pending);
      try {
        const receipt = await provider.restore({ plan: stored.plan, receipt: stored.receipt, signal });
        requireReceipt(stored.plan, receipt, 'restore');
        const restored = advance(pending, { phase: 'restored', receipt }); await this.#store.write(restored); return restored;
      } catch (error) {
        await this.#store.write(advance(pending, { phase: noDataCommit(error) ? 'inspection_required' : 'commit_unknown' })).catch(() => undefined);
        if (noDataCommit(error)) throw error;
        throw unknownCommit(error);
      }
    });
  }
  async #mutate(input: DataMigrationPlanInput,
    operation: (context: DataMigrationMutationContext) => Promise<StoredDataMigrationPlan>,
  ): Promise<DataMigrationPlanSummary> {
    return this.#store.exclusive(input.planId, () => this.#withSnapshot(input.signal, async (snapshot, signal) => {
      const stored = await this.#requireStored(input.planId);
      signal.throwIfAborted();
      return withProvider({ snapshot, owner: stored.owner }, async provider => summarizeDataMigrationPlan(await operation({ stored, provider, signal, snapshot })));
    }));
  }
  async #requireStored(planId: string): Promise<StoredDataMigrationPlan> {
    const stored = await this.#store.read(planId);
    if (!stored) throw new DataMigrationError('not_found', 'Migration plan was not found');
    return stored;
  }
  async #withSnapshot<T>(signal: AbortSignal | undefined, operation: (snapshot: RuntimeSnapshot, signal: AbortSignal) => Promise<T>): Promise<T> {
    const lease = this.#snapshots.acquire();
    try {
      const boundSignal = signal ? AbortSignal.any([signal, lease.stopSignal]) : lease.stopSignal;
      boundSignal.throwIfAborted(); return await operation(lease.value, boundSignal);
    } finally { lease.release(); }
  }
}

/** No before-images or raw authorization candidates cross the HTTP presentation boundary. */
export function summarizeDataMigrationPlan(stored: StoredDataMigrationPlan): DataMigrationPlanSummary {
  const { plan } = stored;
  return { planId: plan.id, owner: stored.owner, providerTitle: stored.providerTitle, phase: stored.phase,
    createdAt: stored.createdAt, updatedAt: stored.updatedAt, candidateId: plan.candidateId, domain: plan.domain,
    sourceVersion: plan.sourceVersion, beforeDigest: plan.beforeDigest, recordCount: plan.recordCount,
    target: plan.target, description: plan.description, authorizationCandidateCount: plan.authorizationCandidates.length,
    ...(stored.receipt ? { receipt: stored.receipt } : {}), ...(stored.inspection ? { inspection: stored.inspection } : {}) };
}
function localProviders(snapshot: RuntimeSnapshot): Array<{ owner: PluginId; provider: PluginDataMigrationProvider }> {
  const result: Array<{ owner: PluginId; provider: PluginDataMigrationProvider }> = [];
  for (const [owner, resources] of snapshot.resources) {
    const provider = resources.get(pluginDataMigrationProviderToken.id) as PluginDataMigrationProvider | undefined;
    if (!provider) continue;
    const parent = snapshot.tree.get(owner)?.parent;
    if (parent && snapshot.resources.get(parent)?.get(pluginDataMigrationProviderToken.id) === provider) continue;
    result.push({ owner, provider });
  }
  return result;
}
function requireProvider(snapshot: RuntimeSnapshot, owner: PluginId): PluginDataMigrationProvider {
  const provider = localProviders(snapshot).find(entry => entry.owner === owner)?.provider;
  if (!provider) throw new DataMigrationError('not_found', 'Plugin has no local migration provider');
  return provider;
}
function requireReceipt(plan: DataMigrationPlan, receipt: DataMigrationReceipt, operation: DataMigrationReceipt['operation']): void {
  if (receipt.planId !== plan.id || receipt.candidateId !== plan.candidateId || receipt.beforeDigest !== plan.beforeDigest
    || receipt.operation !== operation || receipt.recordCount !== plan.recordCount || receipt.maintenance !== 'paused') {
    throw new DataMigrationError('commit_unknown', 'Provider receipt does not confirm this exact migration');
  }
}
function advance(stored: StoredDataMigrationPlan, patch: Partial<Pick<StoredDataMigrationPlan, 'phase' | 'intent' | 'receipt' | 'inspection'>>): StoredDataMigrationPlan {
  return { ...stored, ...patch, updatedAt: new Date().toISOString() };
}
function unknownCommit(cause?: unknown): DataMigrationError {
  const error = new DataMigrationError('commit_unknown', 'Migration outcome is unknown; reconcile its receipt before another mutation');
  if (cause !== undefined) error.cause = cause;
  return error;
}

/** A receipt proves a data commit, while only authoritative inspection proves current maintenance. */
function reconcileInspection(stored: StoredDataMigrationPlan, inspection: DataMigrationInspection): StoredDataMigrationPlan {
  if (inspection.data === 'unknown' || inspection.maintenance === 'unknown') return advance(stored, { inspection });
  if (inspection.data === 'conflict') {
    return advance(stored, { inspection, ...(inspection.maintenance === 'resumed' ? { phase: 'resumed' } : {}) });
  }
  if (inspection.data === 'applied' || inspection.data === 'restored') {
    if (!inspection.receipt) throw unknownCommit();
    requireReceipt(stored.plan, inspection.receipt, inspection.data === 'applied' ? 'apply' : 'restore');
  }
  return advance(stored, { inspection, receipt: inspection.receipt,
    phase: inspection.maintenance === 'resumed' ? 'resumed'
      : inspection.data === 'not_applied' ? 'prepared' : inspection.data,
  });
}
function noDataCommit(error: unknown): boolean {
  return error instanceof DataMigrationError && ['invalid_input', 'conflict', 'unsupported', 'not_found'].includes(error.code);
}

interface LocalDataMigrationProviderAddress { readonly snapshot: RuntimeSnapshot; readonly owner: PluginId }
/** The Root lease pins resources; each resource's own admission gates authorize this invocation. */
async function withProvider<T>(address: LocalDataMigrationProviderAddress, operation: (provider: PluginDataMigrationProvider) => Promise<T>): Promise<T> {
  const provider = requireProvider(address.snapshot, address.owner);
  const releases: Array<() => void> = [];
  try {
    for (const gate of provider[generationAdmissionSource]) {
      const release = gate.acquire();
      if (!release) throw new DataMigrationError('unavailable', 'Migration provider generation is no longer admitted');
      releases.push(release);
    }
    return await operation(provider);
  } finally { for (const release of releases.reverse()) release(); }
}

/** Desired-account facts only: no alias recovery, platform connection or cross-store locking. */
function migrationAccountStatus(snapshot: RuntimeSnapshot, target: DeliveryTarget): 'available' | 'missing' | 'adapter_mismatch' {
  const index = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(index)) throw new DataMigrationError('unavailable', 'Account directory is unavailable');
  const account = index.list().find(row => String(row.id) === target.endpoint.id);
  if (!account) return 'missing';
  return index.clientAdapter(account.id) === target.endpoint.adapter ? 'available' : 'adapter_mismatch';
}
