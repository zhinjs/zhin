import type { IncomingMessage } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@farmfe/core";
import farmPostcss from "@farmfe/js-plugin-postcss";
import react from "@farmfe/plugin-react";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const consoleApiTarget = process.env.VITE_DEV_API ?? "http://127.0.0.1:3001";

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
} as const;

const farmEmbeddedInKoa = process.env.ZHIN_CONSOLE_FARM_EMBEDDED_IN_KOA === "1";

export default defineConfig({
  root: path.join(packageRoot, "client"),
  plugins: [react({ runtime: "automatic" }), farmPostcss()],
  compilation: {
    presetEnv: false,
    input: {
      index: "./index.html",
    },
    output: {
      path: path.join(packageRoot, "dist"),
      publicPath: "/",
    },
    resolve: {
      alias: {
        "@console": path.resolve(packageRoot, "../../plugins/services/console/client/src"),
        "react": path.resolve(packageRoot, "node_modules/react"),
        "react-dom": path.resolve(packageRoot, "node_modules/react-dom"),
        "react-router-dom": path.resolve(packageRoot, "node_modules/react-router-dom"),
        "react-router": path.resolve(packageRoot, "node_modules/react-router-dom/node_modules/react-router"),
        "react-refresh": path.resolve(packageRoot, "node_modules/react-refresh"),
        "lucide-react": path.resolve(packageRoot, "node_modules/lucide-react"),
        "radix-ui": path.resolve(packageRoot, "node_modules/radix-ui"),
        "class-variance-authority": path.resolve(packageRoot, "node_modules/class-variance-authority"),
        "clsx": path.resolve(packageRoot, "node_modules/clsx"),
        "tailwind-merge": path.resolve(packageRoot, "node_modules/tailwind-merge"),
        "yaml": path.resolve(packageRoot, "node_modules/yaml"),
      },
    },
  },
  server: {
    spa: !farmEmbeddedInKoa,
    ...(farmEmbeddedInKoa ? {} : { proxy: consoleDevProxy }),
  },
});
