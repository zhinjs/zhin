import { adapterFeatureId, isAdapterIndex, isOwnedAdapterDirectory, AdapterManagementError } from 'zhin.js/adapter';
import type { FeatureId, PluginId } from 'zhin.js';
import { JuejinAdapter } from './adapter.js';
import type { JuejinEndpoint } from './endpoint.js';

/** Closed review/login view; no cookie, config, fetch or mutable account directory. */
export type JuejinEndpointView = Pick<JuejinEndpoint,
  'localId' | 'login' | 'persistent' | 'articles' | 'sendMode' | 'circuitBreaker'
  | 'approveDraft' | 'editDraft' | 'discardDraft' | 'recheckLogin'> & {
    readonly drafts: Pick<JuejinEndpoint['drafts'], 'get' | 'list' | 'size'>;
  };
export type JuejinEndpointDirectory = ReadonlyMap<string, JuejinEndpointView>;
export interface JuejinDirectoryContext {
  readonly owner: PluginId | Readonly<{ id: PluginId }>;
  readonly signal: AbortSignal;
  project(feature: FeatureId): unknown;
}

/** Resolve from the authenticated owner's Adapter; the returned Map is only a request-local projection. */
export function juejinEndpoints(context: JuejinDirectoryContext): JuejinEndpointDirectory {
  context.signal.throwIfAborted();
  const owner = typeof context.owner === 'string' ? context.owner : context.owner.id;
  const projection = context.project(adapterFeatureId);
  if (!isAdapterIndex(projection) && !isOwnedAdapterDirectory(projection)) throw new AdapterManagementError('unavailable', 'Juejin Adapter directory is unavailable');
  if (isOwnedAdapterDirectory(projection) && projection.owner !== owner) throw new AdapterManagementError('unavailable', 'Juejin directory owner mismatch');
  const adapters = projection.adapters().filter((adapter): adapter is JuejinAdapter =>
    adapter.descriptor.owner === owner && adapter instanceof JuejinAdapter);
  if (adapters.length !== 1) throw new AdapterManagementError('unavailable', 'Juejin Adapter cannot be uniquely selected');
  const adapter = adapters[0]!;
  const rows = new Map<string, JuejinEndpointView>();
  for (const child of adapter.runtimeEntries()) {
    const endpoint = child.endpoint;
    if (!endpoint || !child.started || child.stopped) continue;
    const canonicalId = child.desired.canonicalId;
    const read = (): JuejinEndpoint => {
      context.signal.throwIfAborted();
      if (adapter.getEndpoint(child.desired.instanceId) !== endpoint) throw new AdapterManagementError('closed', 'Juejin Endpoint has retired');
      return endpoint;
    };
    const runSync = <T>(operation: (endpoint: JuejinEndpoint) => T): T => {
      const lease = adapter.acquire(canonicalId, context.signal, endpoint);
      try { lease.assertActive(); return operation(lease.endpoint); } finally { lease.release(); }
    };
    const runAsync = async <T>(operation: (endpoint: JuejinEndpoint) => Promise<T>): Promise<T> => {
      const lease = adapter.acquire(canonicalId, context.signal, endpoint);
      try { return await lease.run(operation); } finally { lease.release(); }
    };
    const view = Object.freeze<JuejinEndpointView>({
      get localId() { return read().localId; }, get login() { return read().login; },
      get persistent() { return read().persistent; }, get articles() { return read().articles; },
      get sendMode() { return read().sendMode; },
      get circuitBreaker() { return read().circuitBreaker; },
      drafts: Object.freeze<JuejinEndpointView['drafts']>({
        get: id => read().drafts.get(id), list: () => read().drafts.list(), get size() { return read().drafts.size; },
      }),
      approveDraft: id => runAsync(endpoint => endpoint.approveDraft(id)),
      editDraft: (id, message) => runSync(endpoint => endpoint.editDraft(id, message)),
      discardDraft: id => runSync(endpoint => endpoint.discardDraft(id)),
      recheckLogin: () => runAsync(endpoint => endpoint.recheckLogin()),
    });
    rows.set(child.desired.endpointId, view);
  }
  return rows;
}
