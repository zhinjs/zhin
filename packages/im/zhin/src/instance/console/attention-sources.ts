import type { ToolApprovalQueue } from '@zhin.js/agent/security';
import type { SnapshotLease } from '@zhin.js/plugin-runtime';
import type {
  AttentionEndpoint,
  AttentionErrorLogs,
  AttentionMcpServer,
  AttentionPluginState,
  AttentionSources,
  AttentionToolApproval,
} from './attention.js';
import { listMcpServerStatus } from './agent-runtime-resolver.js';
import { buildManagedPluginList } from './plugin-projection.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';
import { agentToolApprovalQueueToken } from './tool-approvals.js';

type LogSelection = PromiseLike<readonly { readonly timestamp?: unknown }[]> & {
  where(where: Record<string, unknown>): LogSelection;
  orderBy(field: string, direction: 'ASC' | 'DESC'): LogSelection;
  limit(count: number): PromiseLike<readonly { readonly timestamp?: unknown }[]>;
};
interface LogModel {
  select(...fields: string[]): LogSelection;
  count?(where?: Record<string, unknown>): Promise<number>;
}

/** Wires `attention.list` to the instance's existing runtime state (one read per request). */
export function createAttentionSources(composition: ConsoleRpcComposition): AttentionSources {
  const { im, snapshots, pluginManagement, configuration, databaseHost, projectRoot, pluginLifecycleFile } = composition;
  const withLease = <T>(run: (lease: SnapshotLease) => T): T => {
    if (!snapshots) throw new Error('Runtime snapshots are unavailable');
    const lease = snapshots.acquire();
    try { return run(lease); } finally { lease.release(); }
  };
  return Object.freeze({
    ...(im ? {
      loginTasks: () => im.loginAssist.listPending().map(task => ({
        id: task.id, adapter: task.adapter, endpointKey: task.endpointKey, type: task.type, createdAt: task.createdAt,
      })),
      endpoints: (): readonly AttentionEndpoint[] => im.endpoints.list().map(row => ({
        adapter: row.endpoint.adapter, name: row.name, connected: row.connected, phase: row.phase, transportState: row.transportState,
      })),
    } : {}),
    ...(pluginManagement?.inspect && snapshots ? {
      plugins: async (): Promise<readonly PromiseSettledResult<AttentionPluginState>[]> => {
        const lease = snapshots.acquire();
        let declared: Awaited<ReturnType<typeof buildManagedPluginList>>;
        try { declared = await buildManagedPluginList(projectRoot, pluginLifecycleFile, lease.value); }
        finally { lease.release(); }
        // Only declared (manageable) plugins have a management state; same reads as GET /plugins.
        return Promise.allSettled(declared.filter(plugin => plugin.manageable).map(plugin => pluginManagement.inspect!(plugin.instanceKey)));
      },
    } : {}),
    configuration: Object.freeze({
      source: () => configuration.readSource(),
      ...(configuration.readLiteralSecrets ? { literalSecrets: () => configuration.readLiteralSecrets!() } : {}),
    }),
    ...(snapshots?.rootResource ? {
      toolApprovals: (): readonly AttentionToolApproval[] | undefined => withLease(lease => {
        const queue = snapshots.rootResource!(lease, agentToolApprovalQueueToken) as ToolApprovalQueue | undefined;
        return queue?.list().filter(entry => entry.status === 'pending').map(entry => ({
          id: entry.id, toolName: entry.toolName, sessionKey: entry.sessionKey, createdAt: entry.createdAt,
        }));
      }),
    } : {}),
    ...(snapshots ? {
      mcpServers: (): readonly AttentionMcpServer[] => withLease(lease => listMcpServerStatus(projectRoot, lease.value)
        .filter(row => typeof row.name === 'string')
        .map(row => ({ name: row.name as string, connected: row.connected === true }))),
    } : {}),
    ...(databaseHost ? {
      errorLogs: async (): Promise<AttentionErrorLogs | null> => {
        if (!databaseHost.started) return null;
        const model = databaseHost.models.get('SystemLog') as LogModel | undefined;
        if (!model || typeof model.select !== 'function') return null;
        const where = { level: 'error' };
        const count = typeof model.count === 'function' ? await model.count(where) : (await model.select('id').where(where)).length;
        if (count <= 0) return { count: 0, latest: null };
        const [row] = await model.select('timestamp').where(where).orderBy('timestamp', 'DESC').limit(1);
        const value = row?.timestamp;
        const latest = value instanceof Date ? value.toISOString() : typeof value === 'string' || typeof value === 'number' ? new Date(value).toISOString() : null;
        return { count, latest };
      },
    } : {}),
  });
}
