import { REMOTE_CONSOLE_ORIGIN } from "./runtime/http-config.ts";

export type EdgeListenLogOptions = {
  host: string;
  port: number;
  base?: string;
  token?: string;
};

export function logEdgeHttpListen(options: EdgeListenLogOptions): void {
  const base = options.base ?? "/api";
  const token = options.token ?? "";
  const publicHost =
    options.host === "0.0.0.0" || options.host === "::" ? "127.0.0.1" : options.host;
  const visitAddress = `${publicHost}:${options.port}`;
  const apiUrl = `http://${visitAddress}${base}`;
  const apiBaseUrl = `http://${visitAddress}`;
  const openapiUrl = `${apiBaseUrl}/pub/openapi.json`;
  const consoleUrl = `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;

  const parts = [
    `port=${options.port}`,
    `api=${apiUrl}`,
    `openapi=${openapiUrl}`,
    `console=${consoleUrl}`,
  ];
  if (token) parts.push(`token_prefix=${token.slice(0, 6)}`);
  console.log(`[Zhin:edge] ${parts.join(" ")}`);
}
