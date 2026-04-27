import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { Context, Next } from "koa";
import type Koa from "koa";
import serve from "koa-static";
import compose from "koa-compose";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import type {
  ConsoleClientHostAttachOptions,
  ConsoleClientHostAttachment,
} from "./consoleServerOptions.js";

function isConsoleApiPath(ctxPath: string, basePath: string): boolean {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (!ctxPath.startsWith(`${base}/`) && ctxPath !== base) return false;
  const rest = ctxPath === base ? "/" : ctxPath.slice(base.length);
  return (
    rest === "/entries" ||
    rest.startsWith("/entries/") ||
    rest === "/me" ||
    rest.startsWith("/me/") ||
    rest.startsWith("/@dev/") ||
    rest.startsWith("/@assets/") ||
    rest.startsWith("/esm/")
  );
}

function isConsoleSpaCandidate(ctxPath: string, consoleBasePath: string): boolean {
  const base = consoleBasePath.endsWith("/") ? consoleBasePath.slice(0, -1) : consoleBasePath;
  if (ctxPath !== base && !ctxPath.startsWith(`${base}/`)) return false;
  if (isConsoleApiPath(ctxPath, consoleBasePath)) return false;
  const ext = path.extname(ctxPath);
  return !ext || ext === ".html";
}

function createSpaFallbackMiddleware(
  getHtml: () => string,
  consoleBasePath: string,
): Koa.Middleware {
  return async (ctx: Context, next: Next) => {
    await next();
    if (ctx.status !== 404) return;
    if (ctx.method !== "GET" && ctx.method !== "HEAD") return;
    if (!isConsoleSpaCandidate(ctx.path, consoleBasePath)) return;
    ctx.type = "html";
    ctx.status = 200;
    ctx.body = getHtml();
  };
}

export async function attachConsoleClientHost(
  koaApp: Koa,
  options: ConsoleClientHostAttachOptions,
): Promise<ConsoleClientHostAttachment> {
  const {
    clientPackageRoot,
    mode = process.env.NODE_ENV === "production" ? "production" : "development",
    consoleBasePath = DEFAULT_CONSOLE_BASE_PATH,
  } = options;

  if (mode === "production") {
    await attachProductionClientHost(koaApp, clientPackageRoot, consoleBasePath);
    return {
      bindDevWebSocket() {},
      prepareListen: async () => {},
      close: async () => {},
    };
  }

  return attachDevelopmentClientHost(koaApp, clientPackageRoot, {
    ...options,
    consoleBasePath,
  });
}

async function attachProductionClientHost(
  koaApp: Koa,
  clientRoot: string,
  consoleBasePath: string,
): Promise<void> {
  const browserDist = path.join(clientRoot, "dist");
  const indexHtmlPath = path.join(browserDist, "index.html");
  if (!existsSync(indexHtmlPath)) {
    console.error(
      `[zhin-console] Missing static: ${indexHtmlPath}. Build @zhin.js/console-app first.`,
    );
    return;
  }

  let htmlCache: string | null = null;
  const getHtml = () => (htmlCache ??= readFileSync(indexHtmlPath, "utf8"));

  const spaMw = createSpaFallbackMiddleware(getHtml, consoleBasePath);
  koaApp.middleware.unshift(spaMw);
  koaApp.use(serve(browserDist, { index: false }));
}

async function attachDevelopmentClientHost(
  koaApp: Koa,
  clientRoot: string,
  devOptions: ConsoleClientHostAttachOptions & { consoleBasePath: string },
): Promise<ConsoleClientHostAttachment> {
  const {
    port = Number(process.env.PORT ?? 3001),
    farmServerPort,
    farmStrictPort,
    farmConfigPath = path.join(clientRoot, "farm.config.ts"),
    consoleBasePath,
  } = devOptions;
  const farmResolvePort = farmServerPort ?? port;
  const strictPort = farmStrictPort ?? farmResolvePort === port;

  process.env.ZHIN_CONSOLE_FARM_EMBEDDED_IN_KOA = "1";

  let farmCore: typeof import("@farmfe/core");
  try {
    farmCore = await import("@farmfe/core");
  } catch {
    console.warn(
      "[zhin-console] @farmfe/core not available; falling back to production static mode.",
    );
    await attachProductionClientHost(koaApp, clientRoot, consoleBasePath);
    return {
      bindDevWebSocket() {},
      prepareListen: async () => {},
      close: async () => {},
    };
  }

  const { createCompiler, createDevServer, resolveConfig, Logger } = farmCore;
  const logger = new Logger();

  const savedCwd = process.cwd();
  try {
    process.chdir(clientRoot);
    var resolved = await resolveConfig(
      {
        root: clientRoot,
        configPath: farmConfigPath,
        clearScreen: false,
        server: { port: farmResolvePort, strictPort },
      },
      "development",
      logger,
    );
  } finally {
    process.chdir(savedCwd);
  }
  if (farmResolvePort !== port && resolved.server) {
    resolved.server.port = port;
  }
  const compiler = await createCompiler(resolved, logger);
  const farmServer = await createDevServer(compiler, resolved, logger);

  await (farmServer as unknown as { compile(): Promise<void> }).compile();
  await farmServer.ws.close();

  const farmMiddlewareSnapshot = [...farmServer.app().middleware];
  for (const mw of farmMiddlewareSnapshot) {
    koaApp.use(mw);
  }

  const devSpaAndMimeFix: Koa.Middleware = async (ctx: Context, next: Next) => {
    const origPath = ctx.path;
    if (isConsoleSpaCandidate(origPath, consoleBasePath)) {
      ctx.path = "/index.html";
    }
    await next();
    const jsExtRe = /\.(tsx?|jsx?)$/;
    if (jsExtRe.test(origPath) && (!ctx.type || ctx.type === "application/octet-stream")) {
      ctx.type = "text/javascript";
    }
  };
  koaApp.middleware.unshift(devSpaAndMimeFix);

  const internalHttpServer = farmServer.server;
  if (internalHttpServer && !internalHttpServer.listening) {
    internalHttpServer.close();
  }
  farmServer.server = undefined;

  let wsBound = false;

  return {
    bindDevWebSocket(server) {
      if (wsBound) throw new Error("[zhin-console] bindDevWebSocket: cannot bind twice");
      wsBound = true;
      farmServer.server = server;
      farmServer.createWebSocket();
      (farmServer as unknown as { invalidateVite(): void }).invalidateVite();
    },
    prepareListen: async () => {
      await (farmServer as unknown as { compile(): Promise<void> }).compile();
      farmServer.watcher?.watchExtraFiles?.();
    },
    close: async () => {
      await farmServer.close();
    },
  };
}
