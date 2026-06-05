import { formatCompact, usePlugin } from '@zhin.js/core';
import { Schema } from "@zhin.js/schema";
import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import Koa from "koa";
import body from "koa-body";
import { Router, buildOpenApiDocument } from "./router.js";
import {
  createAuthMiddleware,
  createCorsMiddleware,
  securityHeadersMiddleware,
} from "./http-middleware.js";
import { isBenignClientDisconnect } from "./stream-errors.js";

export * from "./router.js";

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      koa: Koa;
      router: Router;
      server: Server;
    }
  }
}

/** 官方 Remote Console 源（CORS + 启动日志中的打开链接） */
export const REMOTE_CONSOLE_ORIGIN = "https://console.zhin.dev";

const DEFAULT_CORS_ORIGINS = [REMOTE_CONSOLE_ORIGIN];

export const httpSchema = Schema.object({
  port: Schema.number().default(8086).description("HTTP 服务端口"),
  token: Schema.string().description(
    "API 访问令牌，不填则自动生成。通过 Authorization: Bearer <token> 传递"
  ),
  base: Schema.string()
    .default("/api")
    .description("HTTP 路由前缀, 默认为 /api"),
  corsOrigins: Schema.list(Schema.string())
    .default(DEFAULT_CORS_ORIGINS)
    .description(
      `Remote Console 允许的 CORS Origin 列表（默认含 ${REMOTE_CONSOLE_ORIGIN}）`,
    ),
});

export interface HttpConfig {
  port?: number;
  host?: string;
  token?: string;
  base?: string;
  corsOrigins?: string[];
  trustProxy?: boolean;
}

const generateToken = () => crypto.randomBytes(16).toString('hex');

const plugin = usePlugin();
const { provide, root, useContext, logger, declareConfig } = plugin;

declareConfig("http", httpSchema, { reloadable: false });

const app = new Koa();
app.on("error", (err) => {
  if (isBenignClientDisconnect(err)) return;
  logger.error(err);
});

const server = createServer(app.callback());
server.on("clientError", (err, socket) => {
  if (isBenignClientDisconnect(err)) {
    socket.destroy();
    return;
  }
});

const router = new Router(server, process.env.routerPrefix || "");

provide({
  name: "server",
  description: "http server",
  value: server,
  dispose(s: Server) {
    s.close();
  },
});

useContext("config", (configService) => {
  const appConfig = configService.getPrimary<{ http?: HttpConfig }>();
  const httpConfig = appConfig.http || {};
  const {
    port = 8086,
    host = "127.0.0.1",
    token = generateToken(),
    base = "/api",
    corsOrigins: userCorsOrigins = [],
    trustProxy = false,
  } = httpConfig;

  const corsOrigins = [
    ...new Set([...DEFAULT_CORS_ORIGINS, ...userCorsOrigins]),
  ];

  app.proxy = trustProxy;

  // Share the auth token with the Router so WebSocket upgrades are also protected
  router.setAuthToken(token);

  router.get('/pub/health', async (ctx) => {
    ctx.body = {
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  router.get("/pub/openapi.json", async (ctx) => {
    const hostHeader = ctx.get("host") ?? "localhost";
    const proto = ctx.get("x-forwarded-proto") ?? "http";
    const serverUrl = `${proto}://${hostHeader}`;
    const pkgVersion = process.env.npm_package_version ?? "0.0.0";
    ctx.body = buildOpenApiDocument(router.listRoutes(), {
      title: "Zhin Host API",
      version: pkgVersion,
      apiBase: base,
      serverUrl,
    });
  });

  app.use(createCorsMiddleware(corsOrigins));
  app.use(securityHeadersMiddleware());
  app.use(body());
  app.use(
    createAuthMiddleware({
      token,
      base,
      whiteList: router.whiteList,
    }),
  );
  app.use(router.routes());
  app.use(router.allowedMethods());

  server.listen({ host, port }, () => {
    const address = server.address();
    if (!address) return;
    const listenPort =
      typeof address === "object" && address && "port" in address
        ? address.port
        : port;
    const publicHost =
      host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const visitAddress = `${publicHost}:${listenPort}`;
    const originUrl = `http://${visitAddress}`;
    const apiUrl = `http://${visitAddress}${base}`;
    const openapiUrl = `${originUrl}/pub/openapi.json`;
    const consoleUrl = `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(originUrl)}`;

    logger.info(
      formatCompact({
        服务端口: listenPort,
        接口地址: apiUrl,
        文档地址: openapiUrl,
        控制台: consoleUrl,
        令牌前缀: token.slice(0, 6),
      }),
    );
  });
});

provide({
  name: "koa",
  description: "koa http application",
  value: app,
});

provide({
  name: "router",
  description: "koa http router",
  value: router,
});
