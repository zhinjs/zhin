import {
  assertInstanceTable,
  GATEWAY_TABLE_PREFIX,
  GatewayOwnedTableError,
  INSTANCE_CONSOLE_TABLES,
  isGatewayOwnedTable,
  referencesGatewayOwnedTable,
} from '../src/index.js';

describe('gateway-owned tables (ADR 0054 §7)', () => {
  it('denies the console_ prefix case-insensitively, quoted or schema-qualified', () => {
    expect(GATEWAY_TABLE_PREFIX).toBe('console_');
    for (const name of ['console_users', 'CONSOLE_SESSIONS', '"console_api_tokens"', '`console_audit_log`', 'main.console_roles', '[console_x]']) {
      expect(isGatewayOwnedTable(name)).toBe(true);
    }
    for (const name of ['users', 'my_console_users', 'consoleusers', ...INSTANCE_CONSOLE_TABLES]) {
      expect(isGatewayOwnedTable(name)).toBe(false);
    }
    expect(() => assertInstanceTable('console_users')).toThrow(GatewayOwnedTableError);
    expect(() => assertInstanceTable('console_conversations')).not.toThrow();
  });

  it('detects gateway tables anywhere in SQL text', () => {
    for (const sql of [
      'SELECT * FROM console_users',
      'select password_hash from "console_users"',
      'SELECT 1; DROP TABLE `console_sessions`',
      'SELECT * FROM main.CONSOLE_API_TOKENS',
      'SELECT a.x FROM t a JOIN console_audit_log b ON 1',
    ]) expect(referencesGatewayOwnedTable(sql)).toBe(true);
    for (const sql of [
      'SELECT * FROM messages',
      'SELECT id FROM console_conversations WHERE owner_id = ?',
      'SELECT is_console_flag FROM t',
    ]) expect(referencesGatewayOwnedTable(sql)).toBe(false);
  });
});
