import { join } from 'node:path';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
} from '@zhin.js/pagemanager/client-build';
import {
  ConsoleRuntime,
  consoleRuntimeToken,
} from '@zhin.js/pagemanager/plugin-runtime';
import { jsonResponse, type ConsoleAccess, type HttpHandler, type HttpHost } from '@zhin.js/host-http';
import {
  NativeDevelopmentModuleRuntime,
  type ModuleRuntime,
  type RootResourceInstaller,
} from '@zhin.js/runtime';
import { serveCanonicalEsm, serveClientAsset } from './asset-server.js';
import { htmlResponse } from '@zhin.js/gateway/http';
import { renderConsoleIndex, renderPageShell } from '@zhin.js/pagemanager';
import { createTsxModuleLoader } from '@zhin.js/gateway/project';
import {
  listPages,
  projectConsoleEntries,
  requestConsoleAccess,
  resolveLocalizedPageTitle,
  type ExtendedRuntimeConsolePage,
} from './entry-projection.js';

const clientPublicBase = '/assets/client';
const noStore = Object.freeze({ 'cache-control': 'no-store' });

export interface ConsoleHostModules {
  readonly modules: ModuleRuntime;
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  readonly projectRoot: string;
}

export function createConsoleHostModules(projectRoot: string, watch: boolean): ConsoleHostModules {
  const clientOutDir = join(projectRoot, '.zhin', 'client');
  const server = new NativeDevelopmentModuleRuntime({
    projectRoot,
    watch,
    tsxLoader: createTsxModuleLoader(projectRoot),
  });
  const client = new TypeScriptClientBuilder({
    projectRoot,
    outDir: clientOutDir,
    publicBase: clientPublicBase,
    consoleBasePath: '/',
  });
  return Object.freeze({
    modules: new ClientBuildModuleRuntime(server, client),
    console: new ConsoleRuntime(),
    clientOutDir,
    projectRoot,
  });
}

export function registerConsoleHttp(options: {
  readonly http: HttpHost;
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  /** Resolve directory for Host React ESM proxies (`react` package resolution). */
  readonly projectRoot: string;
  /** Whether a page's owner plugin declares the `runtime.sandbox` capability (served with the sandbox chat shell). */
  readonly isSandboxPage?: (page: { readonly owner: string }) => boolean;
}): void {
  const http = options.http;
  // Browser ESM 裸导入（react/jsx-runtime 等）由 TypeScriptClientBuilder 改写为 /esm/<enc>.mjs
  http.route('GET', '/esm/*', (_request, { url }) => serveCanonicalEsm(options.projectRoot, url.pathname));
  http.route('GET', `${clientPublicBase}/*`, (_request, { url }) => (
    serveClientAsset(options.clientOutDir, clientPublicBase, url.pathname)
  ));
  http.route('GET', '/entries', async (request, context) => {
    try {
      const locale = context.url.searchParams.get('locale') ?? undefined;
      const pages = await listPages(options.console, requestConsoleAccess(http, request, context), { locale });
      return jsonResponse(200, projectConsoleEntries(pages, { locale }), noStore);
    } catch (error) {
      return jsonResponse(503, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  http.route('GET', '/console/api/pages', async (request, context) => {
    const locale = context.url.searchParams.get('locale') ?? undefined;
    // The list depends on the caller's token, so it must never be cached or shared.
    return jsonResponse(200, { pages: await readConsolePages(options.console, requestConsoleAccess(http, request, context), locale) }, noStore);
  });
  http.route('GET', '/console/api/topology', async (request, context) => {
    const { url } = context;
    try {
      const topology = await options.console.runView(requestConsoleAccess(http, request, context), (catalog) => {
        const topology = catalog.topology();
        const route = url.searchParams.get('route') ?? undefined;
        return Object.freeze({
          generation: topology.generation,
          pages: topology.pages,
          navigation: topology.navigation,
          ...(route === undefined ? {} : { route, resolution: topology.resolve(route) }),
        });
      });
      return jsonResponse(200, topology, noStore);
    } catch {
      return new Response('ConsoleRuntime is not ready', { status: 503 });
    }
  });
  const serveConsoleIndex: HttpHandler = async (request, context) => {
    const locale = context.url.searchParams.get('locale') ?? undefined;
    return htmlResponse(renderConsoleIndex(await readConsolePages(options.console, requestConsoleAccess(http, request, context), locale)));
  };
  http.route('GET', '/console', serveConsoleIndex);
  http.route('GET', '/pages', serveConsoleIndex);
  // Catch-all page routes must be registered last among exact/prefix peers;
  // matchHttpRoute prefers longest prefix, exact page routes win over shorter prefixes.
  http.route('GET', '/*', async (request, context) => {
    const { url } = context;
    if (url.pathname === '/console' || url.pathname === '/pages' || url.pathname.startsWith('/console/')
      || url.pathname.startsWith(`${clientPublicBase}/`)
      || url.pathname.startsWith('/esm/')) {
      return new Response(null, { status: 404 });
    }
    try {
      // Resolve inside the view: ConsoleTopology#resolve reads the catalog lease,
      // which ends as soon as runView's callback returns.
      const match = await options.console.runView(
        requestConsoleAccess(http, request, context),
        (catalog) => catalog.topology().resolve(url.pathname),
      );
      if (match.status === 'missing') return new Response(null, { status: 404 });
      if (match.status === 'forbidden') return new Response('Forbidden', { status: 403 });
      return htmlResponse(renderPageShell(match.page, {
        runtimeSandbox: options.isSandboxPage?.(match.page) === true,
      }));
    } catch {
      return new Response('ConsoleRuntime is not ready', { status: 503 });
    }
  });
}

/** Publishes the process-owned ConsoleRuntime into a generation Scope. */
export function installConsoleRuntime(consoleRuntime: ConsoleRuntime): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(consoleRuntimeToken, consoleRuntime);
  };
}

async function readConsolePages(consoleRuntime: ConsoleRuntime, access: ConsoleAccess, locale?: string) {
  try {
    const pages = await consoleRuntime.runView(access, (catalog) => catalog.pages());
    if (!locale) return pages;
    return Object.freeze(pages.map((rawPage) => {
      const page = rawPage as ExtendedRuntimeConsolePage;
      const title = resolveLocalizedPageTitle(page.title, page.titleI18n, locale);
      return Object.freeze({ ...page, title });
    }));
  } catch {
    return Object.freeze([]);
  }
}
