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
      `[zhin-console] Missing static: ${indexHtmlPath}. Build Remote Console UI (zhin-console) or enable serveClientHost with a dist.`,
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
  void koaApp;
  void devOptions;
  console.warn(
    "[zhin-console] Embedded Farm dev UI was removed. Use Remote Console (zhin-console) or serveClientHost with a prebuilt dist.",
    { clientRoot },
  );
  return {
    bindDevWebSocket() {},
    prepareListen: async () => {},
    close: async () => {},
  };
}
