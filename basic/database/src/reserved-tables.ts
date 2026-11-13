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

/**
 * Spellings of the SQL text with escape sequences decoded: PostgreSQL `U&"\\0063…"` /
 * `U&'\\+000063…'` and `E'\\x63…'` / octal / `\\u`, MySQL backslash escapes inside strings
 * (`'con\\sole_users'`) and doubled quotes inside quoted names (`"console_""x"`).
 */
function decodedSpellings(sql: string): string[] {
  const hex = (code: string) => {
    const value = Number.parseInt(code, 16);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  };
  // U& names and strings: \XXXX and \+XXXXXX.
  const unicode = sql
    .replace(/\\\+([0-9a-f]{6})/gi, (_, code: string) => hex(code))
    .replace(/\\([0-9a-f]{4})/gi, (_, code: string) => hex(code));
  // E'' strings: \xHH, \ooo, \uXXXX, \UXXXXXXXX.
  const escaped = sql
    .replace(/\\U([0-9a-f]{8})/g, (_, code: string) => hex(code))
    .replace(/\\u([0-9a-f]{4})/g, (_, code: string) => hex(code))
    .replace(/\\x([0-9a-f]{1,2})/gi, (_, code: string) => hex(code))
    .replace(/\\([0-7]{1,3})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 8) & 0xff));
  const spellings = [sql, unicode, escaped].flatMap(text => [text, text.replace(/\\(.)/g, '$1')]);
  return spellings.flatMap(text => [text, text.replace(/""|``/g, '')]);
}

/**
 * True when SQL text mentions a gateway-owned table anywhere (identifiers, quoted or literal),
 * also when the name is spelled with escapes (`U&"\\0063onsole_users"`, `E'\\x63onsole_users'`).
 * A custom `UESCAPE` character cannot be decoded reliably, so it counts as a reference.
 */
export function referencesGatewayOwnedTable(sql: string): boolean {
  const text = String(sql);
  if (/\bu&\s*['"]/i.test(text) && /\buescape\b/i.test(text)) return true;
  for (const spelling of decodedSpellings(text)) {
    for (const match of spelling.matchAll(IDENTIFIER)) {
      if (isGatewayOwnedTable(match[0])) return true;
    }
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
