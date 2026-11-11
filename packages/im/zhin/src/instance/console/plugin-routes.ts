import type { ImRuntime } from '@zhin.js/core/runtime';
import { jsonResponse, principalAllows, type ConsolePrincipal, type HttpHost, type PluginManagementPort } from '@zhin.js/host-http';

/** Plugin management needs `plugin.manage`; a test host without a resolved principal is open. */
function canManagePlugins(http: HttpHost, principal: ConsolePrincipal | undefined): boolean {
  if (!principal) return !(http.tokenRegistry?.hasAnyToken() ?? false);
  return principalAllows(principal, 'plugin.manage');
}
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { displayConsolePath } from './display-path.js';
import {
  buildManagedPluginList,
  buildPluginDetail,
  listSnapshotPlugins,
  readPackageVersion,
} from './plugin-projection.js';
import { readRuntimeSnapshot } from './runtime-snapshot.js';
import { internalErrorResponse } from './internal-error.js';

export interface RegisterConsolePluginRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly projectRoot: string;
  readonly pluginLifecycleFile: string;
  readonly im?: ImRuntime;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  readonly pluginManagement?: PluginManagementPort;
}

export function registerConsolePluginRoutes(options: RegisterConsolePluginRoutesOptions): void {
  const { http, base, projectRoot, pluginLifecycleFile, im, snapshot, pluginManagement } = options;
  http.route('GET', `${base}/plugins`, async (_request, { principal }) => {
    const canManage = canManagePlugins(http, principal);
    try {
      const snap = readRuntimeSnapshot(snapshot);
      const plugins = await buildManagedPluginList(
        projectRoot,
        pluginLifecycleFile,
        snap,
        im?.endpoints.list() ?? [],
      );
      const data = await Promise.all(plugins.map(async plugin => ({
        ...plugin,
        manageable: canManage && plugin.manageable,
        ...await inspectPlugin(pluginManagement, plugin.instanceKey, plugin.manageable),
      })));
      return jsonResponse(200, { success: true, data, total: plugins.length });
    } catch (error) {
      return internalErrorResponse(500, 'console_plugins_failed', error);
    }
  }, {
    summary: 'List loaded plugins',
    tags: ['plugins'],
  });

  http.route('GET', `${base}/plugins/*`, async (_request, { url, principal }) => {
    const canManage = canManagePlugins(http, principal);
    const prefix = `${base}/plugins/`;
    const raw = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    if (!raw || raw.includes('/')) {
      return jsonResponse(404, { success: false, error: '插件不存在' });
    }
    let name = '';
    try {
      name = decodeURIComponent(raw);
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid plugin name' });
    }
    try {
      const snap = readRuntimeSnapshot(snapshot);
      const managedPlugins = await buildManagedPluginList(
        projectRoot, pluginLifecycleFile, snap, im?.endpoints.list() ?? [],
      );
      const node = listSnapshotPlugins(snap)
        .find(item => item.instanceKey === name || item.packageName === name);
      if (!node) {
        const managed = managedPlugins.find(item => item.instanceKey === name || item.packageName === name);
        if (!managed) {
          return jsonResponse(404, { success: false, error: '插件不存在' });
        }
        const packageDir = join(projectRoot, 'node_modules', managed.packageName);
        const version = await readPackageVersion(packageDir);
        return jsonResponse(200, {
          success: true,
          data: {
            ...managed,
            ...await inspectPlugin(pluginManagement, managed.instanceKey, managed.manageable),
            manageable: canManage && managed.manageable,
            readOnly: !canManage,
            packageRoot: displayConsolePath(packageDir, projectRoot),
            ...(version ? { version } : {}),
          },
        });
      }
      return jsonResponse(200, {
        success: true,
        data: { ...buildPluginDetail(
          node,
          await readPackageVersion(node.packageRoot),
          snap,
          im?.endpoints.list(),
          projectRoot,
        ), manageable: canManage && managedPlugins.some(item =>
          item.instanceKey === node.instanceKey && item.packageName === node.packageName && item.manageable,
        ), readOnly: !canManage,
        ...await inspectPlugin(pluginManagement, node.instanceKey, managedPlugins.some(item => item.instanceKey === node.instanceKey && item.packageName === node.packageName && item.manageable)) },
      });
    } catch (error) {
      return internalErrorResponse(500, 'console_plugins_failed', error);
    }
  }, {
    summary: 'Plugin detail',
    tags: ['plugins'],
  });
}

async function inspectPlugin(port: PluginManagementPort | undefined, instanceKey: string, manageable: boolean) {
  if (!manageable || !port?.inspect) return {};
  try { return { management: await port.inspect(instanceKey) }; }
  catch (error) { return { managementError: error instanceof Error ? error.message : String(error) }; }
}
