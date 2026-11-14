import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolApprovalQueue } from '@zhin.js/agent/security';
import { ROOT_CONFIG_FILE_NAMES, type SnapshotLease } from '@zhin.js/plugin-runtime';
import type {
  AttentionEndpoint,
  AttentionErrorLogs,
  AttentionMcpServer,
  AttentionPluginsRead,
  AttentionSources,
  AttentionToolApproval,
} from './attention.js';
import { DEFAULT_ERROR_LOG_WINDOW_HOURS } from './attention.js';
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

/** Files whose change invalidates cached plugin / configuration reads (with the runtime generation). */
const REVISION_FILES = Object.freeze(['package.json', ...ROOT_CONFIG_FILE_NAMES]);

/**
 * Wires `attention.list` to the instance's existing runtime state. Accounts and login tasks are
 * read live; plugins, configuration, MCP and logs are meant to be shared through an
 * `AttentionSourceCache` keyed by `revision` (project file mtimes + runtime generation).
 */
export interface AttentionSourceOptions {
  /** Clock for the error-log window (tests). */
  readonly now?: () => number;
  /** Hours of error logs counted by the `logs.errors` item; defaults to 24. */
  readonly errorLogWindowHours?: number;
}

export function createAttentionSources(composition: ConsoleRpcComposition, options: AttentionSourceOptions = {}): AttentionSources {
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
        ...(task.endpointIdentity ? { canonicalId: task.endpointIdentity.canonicalId } : {}),
      })),
      // `adapter` / `name` as `endpoint.list` rows carry them: the Console's account address.
      endpoints: (): readonly AttentionEndpoint[] => im.endpoints.list().map(row => ({
        id: row.id, adapter: row.adapter, name: row.name, connected: row.connected, phase: row.phase,
        transportState: row.transportState, pendingLogin: row.pendingLogin,
      })),
    } : {}),
    ...(pluginManagement?.inspect && snapshots ? {
      plugins: async (): Promise<AttentionPluginsRead> => {
        const lease = snapshots.acquire();
        let declared: Awaited<ReturnType<typeof buildManagedPluginList>>;
        try { declared = await buildManagedPluginList(projectRoot, pluginLifecycleFile, lease.value); }
        finally { lease.release(); }
        // Only declared (manageable) plugins have a management state; same reads as GET /plugins.
        const manageable = declared.filter(plugin => plugin.manageable);
        // The dependency graph is project-wide: check it once here instead of once per inspect.
        const checkOnce = typeof pluginManagement.checkDependencies === 'function' && manageable.length > 0;
        const [dependencies, states] = await Promise.all([
          checkOnce ? pluginManagement.checkDependencies!() : undefined,
          Promise.allSettled(manageable.map(plugin => checkOnce
            ? pluginManagement.inspect!(plugin.instanceKey, { dependencies: 'skip' })
            : pluginManagement.inspect!(plugin.instanceKey))),
        ]);
        return { states, ...(dependencies ? { dependencies } : {}) };
      },
    } : {}),
    configuration: Object.freeze({
      projectRoot,
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
        // A count query only: never load the error rows to count them.
        if (typeof model.count !== 'function') return null;
        const windowHours = options.errorLogWindowHours ?? DEFAULT_ERROR_LOG_WINDOW_HOURS;
        const since = new Date((options.now?.() ?? Date.now()) - windowHours * 3_600_000);
        const where = { level: 'error', timestamp: { $gte: since } };
        const count = await model.count(where);
        if (count <= 0) return { count: 0, latest: null, windowHours };
        const [row] = await model.select('timestamp').where(where).orderBy('timestamp', 'DESC').limit(1);
        const value = row?.timestamp;
        const latest = value instanceof Date ? value.toISOString() : typeof value === 'string' || typeof value === 'number' ? new Date(value).toISOString() : null;
        return { count, latest, windowHours };
      },
    } : {}),
    revision: async () => {
      let generation = 'none';
      if (snapshots) {
        const lease = snapshots.acquire();
        try { generation = String(lease.value.generation); } finally { lease.release(); }
      }
      const files = await Promise.all(REVISION_FILES.map(name => stat(join(projectRoot, name))
        .then(info => `${info.mtimeMs}:${info.size}`, () => '-')));
      return `${generation}|${files.join('|')}`;
    },
  });
}
