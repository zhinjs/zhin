import type { HttpHost } from '@zhin.js/host-http';
import { readLeasedRootResource, databaseRootHostToken, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { registerRuntimeModelPolicyRoutes } from './routes.js';
import { createRuntimePolicyTargetsReader } from './targets.js';
import { runtimePolicyManagementToken } from './token.js';
export function registerRuntimeModelPolicyHttp(options: Readonly<{ http: HttpHost; base: string; snapshots: SnapshotReader }>): void {
  registerRuntimeModelPolicyRoutes({ ...options, acquireService: () => {
    const lease = options.snapshots.acquire();
    try {
      const service = readLeasedRootResource(options.snapshots, lease, runtimePolicyManagementToken);
      if (!service) { lease.release(); return undefined; }
      return { service, readTargets: createRuntimePolicyTargetsReader({ rootId: service.rootId, lease,
        database: readLeasedRootResource(options.snapshots, lease, databaseRootHostToken) }), release: () => lease.release() };
    } catch (error) { lease.release(); throw error; }
  } });
}
