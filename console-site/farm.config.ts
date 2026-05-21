import type { IncomingMessage } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@farmfe/core";
import farmPostcss from "@farmfe/js-plugin-postcss";
import react from "@farmfe/plugin-react";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const consoleApiTarget = process.env.VITE_DEV_API ?? "http://127.0.0.1:8086";

function forwardDevHostToApi(
  proxyReq: { setHeader: (n: string, v: string) => void },
  req: IncomingMessage,
) {
  const host = req.headers.host;
  if (host) proxyReq.setHeader("x-forwarded-host", host);
  const raw = req.headers["x-forwarded-proto"];
  const first = Array.isArray(raw) ? raw[0] : typeof raw === "string" ? raw.split(",")[0]?.trim() : "";
  proxyReq.setHeader("x-forwarded-proto", first === "https" ? "https" : "http");
}

const consoleApiProxy = {
  target: consoleApiTarget,
  changeOrigin: true,
  onProxyReq(
    proxyReq: { setHeader: (n: string, v: string) => void },
    req: IncomingMessage,
  ) {
    forwardDevHostToApi(proxyReq, req);
  },
} as const;

const consoleDevProxy = {
  [`${DEFAULT_CONSOLE_BASE_PATH}/entries`]: consoleApiProxy,
  [`${DEFAULT_CONSOLE_BASE_PATH}/me`]: consoleApiProxy,
  [`${DEFAULT_CONSOLE_BASE_PATH}/@dev`]: consoleApiProxy,
  [`${DEFAULT_CONSOLE_BASE_PATH}/@assets`]: consoleApiProxy,
  [`${DEFAULT_CONSOLE_BASE_PATH}/esm`]: consoleApiProxy,
  "/api": consoleApiProxy,
} as const;

const pagesBase = (process.env.CONSOLE_PAGES_BASE ?? "").replace(/\/$/, "");
const assetPublicPath = pagesBase ? `${pagesBase}/` : "/";

export default defineConfig({
  root: path.join(siteRoot, "client"),
  plugins: [react({ runtime: "automatic" }), farmPostcss()],
  compilation: {
    presetEnv: false,
    lazyCompilation: false,
    partialBundling: {
      enforceResources: [
        { name: "lucide-react", test: ["[\\\\/]lucide-react[\\\\/]", "lucide-react"] },
        { name: "radix-ui", test: ["[\\\\/]radix-ui[\\\\/]", "radix-ui"] },
      ],
    },
    input: { index: "./index.html" },
    output: {
      path: path.join(siteRoot, "dist"),
      publicPath: assetPublicPath,
    },
    resolve: {
      dedupe: ["lucide-react"],
      alias: {
        "@console": path.join(siteRoot, "console-ui/src"),
        react: path.resolve(siteRoot, "node_modules/react"),
        "react-dom": path.resolve(siteRoot, "node_modules/react-dom"),
        "react-router-dom": path.resolve(siteRoot, "node_modules/react-router-dom"),
        "react-router": path.resolve(
          siteRoot,
          "node_modules/react-router-dom/node_modules/react-router",
        ),
        "react-refresh": path.resolve(siteRoot, "node_modules/react-refresh"),
        "lucide-react": path.resolve(siteRoot, "node_modules/lucide-react"),
        "radix-ui": path.resolve(siteRoot, "node_modules/radix-ui"),
        "class-variance-authority": path.resolve(siteRoot, "node_modules/class-variance-authority"),
        clsx: path.resolve(siteRoot, "node_modules/clsx"),
        "tailwind-merge": path.resolve(siteRoot, "node_modules/tailwind-merge"),
        yaml: path.resolve(siteRoot, "node_modules/yaml"),
      },
    },
  },
  server: {
    spa: true,
    proxy: consoleDevProxy,
  },
});
