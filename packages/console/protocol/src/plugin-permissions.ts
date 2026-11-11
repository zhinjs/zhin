/**
 * Plugin-declared Console permissions (ADR 0049, amendment 2026-11-11).
 *
 * Plugins gate their pages and Console RPC with their own strings (`onebot11:read`,
 * `ambient:read`, `ops:approve`). Each one has a level; roles grant plugin permissions by level
 * through the catalog permissions `plugin.perms.read|operate|manage`, or list them one by one.
 *
 * Dependency-free: `permissions.ts` imports this module, never the reverse.
 */

export type ConsolePluginPermissionLevel = 'read' | 'operate' | 'manage';

export const CONSOLE_PLUGIN_PERMISSION_LEVELS: readonly ConsolePluginPermissionLevel[] = Object.freeze(
  ['read', 'operate', 'manage'] as const,
);

/** Catalog permission that grants every plugin permission of one level (globally bound only). */
export const CONSOLE_PLUGIN_LEVEL_PERMISSIONS = Object.freeze({
  read: 'plugin.perms.read',
  operate: 'plugin.perms.operate',
  manage: 'plugin.perms.manage',
} as const satisfies Record<ConsolePluginPermissionLevel, string>);

/** What a plugin declares beside its pages / Console RPC (`definePluginConsoleRpc({ permissions })`). */
export interface ConsolePluginPermissionDeclaration {
  readonly id: string;
  readonly level: ConsolePluginPermissionLevel;
  readonly description?: string;
}

/** One entry of the runtime's plugin permission catalog, as `iam.roles.list` reports it. */
export interface ConsolePluginPermissionInfo extends ConsolePluginPermissionDeclaration {
  /** `true` when a plugin declared the level; `false` when it was inferred from the suffix. */
  readonly declared: boolean;
  /** Plugin ids (`root/<name>`) whose pages or RPC use the permission. */
  readonly owners: readonly string[];
}

/** How one role holds one plugin permission (`iam.roles.list` → `role.pluginPermissions`). */
export interface ConsoleRolePluginPermission {
  readonly id: string;
  readonly level: ConsolePluginPermissionLevel;
  /** `level`: through `plugin.perms.<level>`; `explicit`: listed on the role by id. */
  readonly source: 'level' | 'explicit';
  /** Whether a loaded plugin currently uses it (an unknown explicit id grants nothing until one does). */
  readonly known: boolean;
  readonly description?: string;
}

/** `<plugin>:<action>`: lower-case plugin segment, then the action (dots allowed, e.g. `ops:config.write`). */
export const CONSOLE_PLUGIN_PERMISSION_PATTERN = /^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_.-]{0,63}$/u;

export function isConsolePluginPermission(value: unknown): value is string {
  return typeof value === 'string' && CONSOLE_PLUGIN_PERMISSION_PATTERN.test(value);
}

const READ_ACTIONS: ReadonlySet<string> = new Set(['read', 'view']);
const MANAGE_ACTIONS: ReadonlySet<string> = new Set(['approve', 'manage', 'admin', 'write', 'config']);

/**
 * Level of an undeclared plugin permission, from its last action segment:
 * `read` / `view` → read; `approve` / `manage` / `admin` / `write` / `config` → manage; else operate.
 */
export function inferConsolePluginPermissionLevel(id: string): ConsolePluginPermissionLevel {
  const action = id.slice(id.indexOf(':') + 1);
  const last = action.slice(action.lastIndexOf('.') + 1);
  if (READ_ACTIONS.has(last)) return 'read';
  if (MANAGE_ACTIONS.has(last)) return 'manage';
  return 'operate';
}

export function isConsolePluginPermissionLevel(value: unknown): value is ConsolePluginPermissionLevel {
  return value === 'read' || value === 'operate' || value === 'manage';
}

/** Validates one declaration; throws a `TypeError` naming `label` on bad input. */
export function normalizeConsolePluginPermissionDeclaration(
  value: unknown,
  label = 'Plugin permission',
): ConsolePluginPermissionDeclaration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const { id, level, description, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) throw new TypeError(`${label} has unknown keys: ${Object.keys(rest).sort().join(', ')}`);
  if (!isConsolePluginPermission(id)) throw new TypeError(`${label} id must look like <plugin>:<action>`);
  if (!isConsolePluginPermissionLevel(level)) throw new TypeError(`${label} ${id} level must be read, operate or manage`);
  if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 256)) {
    throw new TypeError(`${label} ${id} description must be a non-empty string (≤ 256)`);
  }
  return Object.freeze({ id, level, ...(description === undefined ? {} : { description: description.trim() }) });
}

/** Resolves a level: declared first (via `levelOf`), else inferred. */
export type ConsolePluginPermissionLevelResolver = (id: string) => ConsolePluginPermissionLevel | undefined;

export function consolePluginPermissionLevel(
  id: string,
  levelOf?: ConsolePluginPermissionLevelResolver,
): ConsolePluginPermissionLevel {
  return levelOf?.(id) ?? inferConsolePluginPermissionLevel(id);
}

/**
 * Whether a permission list holds plugin permission `id`: listed by id, or through the
 * `plugin.perms.<level>` permission of its level. Non-plugin ids → `false`.
 */
export function permissionListHoldsPluginPermission(
  held: readonly string[],
  id: string,
  levelOf?: ConsolePluginPermissionLevelResolver,
): boolean {
  if (!isConsolePluginPermission(id)) return false;
  if (held.includes(id)) return true;
  return held.includes(CONSOLE_PLUGIN_LEVEL_PERMISSIONS[consolePluginPermissionLevel(id, levelOf)]);
}

/**
 * `held` plus every catalog plugin permission that `held` grants by level — the flat list that
 * page gating and plugin RPC compare against. Sorted, unique.
 */
export function expandPluginPermissions(
  held: readonly string[],
  catalog: Iterable<Pick<ConsolePluginPermissionInfo, 'id' | 'level'>>,
): readonly string[] {
  const out = new Set(held);
  for (const entry of catalog) {
    if (held.includes(CONSOLE_PLUGIN_LEVEL_PERMISSIONS[entry.level])) out.add(entry.id);
  }
  return Object.freeze([...out].sort());
}

/** Level resolver over a catalog (declared or inferred levels as the catalog recorded them). */
export function pluginPermissionLevelResolver(
  catalog: Iterable<Pick<ConsolePluginPermissionInfo, 'id' | 'level'>>,
): ConsolePluginPermissionLevelResolver {
  const levels = new Map<string, ConsolePluginPermissionLevel>();
  for (const entry of catalog) levels.set(entry.id, entry.level);
  return id => levels.get(id);
}

/**
 * Builds the catalog from what plugins use and declare. Conflicting declarations of one id keep
 * the strictest level (manage > operate > read) so a later plugin cannot lower another's gate.
 */
export function buildConsolePluginPermissionCatalog(
  uses: Iterable<Readonly<{ owner: string; permission: string }>>,
  declarations: Iterable<Readonly<{ owner: string; declaration: ConsolePluginPermissionDeclaration }>> = [],
): readonly ConsolePluginPermissionInfo[] {
  const rank: Record<ConsolePluginPermissionLevel, number> = { read: 0, operate: 1, manage: 2 };
  const entries = new Map<string, { level?: ConsolePluginPermissionLevel; description?: string; owners: Set<string> }>();
  const entry = (id: string) => {
    let found = entries.get(id);
    if (!found) entries.set(id, found = { owners: new Set() });
    return found;
  };
  for (const { owner, declaration } of declarations) {
    const found = entry(declaration.id);
    found.owners.add(owner);
    if (found.level === undefined || rank[declaration.level] > rank[found.level]) found.level = declaration.level;
    if (declaration.description && !found.description) found.description = declaration.description;
  }
  for (const { owner, permission } of uses) {
    if (!isConsolePluginPermission(permission)) continue;
    entry(permission).owners.add(owner);
  }
  return Object.freeze([...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, found]) => Object.freeze({
    id,
    level: found.level ?? inferConsolePluginPermissionLevel(id),
    declared: found.level !== undefined,
    ...(found.description ? { description: found.description } : {}),
    owners: Object.freeze([...found.owners].sort()),
  })));
}
