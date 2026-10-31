import { join } from 'node:path';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
} from '@zhin.js/pagemanager/client-build';
import {
  ConsoleRuntime,
  consoleRuntimeToken,
} from '@zhin.js/pagemanager/plugin-runtime';
import type { HttpHost } from '@zhin.js/host-http';
import {
  NativeDevelopmentModuleRuntime,
  type ModuleRuntime,
  type RootResourceInstaller,
} from '@zhin.js/runtime';
import { serveCanonicalEsm, serveClientAsset } from './asset-server.js';
import { writeHtml, writeJson } from './http-response.js';
import { renderConsoleIndex, renderPageShell } from './page-renderer.js';
import { createTsxModuleLoader } from '../start/tsx-module-loader.js';
import { requestConsoleAccess } from './entry-projection.js';
import type { ConsoleAccess } from '@zhin.js/host-http';

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
}): void {
  const http = options.http;
  // Browser ESM 裸导入（react/jsx-runtime 等）由 TypeScriptClientBuilder 改写为 /esm/<enc>.mjs
  http.route('GET', '/esm/*', async (_request, response, url) => {
    await serveCanonicalEsm(options.projectRoot, url.pathname, response);
  });
  http.route('GET', `${clientPublicBase}/*`, async (_request, response, url) => {
    await serveClientAsset(options.clientOutDir, clientPublicBase, url.pathname, response);
  });
  http.route('GET', '/console/api/pages', async (request, response, url) => {
    // The list depends on the caller's token, so it must never be cached or shared.
    writeJson(response, 200, { pages: await readConsolePages(options.console, requestConsoleAccess(http, request, url)) }, noStore);
  });
  http.route('GET', '/console/api/topology', async (request, response, url) => {
    try {
      const topology = await options.console.runView(requestConsoleAccess(http, request, url), (catalog) => {
        const topology = catalog.topology();
        const route = url.searchParams.get('route') ?? undefined;
        return Object.freeze({
          generation: topology.generation,
          pages: topology.pages,
          navigation: topology.navigation,
          ...(route === undefined ? {} : { route, resolution: topology.resolve(route) }),
        });
      });
      writeJson(response, 200, topology, noStore);
    } catch {
      response.writeHead(503);
      response.end('ConsoleRuntime is not ready');
    }
  });
  http.route('GET', '/console', async (request, response, url) => {
    writeHtml(response, renderConsoleIndex(await readConsolePages(options.console, requestConsoleAccess(http, request, url))));
  });
  // Catch-all page routes must be registered last among exact/prefix peers;
  // matchHttpRoute prefers longest prefix, exact page routes win over shorter prefixes.
  http.route('GET', '/*', async (request, response, url) => {
    if (url.pathname === '/console' || url.pathname.startsWith('/console/')
      || url.pathname.startsWith(`${clientPublicBase}/`)
      || url.pathname.startsWith('/esm/')) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      // Resolve inside the view: ConsoleTopology#resolve reads the catalog lease,
      // which ends as soon as runView's callback returns.
      const match = await options.console.runView(
        requestConsoleAccess(http, request, url),
        (catalog) => catalog.topology().resolve(url.pathname),
      );
      if (match.status === 'missing') {
        response.writeHead(404);
        response.end();
        return;
      }
      if (match.status === 'forbidden') {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      writeHtml(response, renderPageShell(match.page));
    } catch {
      response.writeHead(503);
      response.end('ConsoleRuntime is not ready');
    }
  });
}

/** Publishes the process-owned ConsoleRuntime into a generation Scope. */
export function installConsoleRuntime(consoleRuntime: ConsoleRuntime): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(consoleRuntimeToken, consoleRuntime);
  };
}

async function readConsolePages(consoleRuntime: ConsoleRuntime, access: ConsoleAccess) {
  try {
    return await consoleRuntime.runView(access, (catalog) => catalog.pages());
  } catch {
    return Object.freeze([]);
  }
}
