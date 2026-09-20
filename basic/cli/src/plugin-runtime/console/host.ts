import { join } from 'node:path';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
} from '@zhin.js/pagemanager/client-build';
import {
  ConsoleRuntime,
  consoleRuntimeToken,
} from '@zhin.js/pagemanager/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  NativeDevelopmentModuleRuntime,
  type ModuleRuntime,
  type RootResourceInstaller,
} from '@zhin.js/runtime';
import { serveCanonicalEsm, serveClientAsset } from './asset-server.js';
import { writeHtml, writeJson } from './http-response.js';
import { renderConsoleIndex, renderPageShell } from './page-renderer.js';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });
const clientPublicBase = '/assets/client';

export interface ConsoleHostModules {
  readonly modules: ModuleRuntime;
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  readonly projectRoot: string;
}

export function createConsoleHostModules(projectRoot: string, watch: boolean): ConsoleHostModules {
  const clientOutDir = join(projectRoot, '.zhin', 'client');
  const server = new NativeDevelopmentModuleRuntime({ projectRoot, watch });
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

export function installConsoleHttp(options: {
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  /** Resolve directory for Host React ESM proxies (`react` package resolution). */
  readonly projectRoot: string;
}): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(consoleRuntimeToken, options.console);
    const http = resources.use(httpHostToken);
    // Browser ESM 裸导入（react/jsx-runtime 等）由 TypeScriptClientBuilder 改写为 /esm/<enc>.mjs
    http.route('GET', '/esm/*', async (_request, response, url) => {
      await serveCanonicalEsm(options.projectRoot, url.pathname, response);
    });
    http.route('GET', `${clientPublicBase}/*`, async (_request, response, url) => {
      await serveClientAsset(options.clientOutDir, clientPublicBase, url.pathname, response);
    });
    http.route('GET', '/console/api/pages', async (_request, response) => {
      const pages = await options.console.runView(publicAccess, (catalog) => catalog.pages());
      writeJson(response, 200, { pages });
    });
    http.route('GET', '/console/api/topology', async (_request, response, url) => {
      try {
        const topology = await options.console.runView(publicAccess, (catalog) => {
          const topology = catalog.topology();
          const route = url.searchParams.get('route') ?? undefined;
          return Object.freeze({
            generation: topology.generation,
            pages: topology.pages,
            navigation: topology.navigation,
            ...(route === undefined ? {} : { route, resolution: topology.resolve(route) }),
          });
        });
        writeJson(response, 200, topology);
      } catch {
        response.writeHead(503);
        response.end('ConsoleRuntime is not ready');
      }
    });
    http.route('GET', '/console', async (_request, response) => {
      const pages = await options.console.runView(publicAccess, (catalog) => catalog.pages());
      writeHtml(response, renderConsoleIndex(pages));
    });
    // Catch-all page routes must be registered last among exact/prefix peers;
    // matchHttpRoute prefers longest prefix, exact page routes win over shorter prefixes.
    http.route('GET', '/*', async (_request, response, url) => {
      if (url.pathname === '/console' || url.pathname.startsWith('/console/')
        || url.pathname.startsWith(`${clientPublicBase}/`)
        || url.pathname.startsWith('/esm/')) {
        response.writeHead(404);
        response.end();
        return;
      }
      try {
        const topology = await options.console.runView(publicAccess, (catalog) => catalog.topology());
        const match = topology.resolve(url.pathname);
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
  };
}
