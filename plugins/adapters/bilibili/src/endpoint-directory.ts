import { adapterFeatureId, isAdapterIndex, isOwnedAdapterDirectory, AdapterManagementError } from 'zhin.js/adapter';
import type { FeatureId, PluginId } from 'zhin.js';
import { BilibiliAdapter } from './adapter.js';
import type { BilibiliEndpoint } from './endpoint.js';

/** Closed review/login view; no cookie, config, fetch or mutable account directory. */
export type BilibiliEndpointView = Pick<BilibiliEndpoint,
  'localId' | 'login' | 'qrLogin' | 'persistent' | 'videos' | 'sendMode' | 'circuitBreaker'
  | 'approveDraft' | 'editDraft' | 'discardDraft' | 'startQrLogin' | 'cancelQrLogin' | 'logout'> & {
    readonly drafts: Pick<BilibiliEndpoint['drafts'], 'get' | 'list' | 'size'>;
  };
export type BilibiliEndpointDirectory = ReadonlyMap<string, BilibiliEndpointView>;
export interface BilibiliDirectoryContext {
  readonly owner: PluginId | Readonly<{ id: PluginId }>;
  readonly signal: AbortSignal;
  project(feature: FeatureId): unknown;
}

/** Resolve from the authenticated owner's Adapter; the returned Map is only a request-local projection. */
export function bilibiliEndpoints(context: BilibiliDirectoryContext): BilibiliEndpointDirectory {
  context.signal.throwIfAborted();
  const owner = typeof context.owner === 'string' ? context.owner : context.owner.id;
  const projection = context.project(adapterFeatureId);
  if (!isAdapterIndex(projection) && !isOwnedAdapterDirectory(projection)) throw new AdapterManagementError('unavailable', 'Bilibili Adapter directory is unavailable');
  if (isOwnedAdapterDirectory(projection) && projection.owner !== owner) throw new AdapterManagementError('unavailable', 'Bilibili directory owner mismatch');
  const adapters = projection.adapters().filter((adapter): adapter is BilibiliAdapter =>
    adapter.descriptor.owner === owner && adapter instanceof BilibiliAdapter);
  if (adapters.length !== 1) throw new AdapterManagementError('unavailable', 'Bilibili Adapter cannot be uniquely selected');
  const adapter = adapters[0]!;
  const rows = new Map<string, BilibiliEndpointView>();
  for (const child of adapter.runtimeEntries()) {
    const endpoint = child.endpoint;
    if (!endpoint || !child.started || child.stopped) continue;
    const canonicalId = child.desired.canonicalId;
    const read = (): BilibiliEndpoint => {
      context.signal.throwIfAborted();
      if (adapter.getEndpoint(child.desired.instanceId) !== endpoint) throw new AdapterManagementError('closed', 'Bilibili Endpoint has retired');
      return endpoint;
    };
    const runSync = <T>(operation: (endpoint: BilibiliEndpoint) => T): T => {
      const lease = adapter.acquire(canonicalId, context.signal, endpoint);
      try { lease.assertActive(); return operation(lease.endpoint); } finally { lease.release(); }
    };
    const runAsync = async <T>(operation: (endpoint: BilibiliEndpoint) => Promise<T>): Promise<T> => {
      const lease = adapter.acquire(canonicalId, context.signal, endpoint);
      try { return await lease.run(operation); } finally { lease.release(); }
    };
    const view = Object.freeze<BilibiliEndpointView>({
      get localId() { return read().localId; }, get login() { return read().login; },
      get qrLogin() { return read().qrLogin; }, get persistent() { return read().persistent; },
      get videos() { return read().videos; }, get sendMode() { return read().sendMode; },
      get circuitBreaker() { return read().circuitBreaker; },
      drafts: Object.freeze<BilibiliEndpointView['drafts']>({
        get: id => read().drafts.get(id), list: () => read().drafts.list(), get size() { return read().drafts.size; },
      }),
      approveDraft: id => runAsync(endpoint => endpoint.approveDraft(id)),
      editDraft: (id, message) => runSync(endpoint => endpoint.editDraft(id, message)),
      discardDraft: id => runSync(endpoint => endpoint.discardDraft(id)),
      startQrLogin: () => runAsync(endpoint => endpoint.startQrLogin()),
      cancelQrLogin: () => runSync(endpoint => endpoint.cancelQrLogin()),
      logout: () => runAsync(endpoint => endpoint.logout()),
    });
    rows.set(child.desired.endpointId, view);
  }
  return rows;
}
