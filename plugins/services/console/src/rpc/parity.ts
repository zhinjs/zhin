export type ConsoleParity = "host" | "edge";

const EDGE_EXACT = new Set([
  "ping",
  "entries:get",
  "bot:list",
  "bot:info",
  "bot:sendMessage",
]);

const EDGE_PREFIXES = ["config:", "schema:", "env:", "cron:", "files:", "db:"];

/**
 * Returns an error message if the RPC type is not allowed on Edge, else null.
 */
export function assertConsoleRpcAllowed(type: string, parity: ConsoleParity): string | null {
  if (parity === "host") return null;
  if (!type || typeof type !== "string") return "Invalid message type";
  if (EDGE_EXACT.has(type)) return null;
  if (EDGE_PREFIXES.some((p) => type.startsWith(p))) return null;
  return `Not available on Zhin Edge: ${type}`;
}

export function edgeUnsupportedBody(type: string, requestId?: number) {
  return {
    success: false as const,
    error: assertConsoleRpcAllowed(type, "edge") ?? `Not available on Zhin Edge: ${type}`,
    code: "EDGE_UNSUPPORTED" as const,
    requestId,
  };
}
