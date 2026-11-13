/**
 * Console access-control tables (ADR 0049 §2). Since ADR 0059 they live in the gateway's own store
 * `.zhin/gateway.db` (SQLite), whatever the project database is.
 */

export const IAM_TABLES = Object.freeze({
  users: 'console_users',
  roles: 'console_roles',
  bindings: 'console_role_bindings',
  sessions: 'console_sessions',
  tokens: 'console_api_tokens',
  audit: 'console_audit_log',
} as const);

const id = { type: 'text', length: 64, primary: true, nullable: false } as const;
const text = (nullable = false) => ({ type: 'text', nullable }) as const;
const time = (nullable = false) => ({ type: 'bigint', nullable }) as const;

export const IAM_TABLE_DEFINITIONS: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  [IAM_TABLES.users]: {
    id,
    username: { type: 'text', length: 64, unique: true, nullable: false },
    display_name: text(),
    password_hash: text(),
    disabled: { type: 'integer', nullable: false, default: 0 },
    password_changed_at: time(),
    created_at: time(),
    updated_at: time(),
  },
  [IAM_TABLES.roles]: {
    id,
    name: { type: 'text', length: 64, unique: true, nullable: false },
    description: text(),
    builtin: { type: 'integer', nullable: false, default: 0 },
    permissions: text(),
  },
  [IAM_TABLES.bindings]: {
    id,
    user_id: { type: 'text', length: 64, nullable: false },
    role_id: { type: 'text', length: 64, nullable: false },
    scope_kind: { type: 'text', length: 16, nullable: false },
    scope_key: text(true),
  },
  [IAM_TABLES.sessions]: {
    id,
    user_id: { type: 'text', length: 64, nullable: false },
    created_at: time(),
    expires_at: time(),
    last_seen_at: time(),
    ip: text(true),
    user_agent: text(true),
  },
  [IAM_TABLES.tokens]: {
    id,
    user_id: { type: 'text', length: 64, nullable: false },
    name: text(),
    token_hash: { type: 'text', length: 64, unique: true, nullable: false },
    permissions: text(true),
    expires_at: time(true),
    last_used_at: time(true),
    created_at: time(),
  },
  [IAM_TABLES.audit]: {
    id,
    at: time(),
    actor: text(),
    action: text(),
    target: text(true),
    outcome: { type: 'text', length: 16, nullable: false },
    detail: text(true),
    ip: text(true),
  },
});

export interface IamTableHost {
  readonly started: boolean;
  define(name: string, definition: Record<string, unknown>): void;
  tables(): readonly string[];
}

/** Idempotent; must run before the database starts. */
export function defineConsoleIamTables(host: IamTableHost): void {
  if (host.started) return;
  const existing = new Set(host.tables());
  for (const [name, definition] of Object.entries(IAM_TABLE_DEFINITIONS)) {
    if (!existing.has(name)) host.define(name, definition);
  }
}
