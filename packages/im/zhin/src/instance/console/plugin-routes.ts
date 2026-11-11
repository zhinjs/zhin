import type { ImRuntime } from '@zhin.js/core/runtime';
import { principalAllows, requestConsolePrincipal, type HttpHost, type PluginManagementPort } from '@zhin.js/host-http';
import type { IncomingMessage } from 'node:http';

/** Plugin management needs `plugin.manage`; a test host without a bound principal is open. */
function canManagePlugins(http: HttpHost, request: IncomingMessage): boolean {
  const principal = requestConsolePrincipal(request);
  if (!principal) return !(http.tokenRegistry?.hasAnyToken() ?? false);
  return principalAllows(principal, 'plugin.manage');
}
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { writeJson } from '@zhin.js/gateway/http';
import { displayConsolePath } from './display-path.js';
import {
  buildManagedPluginList,
  buildPluginDetail,
  listSnapshotPlugins,
  readPackageVersion,
} from './plugin-projection.js';
import { readRuntimeSnapshot } from './runtime-snapshot.js';

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
  http.route('GET', `${base}/plugins`, async (request, response) => {
    const canManage = canManagePlugins(http, request);
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
      writeJson(response, 200, { success: true, data, total: plugins.length });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'List loaded plugins',
    tags: ['plugins'],
  });

  http.route('GET', `${base}/plugins/*`, async (request, response, url) => {
    const canManage = canManagePlugins(http, request);
    const prefix = `${base}/plugins/`;
    const raw = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    if (!raw || raw.includes('/')) {
      writeJson(response, 404, { success: false, error: '插件不存在' });
      return;
    }
    let name = '';
    try {
      name = decodeURIComponent(raw);
    } catch {
      writeJson(response, 400, { success: false, error: 'Invalid plugin name' });
      return;
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
          writeJson(response, 404, { success: false, error: '插件不存在' });
          return;
        }
        const packageDir = join(projectRoot, 'node_modules', managed.packageName);
        const version = await readPackageVersion(packageDir);
        writeJson(response, 200, {
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
        return;
      }
      writeJson(response, 200, {
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
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
