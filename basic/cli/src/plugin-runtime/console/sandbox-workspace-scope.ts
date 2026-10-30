import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type { RuntimeSnapshot, SnapshotReader } from '@zhin.js/plugin-runtime';

export interface SandboxWorkspaceScope {
  readonly endpoint: Readonly<{ adapter: string; id: string }>;
  readonly endpointKey: string;
  readonly ownerId: string;
  readonly connectionId: string;
}

export class SandboxWorkspaceBindingError extends Error {
  readonly code = 'sandbox_binding_unavailable';
  constructor() { super('当前 Sandbox 连接归属不可用，请重新连接后再试'); }
}

/** Uses the live transport's server-owned identity, never an owner supplied by a browser. */
export async function withSandboxWorkspaceScope<T>(
  snapshots: SnapshotReader | undefined,
  connectionId: string,
  operation: (scope: SandboxWorkspaceScope, snapshot: RuntimeSnapshot) => Promise<T>,
): Promise<T> {
  if (!snapshots) throw new SandboxWorkspaceBindingError();
  let lease: ReturnType<SnapshotReader['acquire']>;
  try { lease = snapshots.acquire(); }
  catch { throw new SandboxWorkspaceBindingError(); }
  try {
    const index = lease.value.projections.get(adapterFeatureId);
    if (!isAdapterIndex(index)) throw new SandboxWorkspaceBindingError();
    for (const row of index.describe()) {
      if (!row.admitted || index.clientAdapter(row.id) !== 'sandbox') continue;
      const client = index.clientById<{
        connectionById?: (id: string) => { target: string; owner: string; placeholder: boolean; socket: { readyState: number } } | undefined;
      }>(row.id);
      const connection = client.connectionById?.(connectionId);
      if (!connection || connection.placeholder || connection.socket.readyState !== 1) continue;
      return await operation({ endpoint: { adapter: 'sandbox', id: String(row.id) }, endpointKey: connection.target,
        ownerId: connection.owner, connectionId }, lease.value);
    }
    throw new SandboxWorkspaceBindingError();
  } finally { lease.release(); }
}
