import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost, PluginManagementPort } from '@zhin.js/host-http';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { writeJson } from './http-response.js';
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
  http.route('GET', `${base}/plugins`, async (_request, response, _url, authScope) => {
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
        manageable: authScope !== 'demo' && plugin.manageable,
        ...(plugin.manageable && pluginManagement?.inspect ? { management: await pluginManagement.inspect(plugin.instanceKey) } : {}),
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

  http.route('GET', `${base}/plugins/*`, async (_request, response, url, authScope) => {
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
            ...(managed.manageable && pluginManagement?.inspect ? { management: await pluginManagement.inspect(managed.instanceKey) } : {}),
            manageable: authScope !== 'demo' && managed.manageable,
            readOnly: authScope === 'demo',
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
        ), manageable: authScope !== 'demo' && managedPlugins.some(item =>
          item.instanceKey === node.instanceKey && item.packageName === node.packageName && item.manageable,
        ), readOnly: authScope === 'demo',
        ...(pluginManagement?.inspect && managedPlugins.some(item => item.instanceKey === node.instanceKey && item.packageName === node.packageName && item.manageable) ? { management: await pluginManagement.inspect(node.instanceKey) } : {}) },
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
