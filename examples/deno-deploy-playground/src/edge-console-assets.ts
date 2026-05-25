/**
 * Edge 托管 Console 插件静态资源。
 * 本地/Deno：`static/console/` + Deno 读盘；Vercel/Workers：构建生成的 manifest 内嵌。
 */
import {
  registerFetchRoute,
  type RouteTable,
  type RouterContext,
} from "@zhin.js/http-host/edge";
import type { ConsoleClientEntry } from "@zhin.js/console-types";
import * as path from "node:path";
import manifestJson from "./console-assets.manifest.json" with { type: "json" };

const EMBEDDED_ASSETS: Record<string, string> = manifestJson as Record<string, string>;

function resolveStaticDir(): string {
  const meta = import.meta.url;
  if (typeof meta !== "string" || meta.length === 0) return "";
  try {
    return path.dirname(new URL("../static/console/", meta).pathname);
  } catch {
    return "";
  }
}

const SANDBOX_ENTRY: ConsoleClientEntry = {
  id: "sandbox",
  resolvedModule: "/@assets/sandbox.mjs?v=edge",
  meta: { name: "Sandbox" },
  enabled: true,
};

async function readAssetMjs(relativePath: string): Promise<string | null> {
  const key = relativePath.replace(/\\/g, "/");
  if (EMBEDDED_ASSETS[key]) return EMBEDDED_ASSETS[key];

  const staticDir = resolveStaticDir();
  if (!staticDir) return null;
  const filePath = path.join(staticDir, relativePath);
  try {
    if (typeof Deno !== "undefined" && Deno.readTextFile) {
      return await Deno.readTextFile(filePath);
    }
  } catch {
    /* fall through */
  }
  try {
    const { readFileSync } = await import("node:fs");
    return readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[edge-console-assets] missing ${filePath}:`, err);
    return null;
  }
}

function serveMjs(ctx: RouterContext, code: string, cache: string): void {
  ctx.body = code;
  ctx.set("content-type", "text/javascript; charset=utf-8");
  ctx.set("cache-control", cache);
}

export function getEdgeConsoleEntriesBody(): {
  entries: ConsoleClientEntry[];
  runtimeEnvHint: "production";
  sandboxTransport: "http-sse";
} {
  return {
    entries: [SANDBOX_ENTRY],
    runtimeEnvHint: "production",
    sandboxTransport: "http-sse",
  };
}

/** Console SSE / RPC 用的 entries 字典（与 Host webServer 形状一致） */
export function getEdgeConsoleEntriesRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of getEdgeConsoleEntriesBody().entries) {
    out[e.id] = e.resolvedModule;
  }
  return out;
}

const SANDBOX_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zhin Sandbox (Edge)</title>
  <style>html,body,#root{height:100%;margin:0}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "/esm/react.mjs?v=edge";
    import { createRoot } from "/esm/react-dom~client.mjs?v=edge";
    import Sandbox from "/@assets/sandbox.mjs?v=edge";
    createRoot(document.getElementById("root")).render(React.createElement(Sandbox));
  </script>
</body>
</html>`;

export function registerEdgeConsoleAssetRoutes(table: RouteTable): void {
  registerFetchRoute(table, "GET", "/sandbox-ui", (ctx: RouterContext) => {
    ctx.body = SANDBOX_UI_HTML;
    ctx.set("content-type", "text/html; charset=utf-8");
    ctx.set("cache-control", "no-store");
  });

  registerFetchRoute(table, "GET", "/entries", (ctx: RouterContext) => {
    ctx.body = getEdgeConsoleEntriesBody();
  });

  registerFetchRoute(table, "GET", "/@assets/sandbox.mjs", async (ctx: RouterContext) => {
    const code = await readAssetMjs("assets/sandbox.mjs");
    if (!code) {
      ctx.status = 404;
      ctx.body = { message: "Run: node scripts/prepare-deploy.mjs" };
      return;
    }
    serveMjs(ctx, code, "no-store");
  });

  registerFetchRoute(table, "GET", "/@assets/:file", async (ctx: RouterContext) => {
    const file = ctx.params.file ?? "";
    if (!file.endsWith(".mjs")) {
      ctx.status = 404;
      ctx.body = { message: "Expected .mjs asset" };
      return;
    }
    const code = await readAssetMjs(path.join("assets", file));
    if (!code) {
      ctx.status = 404;
      ctx.body = { message: `Unknown asset: ${file}` };
      return;
    }
    serveMjs(ctx, code, "no-store");
  });

  registerFetchRoute(table, "GET", "/esm/:file", async (ctx: RouterContext) => {
    const file = ctx.params.file ?? "";
    if (!file.endsWith(".mjs")) {
      ctx.status = 404;
      ctx.body = { message: "Expected .mjs module" };
      return;
    }
    const code = await readAssetMjs(path.join("esm", file));
    if (!code) {
      ctx.status = 404;
      ctx.body = { message: `Unknown esm: ${file}` };
      return;
    }
    serveMjs(ctx, code, "public, max-age=3600");
  });
}
