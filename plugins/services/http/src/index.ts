import { formatCompact, DatabaseFeature, Plugin, usePlugin } from 'zhin.js';
import { Schema } from "@zhin.js/schema";
import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import Koa from "koa";
import body from "koa-body";
import {
  RouteTable,
  buildOpenApiDocument,
  createFetchApp,
  koaFallback,
  koaJsonBodyMiddleware,
  writeWebResponse,
} from "@zhin.js/http-host";
import { Router } from "./router.js";
import { registerHostRestRoutes } from "./host-rest-api.js";
import { registerLogsRoutes } from "./logs-rest-api.js";
import { registerMarketplaceRoutes } from "./marketplace-rest-api.js";
import { createMemoryStoragePort } from "@zhin.js/storage-port";
import { QueueRuntime, registerQueueRoutes } from "@zhin.js/queue-runtime";

async function nodeRequestToWebRequest(
  req: import("node:http").IncomingMessage,
): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  return new Request(url, {
    method,
    headers,
    body: req as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

export * from "./router.js";

declare module "zhin.js" {
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

// Schema 定义
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
  /** 是否信任反向代理（Cloudflare、Nginx 等）的 X-Forwarded-* 头，部署在代理后时建议设为 true */
  trustProxy?: boolean;
}

const generateToken = () => crypto.randomBytes(16).toString('hex');

const plugin = usePlugin();
const { provide, root, useContext, logger, declareConfig } = plugin;

declareConfig("http", httpSchema, { reloadable: false });

// Fetch HttpHost + internal Koa（仅 Console 静态回落）
const routeTable = new RouteTable();
const internalKoa = new Koa();
internalKoa.use(koaJsonBodyMiddleware());
internalKoa.use(body());

let fetchHandler: (req: Request) => Promise<Response> = async () =>
  new Response(JSON.stringify({ success: false, error: "HTTP not configured" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const webReq = await nodeRequestToWebRequest(nodeReq);
    const webRes = await fetchHandler(webReq);
    await writeWebResponse(nodeRes, webRes);
  } catch (err) {
    nodeRes.statusCode = 500;
    nodeRes.end(JSON.stringify({ success: false, error: String(err) }));
  }
});

const router = new Router(server, routeTable, process.env.routerPrefix || "");

// 注册 server 上下文
provide({
  name: "server",
  description: "http server",
  value: server,
  dispose(s: Server) {
    s.close();
  },
});

// 使用配置服务
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

  internalKoa.proxy = trustProxy;

  fetchHandler = createFetchApp(routeTable, {
    base,
    token,
    corsOrigins,
    trustProxy,
    fallback: koaFallback(internalKoa),
  }).fetch;

  const queueStorage = createMemoryStoragePort();
  const queueRuntime = new QueueRuntime(queueStorage, { botId: "host-default" });
  registerQueueRoutes(routeTable, base, queueRuntime);

  // ============================================================================
  // API 路由
  // ============================================================================

  registerHostRestRoutes(routeTable, base, () => root);
  registerMarketplaceRoutes(routeTable, base, () => root);

  // 健康检查 API
  router.get('/pub/health', async (ctx) => {
    ctx.body = {
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  // 运行时 OpenAPI（供 Remote Console / 插件对接发现当前实例路由）
  router.get("/pub/openapi.json", async (ctx) => {
    const hostHeader = ctx.get("host") ?? "localhost";
    const proto = ctx.get("x-forwarded-proto") ?? "http";
    const serverUrl = `${proto}://${hostHeader}`;
    const pkgVersion = process.env.npm_package_version ?? "0.0.0";
    ctx.body = buildOpenApiDocument(routeTable.listRoutes(), {
      title: "Zhin Host API",
      version: pkgVersion,
      apiBase: base,
      serverUrl,
    });
  });

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
    const apiUrl = `http://${visitAddress}${base}`;
    const apiBaseUrl = `http://${visitAddress}`;
    const openapiUrl = `${apiBaseUrl}/pub/openapi.json`;
    const consoleUrl = `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;

    logger.info(
      formatCompact({
        port: listenPort,
        api: apiUrl,
        openapi: openapiUrl,
        console: consoleUrl,
        token_prefix: token.slice(0, 6),
      }),
    );
  });
});

// 使用数据库服务（可选）
useContext("database", (database: DatabaseFeature) => {
  const configService = root.inject("config")!;
  const appConfig = configService.getPrimary<{ http?: HttpConfig }>();
  const base = appConfig.http?.base || "/api";
  registerLogsRoutes(routeTable, base, {
    getLogModel: () => database.models.get("SystemLog"),
  });
});

provide({
  name: "koa",
  description: "internal koa (console static fallback only)",
  value: internalKoa,
});

provide({
  name: "router",
  description: "fetch http router",
  value: router,
});
