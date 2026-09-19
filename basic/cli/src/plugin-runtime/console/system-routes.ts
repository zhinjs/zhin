import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { writeJson } from './http-response.js';
import {
  listSnapshotPlugins,
} from './plugin-projection.js';
import { readRuntimeSnapshot } from './runtime-snapshot.js';
import { buildConsoleStats, getSystemStatusData } from './system-projection.js';

export interface RegisterConsoleSystemRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly im?: ImRuntime;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
}

export function registerConsoleSystemRoutes(options: RegisterConsoleSystemRoutesOptions): void {
  const { http, base, im, snapshot } = options;
  http.route('GET', `${base}/system/status`, (_request, response) => {
    writeJson(response, 200, { success: true, data: getSystemStatusData() });
  }, {
    summary: 'System status snapshot',
    tags: ['system'],
  });

  http.route('GET', `${base}/stats`, async (_request, response) => {
    try {
      const endpoints = im ? im.listEndpoints() : [];
      const snap = readRuntimeSnapshot(snapshot);
      const commandIndex = snap?.projections.get(commandFeatureId);
      const commandCount = isCommandIndex(commandIndex) ? commandIndex.list().length : 0;
      const componentIndex = snap?.projections.get(componentFeatureId);
      const componentCount = isComponentIndex(componentIndex) ? componentIndex.list().length : 0;
      writeJson(response, 200, {
        success: true,
        data: {
          ...buildConsoleStats(listSnapshotPlugins(snap).length, endpoints),
          commands: commandCount,
          components: componentCount,
        },
      });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Dashboard statistics',
    tags: ['system'],
  });
}
