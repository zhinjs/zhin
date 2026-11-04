import { registerRuntimeModelPolicyHttp } from '../runtime-model-policy/register-http.js';
import type { HttpHost } from '@zhin.js/host-http';
import { readLeasedRootResource, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { registerPersonalModelRoutes } from './routes.js';
import { personalModelManagementToken } from './token.js';

/** Loaded only with the optional Agent Host, never by the default IM-only Console. */
export function registerPersonalModelHttp(options: Readonly<{ http: HttpHost; base: string; snapshots: SnapshotReader }>): void {
  registerRuntimeModelPolicyHttp(options);
  registerPersonalModelRoutes({ http: options.http, base: options.base, acquireService: () => {
    const lease = options.snapshots.acquire();
    try {
      const service = readLeasedRootResource(options.snapshots, lease, personalModelManagementToken);
      if (!service) { lease.release(); return undefined; }
      return { service, release: () => lease.release() };
    } catch (error) {
      lease.release();
      throw error;
    }
  } });
}
