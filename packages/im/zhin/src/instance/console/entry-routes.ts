import { jsonResponse } from '@zhin.js/host-http';
import type { HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { buildConsoleEntriesBody, listPages, requestConsoleAccess } from './entry-projection.js';

export interface RegisterConsoleEntryRoutesOptions {
  readonly http: HttpHost;
  readonly consoleRuntime: ConsoleRuntime;
}

export function registerConsoleEntryRoutes(options: RegisterConsoleEntryRoutesOptions): void {
  const { http, consoleRuntime } = options;
  http.route('GET', '/entries', async (request, context) => {
    try {
      const rawLocale = context.url.searchParams.get('locale') ?? undefined;
      const locale = rawLocale && rawLocale.trim() ? rawLocale.trim() : undefined;
      const pages = await listPages(consoleRuntime, requestConsoleAccess(http, request, context), { locale });
      // Entries depend on the caller's token, so they must never be cached or shared.
      return jsonResponse(200, buildConsoleEntriesBody(pages, undefined, { locale }), { 'cache-control': 'no-store' });
    } catch (error) {
      return jsonResponse(503, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console entries (plugin discovery)',
    tags: ['console'],
  });
}
