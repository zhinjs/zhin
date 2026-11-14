import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolApprovalQueue } from '@zhin.js/agent/security';
import { ROOT_CONFIG_FILE_NAMES, type SnapshotLease } from '@zhin.js/plugin-runtime';
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type {
  AttentionEndpoint,
  AttentionEndpointDrift,
  AttentionErrorLogs,
  AttentionMcpServer,
  AttentionPluginInspection,
  AttentionPluginsRead,
  AttentionSources,
  AttentionToolApproval,
} from './attention.js';
import { DEFAULT_ERROR_LOG_WINDOW_HOURS } from './attention.js';
import { listMcpServerStatus } from './agent-runtime-resolver.js';
import { resolveCurrentAgentConsole } from './agent-console.js';
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
        ...(typeof row.endpoint?.adapter === 'string' ? { adapterType: row.endpoint.adapter } : {}),
        transportState: row.transportState, pendingLogin: row.pendingLogin,
        ...(row.lastError ? { lastError: { category: row.lastError.category, message: row.lastError.message } } : {}),
      })),
    } : {}),
    ...(snapshots ? {
      // #1250: zhin.config.yml `endpoints` versus persisted accounts, per adapter (ids / kinds only).
      endpointConfigDrift: async (): Promise<readonly AttentionEndpointDrift[]> => {
        const lease = snapshots.acquire();
        try {
          const snapshot = lease.value;
          const index = snapshot.projections.get(adapterFeatureId);
          if (!isAdapterIndex(index)) return [];
          const rows: AttentionEndpointDrift[] = [];
          for (const adapter of index.adapters()) {
            const node = snapshot.tree.get(adapter.descriptor.owner);
            if (!node || node.parent !== snapshot.root) continue;
            let drift;
            try { drift = await adapter.configDrift(); } catch { continue; }
            if (!drift.entries.length) continue;
            const ids = (kind: string) => drift.entries.filter(entry => entry.kind === kind).map(entry => entry.id);
            rows.push({ instanceKey: node.instanceKey, adapter: adapter.descriptor.name,
              configOnly: ids('config_only'), savedOnly: ids('snapshot_only'), changed: ids('changed') });
          }
          return rows;
        } finally { lease.release(); }
      },
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
        const [dependencies, settled] = await Promise.all([
          checkOnce ? pluginManagement.checkDependencies!() : undefined,
          Promise.allSettled(manageable.map(plugin => checkOnce
            ? pluginManagement.inspect!(plugin.instanceKey, { dependencies: 'skip' })
            : pluginManagement.inspect!(plugin.instanceKey))),
        ]);
        // A failed inspect keeps its plugin's key, so it is reported for that plugin alone.
        const states = settled.map((result, index): AttentionPluginInspection => result.status === 'fulfilled'
          ? { status: 'fulfilled', value: result.value }
          : { status: 'rejected', instanceKey: manageable[index]!.instanceKey, reason: result.reason });
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
          // No conversation names are stored; the origin is described in words instead of the key.
          ...(entry.origin ? { origin: entry.origin } : {}),
        }));
      }),
    } : {}),
    ...(snapshots ? {
      mcpServers: (): readonly AttentionMcpServer[] => withLease(lease => listMcpServerStatus(projectRoot, lease.value)
        .filter(row => typeof row.name === 'string')
        .map(row => ({ name: row.name as string, connected: row.connected === true }))),
    } : {}),
    ...(snapshots ? {
      unschedulableJobs: () => withLease(lease => resolveCurrentAgentConsole(lease.value)?.assistant?.jobs.unschedulable?.()),
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
