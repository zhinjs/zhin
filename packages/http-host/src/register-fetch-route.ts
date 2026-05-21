import type { RouteHandler, RouteTable } from "./route-table.js";

/** Compat {@link Router} from `./compat-router.js` (duck-typed; avoids `ws` on Edge). */
export type RouteRegisterTarget = RouteTable | { table: RouteTable };

function resolveTable(target: RouteRegisterTarget): RouteTable {
  if (target && typeof target === "object" && "table" in target && target.table) {
    return target.table;
  }
  return target as RouteTable;
}

/**
 * Register a Fetch-native route on a {@link RouteTable} or {@link Router}.
 * Preferred over legacy compat shim methods for new plugins.
 */
export function registerFetchRoute(
  target: RouteRegisterTarget,
  method: string,
  path: string,
  handler: RouteHandler,
): void {
  const table = resolveTable(target);
  const m = method.toUpperCase();
  if (m === "GET") table.get(path, handler);
  else if (m === "POST") table.post(path, handler);
  else if (m === "PUT") table.put(path, handler);
  else if (m === "DELETE") table.delete(path, handler);
  else table.register(m, path, handler);
}
