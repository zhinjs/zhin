/**
 * Tables owned by the management gateway (ADR 0049 / 0054 §7). The gateway and the instance share
 * one project database; the gateway's tables hold password hashes, session / token hashes and the
 * audit log, so every instance-side path (plugin models, Console database page, raw SQL) must deny
 * them. Deny by prefix so future gateway tables are covered without another list to update.
 */
export const GATEWAY_TABLE_PREFIX = 'console_';

/** `console_`-prefixed tables that the instance itself owns (historical names). */
export const INSTANCE_CONSOLE_TABLES: readonly string[] = Object.freeze(['console_conversations']);

const instanceConsoleTables = new Set(INSTANCE_CONSOLE_TABLES);

/** True when `name` is a gateway-owned table (case-insensitive, quotes and schema ignored). */
export function isGatewayOwnedTable(name: string): boolean {
  const bare = String(name).trim().replace(/^[`"[]|[`"\]]$/g, '');
  const table = (bare.includes('.') ? bare.slice(bare.lastIndexOf('.') + 1) : bare)
    .replace(/^[`"[]|[`"\]]$/g, '').toLowerCase();
  return table.startsWith(GATEWAY_TABLE_PREFIX) && !instanceConsoleTables.has(table);
}

const IDENTIFIER = /(?<![A-Za-z0-9_$])console_[A-Za-z0-9_$]*/gi;

/** True when SQL text mentions a gateway-owned table anywhere (identifiers, quoted or literal). */
export function referencesGatewayOwnedTable(sql: string): boolean {
  for (const match of String(sql).matchAll(IDENTIFIER)) {
    if (isGatewayOwnedTable(match[0])) return true;
  }
  return false;
}

export class GatewayOwnedTableError extends Error {
  constructor(table?: string) {
    super(table
      ? `Table '${table}' is owned by the management gateway and is not accessible from the instance`
      : 'Statement references a table owned by the management gateway');
    this.name = 'GatewayOwnedTableError';
  }
}

/** Throws {@link GatewayOwnedTableError} for a gateway-owned table name. */
export function assertInstanceTable(name: string): void {
  if (isGatewayOwnedTable(name)) throw new GatewayOwnedTableError(name);
}
