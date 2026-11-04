import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { decodeTaskTarget, encodeTaskTarget, encodeStorageIdentity, type DatabaseHost, type SnapshotLease } from '@zhin.js/plugin-runtime';
import type { StructuredDatabase } from '@zhin.js/database';
import type { ModelPolicyEndpointAddress, ModelPolicySceneAddress } from '@zhin.js/agent/model-policy';

export interface RuntimePolicyTargetPage { readonly limit: number; readonly offset: number }
export interface RuntimePolicyTargets {
  readonly adaptersAvailable: boolean;
  readonly adapters: readonly Readonly<{ capabilityId: string; platform: string }>[];
  readonly endpoints: readonly Readonly<{ capabilityId: string; instanceId: string; address: ModelPolicyEndpointAddress }>[];
  readonly scenesAvailable: boolean;
  readonly scenesError?: 'not_requested' | 'unavailable' | 'integrity';
  readonly scenes: readonly Readonly<{ address: ModelPolicySceneAddress }>[];
  readonly sceneHasMore: boolean;
}
export type RuntimePolicyTargetsReader = (page?: RuntimePolicyTargetPage) => Promise<RuntimePolicyTargets>;
const COLUMNS = ['endpoint_adapter', 'endpoint_id', 'conversation_kind', 'conversation_id', 'parent_kind', 'parent_id', 'thread_id'] as const;

/** Reads only the leased generation's Adapter metadata and existing indexed conversation address columns. */
export function createRuntimePolicyTargetsReader(options: Readonly<{ rootId: string; lease: SnapshotLease; database?: DatabaseHost }>): RuntimePolicyTargetsReader {
  return async page => {
    const index = options.lease.value.projections.get(adapterFeatureId);
    const adapters: Array<{ capabilityId: string; platform: string }> = [];
    const endpoints: Array<{ capabilityId: string; instanceId: string; address: ModelPolicyEndpointAddress }> = [];
    if (isAdapterIndex(index)) for (const adapter of index.adapters()) {
      const descriptor = adapter.descriptor;
      adapters.push({ capabilityId: descriptor.id, platform: descriptor.name });
      for (const endpoint of adapter.list()) endpoints.push({ capabilityId: descriptor.id, instanceId: endpoint.instanceId,
        address: { rootId: options.rootId, platform: descriptor.name, endpoint: endpoint.endpointId, adapterId: endpoint.canonicalId } });
    }
    const common = { adaptersAvailable: isAdapterIndex(index), adapters: Object.freeze(adapters), endpoints: Object.freeze(endpoints) };
    const unavailable = (scenesError: 'not_requested' | 'unavailable' | 'integrity'): RuntimePolicyTargets => Object.freeze({ ...common,
      scenesAvailable: false, scenesError, scenes: Object.freeze([]), sceneHasMore: false });
    if (!page) return unavailable('not_requested');
    const database = options.database;
    if (!database?.started || !['sqlite', 'mysql', 'pg'].includes(database.dialect)) return unavailable('unavailable');
    const raw = database.getRawDatabase() as Pick<StructuredDatabase, 'models'> | undefined;
    const model = raw?.models.get('conversation_events');
    if (!model) return unavailable('unavailable');
    if (!common.adaptersAvailable) return unavailable('unavailable');
    if (!endpoints.length) return Object.freeze({ ...common, scenesAvailable: true, scenes: Object.freeze([]), sceneHasMore: false });
    let rows: Record<string, unknown>[];
    try {
      // Full address GROUP BY is distinct in SQL. No event_json/message payload is selected.
      const query = model.select(...COLUMNS).where({ endpoint_id: { $in: endpoints.map(endpoint => encodeStorageIdentity(endpoint.address.adapterId)) } });
      query.groupBy(...COLUMNS);
      for (const column of COLUMNS) query.orderBy(column, 'ASC');
      rows = await query.limit(page.limit + 1).offset(page.offset);
    } catch { return unavailable('unavailable'); }
    try {
      const scenes = rows.slice(0, page.limit).map(row => {
        const conversation = decodeTaskTarget(row);
        const canonical = encodeTaskTarget(conversation);
        if (COLUMNS.some(column => canonical[column] !== row[column])) throw new Error('Invalid stored address');
        const endpoint = endpoints.find(endpoint => endpoint.address.adapterId === conversation.endpoint.id);
        if (!endpoint) throw new Error('Unknown endpoint identity');
        const address: ModelPolicySceneAddress = { rootId: options.rootId, platform: endpoint.address.platform,
          endpoint: endpoint.address.endpoint, conversation };
        return Object.freeze({ address });
      });
      return Object.freeze({ ...common, scenesAvailable: true, scenes: Object.freeze(scenes), sceneHasMore: rows.length > page.limit });
    } catch { return unavailable('integrity'); }
  };
}
