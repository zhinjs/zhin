import type { ProviderDefinition } from './driver.js';
import { ProviderError, type ExecutionBinding, type ProviderGraph } from './types.js';
import { providerPlanFingerprint } from './plan.js';

declare const resourceValue: unique symbol;
export interface ProviderResourceKey<T> { readonly id: symbol; readonly [resourceValue]?: (value: T) => T }
/** A module may hold this immutable key, never the mutable cache value. */
export function createProviderResourceKey<T>(name: string): ProviderResourceKey<T> {
  return Object.freeze({ id: Symbol(name) });
}
export interface ProviderBindingResources {
  /** Only non-secret, non-capability state. The factory is local and synchronous;
   * request fetch, credentials, Session and active SDK handles must not be cached. */
  getOrCreate<T>(input: Readonly<{
    key: ProviderResourceKey<T>;
    create: () => Readonly<{ value: T; dispose?: () => void }>;
  }>): T;
}
interface StateEntry {
  readonly identity: string;
  readonly binding: ExecutionBinding;
  readonly driver: ProviderDefinition<unknown, unknown>;
  readonly states: Map<symbol, Readonly<{ value: unknown; dispose?: () => void }>>;
  refs: number;
  retired: boolean;
}
function identity(binding: ExecutionBinding): string {
  return providerPlanFingerprint({ rootId: binding.profile.rootId,
    serviceId: binding.service.id, driver: binding.service.driver, serviceOptions: binding.service.options,
    accountId: binding.account.id, incarnation: binding.account.incarnation,
    model: binding.model, parameters: binding.profile.parameters });
}
function retainedByGraph(entry: StateEntry, graph: ProviderGraph): boolean {
  if (entry.binding.profile.rootId !== graph.rootId) return false;
  return Object.values(graph.profiles).some(profile => {
    const account = graph.accounts[profile.accountId], service = account && graph.services[account.serviceId];
    const model = service?.models[profile.model];
    return !!account && !!service && !!model && identity({ graphRevision: graph.revision, profile, account, service, model }) === entry.identity;
  });
}
/** Per-runtime cache owner. It stores only driver data, and cannot self-retain a generation. */
export class ProviderBindingResourceOwner {
  readonly #entries = new Set<StateEntry>();
  readonly #graphs = new Map<string, ProviderGraph>();
  readonly #retiredDrivers = new WeakSet<ProviderDefinition<unknown, unknown>>();
  #retired = false;
  constructor(private readonly onCleanupError: (error: unknown) => void) {}
  acquire(input: Readonly<{ binding: ExecutionBinding; driver: ProviderDefinition<unknown, unknown> }>): Readonly<{
    key: object;
    resources: ProviderBindingResources;
    release(): void;
  }> {
    const key = identity(input.binding);
    let entry: StateEntry | undefined;
    for (const candidate of this.#entries) {
      if (candidate.identity === key && candidate.driver === input.driver && (!candidate.retired || candidate.refs > 0)) entry = candidate;
    }
    if (!entry) {
      entry = { identity: key, binding: input.binding, driver: input.driver, refs: 0, retired: this.#retired || this.#retiredDrivers.has(input.driver), states: new Map() };
      const graph = this.#graphs.get(input.binding.profile.rootId);
      if (graph && !retainedByGraph(entry, graph)) entry.retired = true;
      this.#entries.add(entry);
    }
    const owned = entry;
    owned.refs++;
    let released = false;
    return Object.freeze({ key: owned, resources: Object.freeze({ getOrCreate: <T>(options: Readonly<{
      key: ProviderResourceKey<T>; create: () => Readonly<{ value: T; dispose?: () => void }>;
    }>): T => {
      if (released) throw new ProviderError('operation-closed');
      const existing = owned.states.get(options.key.id);
      if (existing) return existing.value as T;
      const state = options.create();
      owned.states.set(options.key.id, state);
      return state.value;
    } }), release: () => {
      if (released) return;
      released = true;
      owned.refs--;
      this.#clean(owned);
    } });
  }
  reconcile(graph: ProviderGraph): void {
    const current = this.#graphs.get(graph.rootId);
    // A delayed older operation remains valid, but cannot roll the shared idle-state
    // baseline back and retire resources admitted by a newer committed graph.
    if (current && graph.revision < current.revision) return;
    this.#graphs.set(graph.rootId, graph);
    for (const entry of this.#entries) if (entry.binding.profile.rootId === graph.rootId && !retainedByGraph(entry, graph)) { entry.retired = true; this.#clean(entry); }
  }
  /** HMR retirement releases idle state, while active operations may finish. */
  retire(): void {
    this.#retired = true;
    for (const entry of this.#entries) { entry.retired = true; this.#clean(entry); }
  }
  retireDriver(driver: ProviderDefinition<unknown, unknown>): void {
    this.#retiredDrivers.add(driver);
    for (const entry of this.#entries) if (entry.driver === driver) { entry.retired = true; this.#clean(entry); }
  }
  #clean(entry: StateEntry): void {
    if (!entry.retired || entry.refs !== 0) return;
    this.#entries.delete(entry);
    for (const state of entry.states.values()) {
      try { state.dispose?.(); } catch (error) { this.onCleanupError(error); }
    }
    entry.states.clear();
  }
}
