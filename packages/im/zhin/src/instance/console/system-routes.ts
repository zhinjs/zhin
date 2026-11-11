import { jsonResponse } from '@zhin.js/host-http';
import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  listSnapshotPlugins,
} from './plugin-projection.js';
import { readRuntimeSnapshot } from './runtime-snapshot.js';
import { buildConsoleStats, getSystemStatusData } from './system-projection.js';
import { internalErrorResponse } from './internal-error.js';

export interface RegisterConsoleSystemRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly im?: ImRuntime;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
}

export function registerConsoleSystemRoutes(options: RegisterConsoleSystemRoutesOptions): void {
  const { http, base, im, snapshot } = options;
  http.route('GET', `${base}/system/status`, () => {
    return jsonResponse(200, { success: true, data: getSystemStatusData() });
  }, {
    summary: 'System status snapshot',
    tags: ['system'],
  });

  http.route('GET', `${base}/stats`, async () => {
    try {
      const endpoints = im ? im.endpoints.list() : [];
      const snap = readRuntimeSnapshot(snapshot);
      const commandIndex = snap?.projections.get(commandFeatureId);
      const commandCount = isCommandIndex(commandIndex) ? commandIndex.list().length : 0;
      const componentIndex = snap?.projections.get(componentFeatureId);
      const componentCount = isComponentIndex(componentIndex) ? componentIndex.list().length : 0;
      return jsonResponse(200, {
        success: true,
        data: {
          ...buildConsoleStats(listSnapshotPlugins(snap).length, endpoints),
          commands: commandCount,
          components: componentCount,
        },
      });
    } catch (error) {
      return internalErrorResponse(500, 'console_stats_failed', error);
    }
  }, {
    summary: 'Dashboard statistics',
    tags: ['system'],
  });
}
