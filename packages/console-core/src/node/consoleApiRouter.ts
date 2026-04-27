import Router from "@koa/router";
import type Koa from "koa";
import { readFile } from "node:fs/promises";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";
import {
  ALLOWED_ESM_CANONICAL,
  decodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
  rewriteBareImportsForBrowser,
} from "./esmForBrowser.js";
import { bundleEntryToTempFile } from "./pluginEntryBundle.js";
import type { EntryStore } from "./entryStore.js";
import type { ConsoleServerOptions } from "./consoleServerOptions.js";

function effectivePublicOrigin(ctx: Koa.Context): string {
  const proto = ctx.get("x-forwarded-proto") || ctx.protocol;
  const host = ctx.get("x-forwarded-host") || ctx.host;
  return `${proto}://${host}`;
}

export function registerConsoleApiRoutes(
  router: Router,
  entryStore: EntryStore,
  options: ConsoleServerOptions,
): void {
  const basePath = options.path ?? DEFAULT_CONSOLE_BASE_PATH;
  const resolveDir = options.clientPackageRoot;

  router.get("/esm/:enc.mjs", async (ctx: Koa.Context) => {
    let canonical: string;
    try {
      canonical = decodeSpecifierSegment(String((ctx.params as { enc?: string }).enc ?? ""));
    } catch {
      ctx.status = 400;
      ctx.body = { message: "Invalid esm enc" };
      return;
    }
    if (!ALLOWED_ESM_CANONICAL.has(canonical)) {
      ctx.status = 403;
      ctx.body = { message: "ESM canonical not allowed" };
      return;
    }

    try {
      const code = await getOrBuildCanonicalEsmBundle(canonical, resolveDir, basePath);
      ctx.set("content-type", "text/javascript; charset=utf-8");
      ctx.set("cache-control", "public, max-age=3600");
      ctx.body = code;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { message: err instanceof Error ? err.message : "Failed to build ESM" };
    }
  });

  const sendPluginBody = async (ctx: Koa.Context, absSource: string, cacheKey: string) => {
    const origin = effectivePublicOrigin(ctx);
    const outfile = await bundleEntryToTempFile(cacheKey, absSource, resolveDir);
    const raw = await readFile(outfile, "utf8");
    const code = rewriteBareImportsForBrowser(raw, basePath, origin);
    ctx.set("content-type", "text/javascript; charset=utf-8");
    ctx.set("cache-control", "no-store");
    ctx.body = code;
  };

  router.get("/@dev/:id.mjs", async (ctx: Koa.Context) => {
    const id = String((ctx.params as { id?: string }).id ?? "");
    const entry = entryStore.list().find((e) => e.id === id);
    if (!entry?.paths) {
      ctx.status = 404;
      ctx.body = { message: "Unknown entry or not a filesystem entry" };
      return;
    }
    try {
      await sendPluginBody(ctx, entry.paths.development, `dev:${id}:${entry.paths.development}`);
    } catch (err) {
      ctx.status = 500;
      ctx.body = { message: err instanceof Error ? err.message : "Failed to serve dev plugin" };
    }
  });

  router.get("/@assets/:id.mjs", async (ctx: Koa.Context) => {
    const id = String((ctx.params as { id?: string }).id ?? "");
    const entry = entryStore.list().find((e) => e.id === id);
    if (!entry) {
      ctx.status = 404;
      ctx.body = { message: "Unknown entry" };
      return;
    }
    try {
      if (entry.paths) {
        await sendPluginBody(ctx, entry.paths.production, `prod:${id}:${entry.paths.production}`);
        return;
      }
      ctx.status = 500;
      ctx.body = { message: "Entry has no paths configured" };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { message: err instanceof Error ? err.message : "Failed to serve plugin asset" };
    }
  });
}
