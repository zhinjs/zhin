import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { writeJson } from './http-response.js';
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
}

export function registerConsolePluginRoutes(options: RegisterConsolePluginRoutesOptions): void {
  const { http, base, projectRoot, pluginLifecycleFile, im, snapshot } = options;
  http.route('GET', `${base}/plugins`, async (_request, response) => {
    try {
      const snap = readRuntimeSnapshot(snapshot);
      const plugins = await buildManagedPluginList(
        projectRoot,
        pluginLifecycleFile,
        snap,
        im?.endpoints.list() ?? [],
      );
      writeJson(response, 200, { success: true, data: plugins, total: plugins.length });
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

  http.route('GET', `${base}/plugins/*`, async (_request, response, url) => {
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
      const node = listSnapshotPlugins(snap)
        .find(item => item.instanceKey === name || item.packageName === name);
      if (!node) {
        const managed = (await buildManagedPluginList(
          projectRoot,
          pluginLifecycleFile,
          snap,
          im?.endpoints.list() ?? [],
        )).find(item => item.instanceKey === name || item.packageName === name);
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
            packageRoot: `node_modules/${managed.packageName}`,
            ...(version ? { version } : {}),
          },
        });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: buildPluginDetail(
          node,
          await readPackageVersion(node.packageRoot),
          snap,
          im?.endpoints.list(),
          projectRoot,
        ),
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
