/** 与 @zhin.js/http 插件 `declareConfig("http")` 字段对齐 */
export const REMOTE_CONSOLE_ORIGIN = "https://console.zhin.dev";

export const DEFAULT_HTTP_CORS_ORIGINS = [
  REMOTE_CONSOLE_ORIGIN,
  "http://127.0.0.1:5173",
];

export type PlaygroundHttpConfig = {
  port: number;
  host: string;
  token: string;
  base: string;
  corsOrigins: string[];
  trustProxy: boolean;
};

export type PlaygroundEdgeConfig = {
  queueBotId: string;
  consoleParity: "host" | "edge";
};

export function resolveHttpConfig(appConfig: Record<string, unknown>): PlaygroundHttpConfig {
  const http = (appConfig.http ?? {}) as Record<string, unknown>;
  const cors = http.corsOrigins;
  return {
    port: Number(http.port ?? Deno.env.get("PORT") ?? 8000),
    host: String(http.host ?? Deno.env.get("HOSTNAME") ?? "0.0.0.0"),
    token: String(http.token ?? ""),
    base: String(http.base ?? "/api"),
    corsOrigins: Array.isArray(cors)
      ? [...new Set(cors.map(String))]
      : [...DEFAULT_HTTP_CORS_ORIGINS],
    trustProxy:
      Deno.env.get("HTTP_TRUST_PROXY") === "1" ||
      Deno.env.get("HTTP_TRUST_PROXY") === "true" ||
      Boolean(http.trustProxy),
  };
}

export function resolveEdgeConfig(appConfig: Record<string, unknown>): PlaygroundEdgeConfig {
  const edge = (appConfig.edge ?? {}) as Record<string, unknown>;
  const queue = (edge.queue ?? {}) as Record<string, unknown>;
  const parity = edge.consoleParity === "host" ? "host" : "edge";
  return {
    queueBotId: String(queue.botId ?? "playground-edge"),
    consoleParity: parity,
  };
}
