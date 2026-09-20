import type { HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { writeJson } from './http-response.js';
import { buildConsoleEntriesBody, listPages } from './entry-projection.js';

export interface RegisterConsoleEntryRoutesOptions {
  readonly http: HttpHost;
  readonly consoleRuntime: ConsoleRuntime;
}

export function registerConsoleEntryRoutes(options: RegisterConsoleEntryRoutesOptions): void {
  const { http, consoleRuntime } = options;
  http.route('GET', '/entries', async (_request, response) => {
    try {
      const pages = await listPages(consoleRuntime);
      writeJson(response, 200, buildConsoleEntriesBody(pages));
    } catch (error) {
      writeJson(response, 503, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console entries (plugin discovery)',
    tags: ['console'],
  });
}
