import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CONSOLE_BUILTIN_ROLE_NAMES,
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_PLUGIN_LEVEL_PERMISSIONS,
  consolePluginPermissionLevel,
  isConsolePermission,
  isConsolePluginPermission,
  parseConsoleBindingScope,
  permissionListHoldsPluginPermission,
  pluginPermissionLevelResolver,
  type ConsoleBindingScope,
  type ConsoleGrant,
  type ConsolePluginPermissionInfo,
  type ConsolePluginPermissionLevelResolver,
  type ConsoleRolePluginPermission,
} from '@zhin.js/console-protocol';
import type {
  ConsoleAccessProvider,
  ConsoleAuditEntry,
  ConsoleRequestMeta,
  ConsoleUserPrincipal,
} from '@zhin.js/host-http';
import type { DatabaseHostModel } from '@zhin.js/plugin-runtime';
import {
  generateToken,
  hashPassword,
  newId,
  passwordProblem,
  sha256,
  verifyAgainstDummy,
  verifyPassword,
} from './crypto.js';
import { isDatabaseBusyError } from '../database/project-database.js';
import { LoginRateLimiter } from './rate-limit.js';
import { IAM_TABLES } from './tables.js';

export type IamErrorCode =
  | 'invalid_input' | 'not_found' | 'conflict' | 'forbidden' | 'last_owner'
  | 'unauthorized' | 'rate_limited' | 'unavailable';

const STATUS: Readonly<Record<IamErrorCode, number>> = {
  invalid_input: 400, not_found: 404, conflict: 409, forbidden: 403, last_owner: 409,
  unauthorized: 401, rate_limited: 429, unavailable: 503,
};

export class IamError extends Error {
  readonly status: number;
  constructor(readonly code: IamErrorCode, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'IamError';
    this.status = STATUS[code];
  }
}

/** Minimal database surface: the process DatabaseHost, or one the CLI opens itself. */
export interface IamDatabase {
  readonly started: boolean;
  readonly models: { get(name: string): DatabaseHostModel | undefined };
}

export interface ConsoleUserView {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly disabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly passwordChangedAt: number;
  readonly bindings: readonly ConsoleBindingView[];
}

export interface ConsoleBindingView {
  readonly id: string;
  readonly roleId: string;
  readonly role: string;
  readonly scope: ConsoleBindingScope;
}

export interface ConsoleRoleView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly builtin: boolean;
  readonly permissions: readonly string[];
  /**
   * Plugin permissions this role holds right now: by level (`plugin.perms.<level>`, expanded
   * over the loaded plugins' catalog) or listed explicitly. Only on `listRoles` / role writes.
   */
  readonly pluginPermissions?: readonly ConsoleRolePluginPermission[];
}

export interface ConsoleTokenView {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly permissions: readonly string[] | null;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
  readonly createdAt: number;
}

export interface ConsoleAuditView {
  readonly id: string;
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly target: string | null;
  readonly outcome: string;
  readonly detail: unknown;
  readonly ip: string | null;
}

export interface BindingInput {
  readonly role: string;
  readonly scopeKind?: string;
  readonly scopeKey?: string | null;
}

export interface ConsoleIamServiceOptions {
  readonly database: IamDatabase;
  /** Marker telling a restarting Host that setup is done before the database is up. */
  readonly projectRoot?: string;
  readonly now?: () => number;
  readonly sessionIdleMs?: number;
  readonly sessionMaxMs?: number;
  readonly auditRetentionMs?: number;
  readonly rateLimiter?: LoginRateLimiter;
  readonly onError?: (error: unknown) => void;
  /**
   * Plugin permission catalog of the loaded plugins (ids and declared-or-inferred levels).
   * Without it, levels are inferred from the permission suffix.
   */
  readonly pluginPermissions?: () => readonly ConsolePluginPermissionInfo[];
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/u;
const ROLE_NAME = /^[a-z][a-z0-9_-]{1,63}$/u;
const DAY = 24 * 60 * 60_000;
const builtinRoleId = (name: string) => `builtin:${name}`;
const OWNER_ROLE_ID = builtinRoleId('owner');

/** Why a user's credentials were revoked (sessions always; API tokens on disable/delete). */
export type ConsoleCredentialRevocationReason = 'password' | 'disabled' | 'deleted' | 'bindings';

export interface ConsoleCredentialRevocation {
  readonly userId: string;
  readonly reason: ConsoleCredentialRevocationReason;
}

/** DB-backed users, roles, sessions, API tokens and audit (ADR 0049 §2, §5, §6). */
export class ConsoleIamService implements ConsoleAccessProvider {
  readonly #db: IamDatabase;
  readonly #marker: string | undefined;
  readonly #now: () => number;
  readonly #idle: number;
  readonly #max: number;
  readonly #retention: number;
  readonly #limiter: LoginRateLimiter;
  readonly #onError: (error: unknown) => void;
  readonly #pluginPermissions: () => readonly ConsolePluginPermissionInfo[];
  #ready = false;
  #initialized: boolean | undefined;
  #cleanupTimer: ReturnType<typeof setInterval> | undefined;
  #refreshTimer: ReturnType<typeof setInterval> | undefined;
  #mutation: Promise<unknown> = Promise.resolve();
  readonly #revocationListeners = new Set<(event: ConsoleCredentialRevocation) => void>();

  constructor(options: ConsoleIamServiceOptions) {
    this.#db = options.database;
    this.#marker = options.projectRoot ? join(options.projectRoot, '.zhin', 'console-iam.initialized') : undefined;
    this.#now = options.now ?? Date.now;
    this.#idle = options.sessionIdleMs ?? 12 * 60 * 60_000;
    this.#max = options.sessionMaxMs ?? 30 * DAY;
    this.#retention = options.auditRetentionMs ?? 180 * DAY;
    this.#limiter = options.rateLimiter ?? new LoginRateLimiter({ now: this.#now });
    this.#onError = options.onError ?? (() => undefined);
    this.#pluginPermissions = options.pluginPermissions ?? (() => []);
  }

  get ready(): boolean {
    return this.#ready;
  }

  /** Seeds built-in roles and loads the owner state; call after the database started. */
  async start(options: Readonly<{ timers?: boolean }> = {}): Promise<void> {
    const roles = this.#model('roles');
    for (const name of CONSOLE_BUILTIN_ROLE_NAMES) {
      const definition = CONSOLE_BUILTIN_ROLES[name];
      const row = { name, description: definition.description, builtin: 1, permissions: JSON.stringify(definition.permissions) };
      const [existing] = await roles.select('id').where({ id: builtinRoleId(name) });
      if (existing) await roles.update(row).where({ id: builtinRoleId(name) });
      else await roles.insert({ id: builtinRoleId(name), ...row });
    }
    this.#ready = true;
    await this.refreshOwnerState();
    if (options.timers !== false) {
      void this.cleanup().catch(this.#onError);
      this.#cleanupTimer = setInterval(() => void this.cleanup().catch(this.#onError), DAY);
      this.#cleanupTimer.unref?.();
      // Offline CLI edits (rescue) become visible without a restart.
      this.#refreshTimer = setInterval(() => void this.refreshOwnerState().catch(this.#onError), 30_000);
      this.#refreshTimer.unref?.();
    }
  }

  /**
   * Notified after a user's sessions were revoked or their grants changed, so long-lived
   * connections (terminal, SSE) authenticated earlier can be closed. Returns an unsubscriber.
   */
  onCredentialsRevoked(listener: (event: ConsoleCredentialRevocation) => void): () => void {
    this.#revocationListeners.add(listener);
    return () => { this.#revocationListeners.delete(listener); };
  }

  #emitRevocation(userId: string, reason: ConsoleCredentialRevocationReason): void {
    const event = Object.freeze({ userId, reason });
    for (const listener of [...this.#revocationListeners]) {
      try { listener(event); } catch (error) { this.#onError(error); }
    }
  }

  stop(): void {
    clearInterval(this.#cleanupTimer);
    clearInterval(this.#refreshTimer);
  }

  initialized(): boolean {
    if (this.#initialized === true) return true;
    // Database not up yet, or another process (`zhin console init` beside a running gateway)
    // completed setup since the last refresh: fail closed on the setup marker and re-read the
    // owner state now instead of keeping the Host open until the next periodic refresh.
    const marked = this.#marker !== undefined && existsSync(this.#marker);
    if (this.#initialized === undefined) return marked;
    if (marked && this.#ready) this.#refreshSoon();
    return marked;
  }

  #pendingRefresh: Promise<unknown> | undefined;
  #refreshSoon(): void {
    if (this.#pendingRefresh !== undefined) return;
    this.#pendingRefresh = this.refreshOwnerState()
      .catch(this.#onError)
      .finally(() => { this.#pendingRefresh = undefined; });
  }

  async refreshOwnerState(): Promise<boolean> {
    const owners = await this.#activeOwnerIds();
    this.#initialized = owners.size > 0;
    if (this.#marker) {
      try {
        if (this.#initialized) {
          mkdirSync(dirname(this.#marker), { recursive: true });
          writeFileSync(this.#marker, `${this.#now()}\n`);
        } else if (existsSync(this.#marker)) {
          rmSync(this.#marker, { force: true });
        }
      } catch (error) { this.#onError(error); }
    }
    return this.#initialized;
  }

  // ------------------------------------------------------------------ authentication

  async authenticate(token: string, meta: ConsoleRequestMeta = {}): Promise<ConsoleUserPrincipal | null> {
    if (!this.#ready || !token || token.length > 256) return null;
    const hash = sha256(token);
    const now = this.#now();
    const [session] = await this.#model('sessions').select('id', 'user_id', 'created_at', 'expires_at', 'last_seen_at').where({ id: hash });
    if (session) {
      if (Number(session.expires_at) <= now) {
        await this.#touch(() => this.#model('sessions').delete().where({ id: hash }));
        return null;
      }
      const user = await this.#enabledUser(String(session.user_id));
      if (!user) return null;
      if (now - Number(session.last_seen_at) > 60_000) {
        const expiresAt = Math.min(Number(session.created_at) + this.#max, now + this.#idle);
        await this.#touch(() => this.#model('sessions').update({ last_seen_at: now, expires_at: expiresAt }).where({ id: hash }));
      }
      return this.#principal(user, 'user', hash, null);
    }
    const [apiToken] = await this.#model('tokens').select('id', 'user_id', 'permissions', 'expires_at', 'last_used_at').where({ token_hash: hash });
    if (!apiToken) return null;
    if (apiToken.expires_at !== null && apiToken.expires_at !== undefined && Number(apiToken.expires_at) <= now) return null;
    const user = await this.#enabledUser(String(apiToken.user_id));
    if (!user) return null;
    if (apiToken.last_used_at === null || apiToken.last_used_at === undefined || now - Number(apiToken.last_used_at) > 60_000) {
      await this.#touch(() => this.#model('tokens').update({ last_used_at: now }).where({ id: apiToken.id }));
    }
    void meta;
    return this.#principal(user, 'api-token', String(apiToken.id), parseList(apiToken.permissions));
  }

  audit(entry: ConsoleAuditEntry): void {
    if (!this.#ready) return;
    void this.#model('audit').insert({
      id: newId(),
      at: this.#now(),
      actor: entry.actor.slice(0, 128),
      action: entry.action.slice(0, 256),
      target: entry.target?.slice(0, 256) ?? null,
      outcome: entry.outcome,
      detail: entry.detail ? JSON.stringify(entry.detail).slice(0, 4096) : null,
      ip: entry.ip?.slice(0, 64) ?? null,
    }).catch(this.#onError);
  }

  async login(usernameInput: unknown, password: unknown, meta: ConsoleRequestMeta = {}): Promise<{
    token: string; expiresAt: number; user: ConsoleUserView;
  }> {
    this.#requireReady();
    const username = typeof usernameInput === 'string' ? usernameInput.trim().toLowerCase() : '';
    const keys = [`ip:${meta.ip ?? 'unknown'}`, `user:${username}`];
    const wait = this.#limiter.retryAfter(keys);
    if (wait > 0) {
      this.audit({ actor: `login:${username.slice(0, 64)}`, action: 'auth.login', outcome: 'denied', detail: { reason: 'rate_limited' }, ...(meta.ip ? { ip: meta.ip } : {}) });
      throw new IamError('rate_limited', '登录尝试过多，请稍后再试', wait);
    }
    const secret = typeof password === 'string' ? password : '';
    const [row] = USERNAME.test(username) && secret
      ? await this.#model('users').select('id', 'password_hash', 'disabled').where({ username })
      : [];
    const ok = row && Number(row.disabled) !== 1
      ? await verifyPassword(secret, String(row.password_hash))
      : await verifyAgainstDummy(secret || 'x');
    if (!ok || !row) {
      this.#limiter.fail(keys);
      this.audit({ actor: row ? `user:${String(row.id)}` : `login:${username.slice(0, 64)}`, action: 'auth.login', outcome: 'denied', ...(meta.ip ? { ip: meta.ip } : {}) });
      throw new IamError('unauthorized', '用户名或密码错误');
    }
    this.#limiter.succeed([`user:${username}`]);
    const issued = await this.#issueSession(String(row.id), meta);
    this.audit({ actor: `user:${String(row.id)}`, action: 'auth.login', outcome: 'ok', ...(meta.ip ? { ip: meta.ip } : {}) });
    return { ...issued, user: (await this.getUser(String(row.id)))! };
  }

  async #issueSession(userId: string, meta: ConsoleRequestMeta): Promise<{ token: string; expiresAt: number }> {
    const token = generateToken();
    const now = this.#now();
    const expiresAt = Math.min(now + this.#idle, now + this.#max);
    await this.#model('sessions').insert({
      id: sha256(token), user_id: userId, created_at: now, expires_at: expiresAt, last_seen_at: now,
      ip: meta.ip?.slice(0, 64) ?? null, user_agent: meta.userAgent?.slice(0, 256) ?? null,
    });
    return { token, expiresAt };
  }

  async logout(principal: ConsoleUserPrincipal): Promise<void> {
    if (principal.kind === 'user') await this.#model('sessions').delete().where({ id: principal.credentialId });
    this.audit({ actor: actorOf(principal), action: 'auth.logout', outcome: 'ok' });
  }

  async changePassword(principal: ConsoleUserPrincipal, current: unknown, next: unknown, meta: ConsoleRequestMeta = {}): Promise<{ token?: string; expiresAt?: number }> {
    const [row] = await this.#model('users').select('password_hash').where({ id: principal.userId });
    const keys = [`ip:${meta.ip ?? 'unknown'}`, `user:${principal.username}`];
    if (this.#limiter.retryAfter(keys) > 0) throw new IamError('rate_limited', '尝试过多，请稍后再试', this.#limiter.retryAfter(keys));
    if (!row || typeof current !== 'string' || !await verifyPassword(current, String(row.password_hash))) {
      this.#limiter.fail(keys);
      this.audit({ actor: actorOf(principal), action: 'auth.password', outcome: 'denied' });
      throw new IamError('unauthorized', '当前密码错误');
    }
    await this.#setPassword(principal.userId, next);
    this.audit({ actor: actorOf(principal), action: 'auth.password', outcome: 'ok' });
    // Every session was revoked: hand the caller a fresh one when it used a session.
    return principal.kind === 'user' ? this.#issueSession(principal.userId, meta) : {};
  }

  // ------------------------------------------------------------------ users

  async listUsers(): Promise<readonly ConsoleUserView[]> {
    this.#requireReady();
    const rows = await this.#model('users').select('id', 'username', 'display_name', 'disabled', 'created_at', 'updated_at', 'password_changed_at').orderBy('username', 'ASC');
    const bindings = await this.#allBindings();
    return rows.map(row => userView(row, bindings.filter(binding => binding.userId === String(row.id))));
  }

  async getUser(id: string): Promise<ConsoleUserView | null> {
    const [row] = await this.#model('users').select('id', 'username', 'display_name', 'disabled', 'created_at', 'updated_at', 'password_changed_at').where({ id });
    if (!row) return null;
    const bindings = (await this.#allBindings()).filter(binding => binding.userId === id);
    return userView(row, bindings);
  }

  async findUser(username: string): Promise<ConsoleUserView | null> {
    const [row] = await this.#model('users').select('id').where({ username: username.trim().toLowerCase() });
    return row ? this.getUser(String(row.id)) : null;
  }

  createUser(input: Readonly<{ username: unknown; password: unknown; displayName?: unknown; bindings?: readonly BindingInput[] }>): Promise<ConsoleUserView> {
    return this.#serialize(() => this.#createUser(input));
  }

  async #createUser(input: Readonly<{ username: unknown; password: unknown; displayName?: unknown; bindings?: readonly BindingInput[] }>): Promise<ConsoleUserView> {
    {
      this.#requireReady();
      const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
      if (!USERNAME.test(username)) throw new IamError('invalid_input', '用户名需为 2-64 位小写字母、数字或 . _ -');
      const problem = passwordProblem(input.password);
      if (problem) throw new IamError('invalid_input', problem);
      const displayName = typeof input.displayName === 'string' && input.displayName.trim() ? input.displayName.trim().slice(0, 128) : username;
      const [existing] = await this.#model('users').select('id').where({ username });
      if (existing) throw new IamError('conflict', '用户名已存在');
      const bindings = await this.#resolveBindings(input.bindings ?? []);
      const now = this.#now();
      const id = newId();
      await this.#model('users').insert({
        id, username, display_name: displayName, password_hash: await hashPassword(input.password as string),
        disabled: 0, password_changed_at: now, created_at: now, updated_at: now,
      });
      for (const binding of bindings) await this.#model('bindings').insert({ id: newId(), user_id: id, ...binding });
      await this.refreshOwnerState();
      return (await this.getUser(id))!;
    }
  }

  /** First owner (setup). Conflict once an enabled global owner exists. */
  createOwner(input: Readonly<{ username: unknown; password: unknown; displayName?: unknown }>): Promise<ConsoleUserView> {
    return this.#serialize(async () => {
      this.#requireReady();
      if ((await this.#activeOwnerIds()).size > 0) throw new IamError('conflict', '已初始化：所有者已存在');
      return this.#createUser({ ...input, bindings: [{ role: 'owner', scopeKind: 'global' }] });
    });
  }

  /** Issues a session for a user (setup returns one for the new owner). */
  issueSession(userId: string, meta: ConsoleRequestMeta = {}): Promise<{ token: string; expiresAt: number }> {
    this.#requireReady();
    return this.#issueSession(userId, meta);
  }

  updateUser(id: string, patch: Readonly<{ displayName?: unknown; disabled?: unknown }>): Promise<ConsoleUserView> {
    return this.#serialize(async () => {
      const user = await this.#requireUser(id);
      const row: Record<string, unknown> = { updated_at: this.#now() };
      if (patch.displayName !== undefined) {
        if (typeof patch.displayName !== 'string' || !patch.displayName.trim()) throw new IamError('invalid_input', 'displayName 无效');
        row.display_name = patch.displayName.trim().slice(0, 128);
      }
      if (patch.disabled !== undefined) {
        if (typeof patch.disabled !== 'boolean') throw new IamError('invalid_input', 'disabled 必须是布尔值');
        if (patch.disabled && !user.disabled) await this.#assertOwnersRemain({ disable: id });
        row.disabled = patch.disabled ? 1 : 0;
      }
      await this.#model('users').update(row).where({ id });
      if (patch.disabled === true) await this.#revokeCredentials(id, true, 'disabled');
      await this.refreshOwnerState();
      return (await this.getUser(id))!;
    });
  }

  setDisabled(id: string, disabled: boolean): Promise<ConsoleUserView> {
    return this.updateUser(id, { disabled });
  }

  deleteUser(id: string): Promise<void> {
    return this.#serialize(async () => {
      await this.#requireUser(id);
      await this.#assertOwnersRemain({ disable: id });
      await this.#revokeCredentials(id, true, 'deleted');
      await this.#model('bindings').delete().where({ user_id: id });
      await this.#model('users').delete().where({ id });
      await this.refreshOwnerState();
    });
  }

  resetPassword(id: string, password: unknown): Promise<void> {
    return this.#serialize(async () => {
      await this.#requireUser(id);
      await this.#setPassword(id, password);
    });
  }

  async #setPassword(id: string, password: unknown): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new IamError('invalid_input', problem);
    const now = this.#now();
    await this.#model('users').update({ password_hash: await hashPassword(password as string), password_changed_at: now, updated_at: now }).where({ id });
    await this.#revokeCredentials(id, false, 'password');
  }

  /** Sessions always; API tokens too when the user is disabled or deleted (ADR 0049 §2). */
  async #revokeCredentials(userId: string, tokens: boolean, reason: ConsoleCredentialRevocationReason): Promise<void> {
    await this.#model('sessions').delete().where({ user_id: userId });
    if (tokens) await this.#model('tokens').delete().where({ user_id: userId });
    this.#emitRevocation(userId, reason);
  }

  // ------------------------------------------------------------------ roles & bindings

  async listRoles(): Promise<readonly ConsoleRoleView[]> {
    const catalog = this.pluginPermissionCatalog();
    return (await this.#rawRoles()).map(role => withPluginPermissions(role, catalog));
  }

  /** The loaded plugins' permission catalog (what the Console's role editor offers). */
  pluginPermissionCatalog(): readonly ConsolePluginPermissionInfo[] {
    try {
      return this.#pluginPermissions();
    } catch (error) {
      this.#onError(error);
      return [];
    }
  }

  /**
   * Plugin permission ids in `permissions` that no loaded plugin uses (accepted, but they grant
   * nothing until a plugin uses them); for the warnings of role and token writes.
   */
  unknownPluginPermissions(permissions: readonly string[]): readonly string[] {
    const known = new Set(this.pluginPermissionCatalog().map(entry => entry.id));
    return Object.freeze(permissions.filter(permission => isConsolePluginPermission(permission) && !known.has(permission)));
  }

  async #rawRoles(): Promise<readonly ConsoleRoleView[]> {
    this.#requireReady();
    const rows = await this.#model('roles').select('id', 'name', 'description', 'builtin', 'permissions').orderBy('name', 'ASC');
    return rows.map(roleView);
  }

  createRole(input: Readonly<{ name: unknown; description?: unknown; permissions: unknown }>): Promise<ConsoleRoleView> {
    return this.#serialize(async () => {
      this.#requireReady();
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!ROLE_NAME.test(name)) throw new IamError('invalid_input', '角色名需为 2-64 位小写字母、数字、_ 或 -');
      const [existing] = await this.#model('roles').select('id').where({ name });
      if (existing) throw new IamError('conflict', '角色名已存在');
      const id = newId();
      await this.#model('roles').insert({ id, name, description: descriptionOf(input.description), builtin: 0, permissions: JSON.stringify(permissionList(input.permissions)) });
      return withPluginPermissions((await this.#role(id))!, this.pluginPermissionCatalog());
    });
  }

  updateRole(id: string, patch: Readonly<{ description?: unknown; permissions?: unknown }>): Promise<ConsoleRoleView> {
    return this.#serialize(async () => {
      const role = await this.#role(id);
      if (!role) throw new IamError('not_found', '角色不存在');
      if (role.builtin) throw new IamError('forbidden', '内置角色不可修改，请复制后再改');
      const row: Record<string, unknown> = {};
      if (patch.description !== undefined) row.description = descriptionOf(patch.description);
      if (patch.permissions !== undefined) row.permissions = JSON.stringify(permissionList(patch.permissions));
      if (Object.keys(row).length) await this.#model('roles').update(row).where({ id });
      return withPluginPermissions((await this.#role(id))!, this.pluginPermissionCatalog());
    });
  }

  deleteRole(id: string): Promise<void> {
    return this.#serialize(async () => {
      const role = await this.#role(id);
      if (!role) throw new IamError('not_found', '角色不存在');
      if (role.builtin) throw new IamError('forbidden', '内置角色不可删除');
      await this.#model('bindings').delete().where({ role_id: id });
      await this.#model('roles').delete().where({ id });
    });
  }

  /** Replaces all bindings of a user. */
  setBindings(userId: string, inputs: readonly BindingInput[]): Promise<ConsoleUserView> {
    return this.#serialize(async () => {
      await this.#requireUser(userId);
      if (!Array.isArray(inputs) || inputs.length > 64) throw new IamError('invalid_input', 'bindings 必须是数组');
      const bindings = await this.#resolveBindings(inputs);
      const keepsOwner = bindings.some(binding => binding.role_id === OWNER_ROLE_ID && binding.scope_kind === 'global');
      if (!keepsOwner) await this.#assertOwnersRemain({ disable: userId });
      await this.#model('bindings').delete().where({ user_id: userId });
      for (const binding of bindings) await this.#model('bindings').insert({ id: newId(), user_id: userId, ...binding });
      await this.refreshOwnerState();
      // Grants may have shrunk: long-lived connections re-authorize from scratch.
      this.#emitRevocation(userId, 'bindings');
      return (await this.getUser(userId))!;
    });
  }

  async #resolveBindings(inputs: readonly BindingInput[]): Promise<Array<{ role_id: string; scope_kind: string; scope_key: string | null }>> {
    const roles = await this.#rawRoles();
    const result: Array<{ role_id: string; scope_kind: string; scope_key: string | null }> = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      if (!input || typeof input !== 'object') throw new IamError('invalid_input', 'binding 无效');
      const role = roles.find(candidate => candidate.id === input.role || candidate.name === input.role);
      if (!role) throw new IamError('invalid_input', `角色不存在：${String(input.role)}`);
      const scope = parseConsoleBindingScope(input.scopeKind ?? 'global', input.scopeKey ?? null);
      if (!scope) throw new IamError('invalid_input', '作用域无效（global / adapter:<别名> / endpoint:<别名>/<id>）');
      const key = `${role.id}|${scope.kind}|${scope.kind === 'global' ? '' : scope.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ role_id: role.id, scope_kind: scope.kind, scope_key: scope.kind === 'global' ? null : scope.key });
    }
    return result;
  }

  /** After setup there must always be ≥1 enabled user with a global owner binding (ADR 0049 §5). */
  async #assertOwnersRemain(change: Readonly<{ disable: string }>): Promise<void> {
    const owners = await this.#activeOwnerIds();
    if (owners.size === 0) return;
    owners.delete(change.disable);
    if (owners.size === 0) throw new IamError('last_owner', '不能移除最后一个所有者');
  }

  async #activeOwnerIds(): Promise<Set<string>> {
    if (!this.#ready) return new Set();
    const bindings = await this.#model('bindings').select('user_id').where({ role_id: OWNER_ROLE_ID, scope_kind: 'global' });
    const ids = new Set<string>();
    for (const binding of bindings) {
      const id = String(binding.user_id);
      if (await this.#enabledUser(id)) ids.add(id);
    }
    return ids;
  }

  // ------------------------------------------------------------------ API tokens

  async listTokens(userId?: string): Promise<readonly ConsoleTokenView[]> {
    this.#requireReady();
    const select = this.#model('tokens').select('id', 'user_id', 'name', 'permissions', 'expires_at', 'last_used_at', 'created_at');
    const rows = await (userId ? select.where({ user_id: userId }) : select).orderBy('created_at', 'DESC');
    return rows.map(tokenView);
  }

  /** Returns the plaintext once; only its SHA-256 is stored. */
  async createToken(userId: string, input: Readonly<{ name: unknown; permissions?: unknown; expiresAt?: unknown }>): Promise<{ token: string; record: ConsoleTokenView }> {
    await this.#requireUser(userId);
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 128) : '';
    if (!name) throw new IamError('invalid_input', 'name 必填');
    const permissions = input.permissions === undefined || input.permissions === null ? null : permissionList(input.permissions);
    let expiresAt: number | null = null;
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      if (typeof input.expiresAt !== 'number' || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= this.#now()) {
        throw new IamError('invalid_input', 'expiresAt 必须是将来的毫秒时间戳');
      }
      expiresAt = input.expiresAt;
    }
    const token = generateToken();
    const id = newId();
    await this.#model('tokens').insert({
      id, user_id: userId, name, token_hash: sha256(token), permissions: permissions ? JSON.stringify(permissions) : null,
      expires_at: expiresAt, last_used_at: null, created_at: this.#now(),
    });
    const [row] = await this.#model('tokens').select('id', 'user_id', 'name', 'permissions', 'expires_at', 'last_used_at', 'created_at').where({ id });
    return { token, record: tokenView(row!) };
  }

  /** `ownerUserId` restricts the revoke to that user's own tokens (self-service). */
  async revokeToken(id: string, ownerUserId?: string): Promise<void> {
    const [row] = await this.#model('tokens').select('id', 'user_id').where({ id: String(id) });
    if (!row || (ownerUserId !== undefined && String(row.user_id) !== ownerUserId)) throw new IamError('not_found', '令牌不存在');
    await this.#model('tokens').delete().where({ id: String(id) });
  }

  // ------------------------------------------------------------------ audit

  async listAudit(filter: Readonly<{ actor?: unknown; action?: unknown; since?: unknown; until?: unknown; limit?: unknown; before?: unknown }> = {}): Promise<{ entries: readonly ConsoleAuditView[]; next: number | null }> {
    this.#requireReady();
    const where: Record<string, unknown> = {};
    if (typeof filter.actor === 'string' && filter.actor) where.actor = filter.actor;
    if (typeof filter.action === 'string' && filter.action) where.action = filter.action;
    const range: Record<string, number> = {};
    if (typeof filter.since === 'number') range.$gte = filter.since;
    const upper = [filter.until, filter.before].filter((value): value is number => typeof value === 'number');
    if (upper.length) range.$lt = Math.min(...upper);
    if (Object.keys(range).length) where.at = range;
    const limit = typeof filter.limit === 'number' && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const select = this.#model('audit').select('id', 'at', 'actor', 'action', 'target', 'outcome', 'detail', 'ip');
    const rows = await (Object.keys(where).length ? select.where(where) : select).orderBy('at', 'DESC').limit(limit + 1);
    const entries = rows.slice(0, limit).map(auditView);
    return { entries, next: rows.length > limit ? entries[entries.length - 1]!.at : null };
  }

  /** Daily: audit older than the retention window and expired sessions. */
  async cleanup(): Promise<void> {
    if (!this.#ready) return;
    const now = this.#now();
    await this.#model('audit').delete().where({ at: { $lt: now - this.#retention } });
    await this.#model('sessions').delete().where({ expires_at: { $lt: now } });
  }

  // ------------------------------------------------------------------ helpers

  #model(key: keyof typeof IAM_TABLES): DatabaseHostModel {
    const model = this.#db.models.get(IAM_TABLES[key]);
    if (!model) throw new IamError('unavailable', '访问控制数据表不可用');
    return model;
  }

  #requireReady(): void {
    if (!this.#ready) throw new IamError('unavailable', '数据库尚未就绪');
  }

  async #requireUser(id: string): Promise<ConsoleUserView> {
    this.#requireReady();
    const user = typeof id === 'string' && id ? await this.getUser(id) : null;
    if (!user) throw new IamError('not_found', '用户不存在');
    return user;
  }

  async #enabledUser(id: string): Promise<Record<string, unknown> | undefined> {
    const [row] = await this.#model('users').select('id', 'username', 'display_name', 'disabled').where({ id });
    return row && Number(row.disabled) !== 1 ? row : undefined;
  }

  async #role(id: string): Promise<ConsoleRoleView | null> {
    const [row] = await this.#model('roles').select('id', 'name', 'description', 'builtin', 'permissions').where({ id });
    return row ? roleView(row) : null;
  }

  async #allBindings(): Promise<Array<ConsoleBindingView & { userId: string }>> {
    const roles = new Map((await this.#rawRoles()).map(role => [role.id, role]));
    const rows = await this.#model('bindings').select('id', 'user_id', 'role_id', 'scope_kind', 'scope_key');
    return rows.flatMap(row => {
      const scope = parseConsoleBindingScope(row.scope_kind, row.scope_key ?? null);
      const role = roles.get(String(row.role_id));
      return scope && role ? [{ id: String(row.id), userId: String(row.user_id), roleId: role.id, role: role.name, scope }] : [];
    });
  }

  async #principal(user: Record<string, unknown>, kind: 'user' | 'api-token', credentialId: string, narrow: readonly string[] | null): Promise<ConsoleUserPrincipal> {
    const roles = new Map((await this.#rawRoles()).map(role => [role.id, role]));
    const levelOf = narrow?.some(isConsolePluginPermission) ? pluginPermissionLevelResolver(this.pluginPermissionCatalog()) : undefined;
    const rows = await this.#model('bindings').select('role_id', 'scope_kind', 'scope_key').where({ user_id: user.id });
    const grants: ConsoleGrant[] = [];
    const names = new Set<string>();
    for (const row of rows) {
      const role = roles.get(String(row.role_id));
      const scope = parseConsoleBindingScope(row.scope_kind, row.scope_key ?? null);
      if (!role || !scope) continue;
      names.add(role.name);
      // API tokens never exceed the issuing user: intersect at every request.
      const permissions = narrow ? narrowPermissions(role.permissions, narrow, levelOf) : role.permissions;
      grants.push(Object.freeze({ role: role.name, scope, permissions: Object.freeze([...permissions]) }));
    }
    return Object.freeze({
      kind,
      userId: String(user.id),
      username: String(user.username),
      displayName: String(user.display_name),
      credentialId,
      grants: Object.freeze(grants),
      roles: Object.freeze([...names].sort()),
    });
  }

  /**
   * Bookkeeping writes of authentication (sliding expiry, last use, expired-row cleanup): a
   * database that stays locked past the retry budget must not turn a valid credential into a 401.
   */
  async #touch(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!isDatabaseBusyError(error)) throw error;
      this.#onError(error);
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#mutation.then(operation, operation);
    this.#mutation = run.catch(() => undefined);
    return run;
  }
}

function actorOf(principal: ConsoleUserPrincipal): string {
  return principal.kind === 'user' ? `user:${principal.userId}` : `api-token:${principal.credentialId}`;
}

function parseList(value: unknown): readonly string[] | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Role permissions ∩ the token's list. A plugin permission the token lists by id survives when
 * the role holds it by id or through its level (`levelOf`: declared levels, else inferred).
 */
function narrowPermissions(
  rolePermissions: readonly string[],
  narrow: readonly string[],
  levelOf: ConsolePluginPermissionLevelResolver | undefined,
): readonly string[] {
  const out = new Set(rolePermissions.filter(permission => narrow.includes(permission)));
  for (const permission of narrow) {
    if (permissionListHoldsPluginPermission(rolePermissions, permission, levelOf)) out.add(permission);
  }
  return [...out];
}

/** Effective plugin permissions of a role over the loaded catalog (explicit ids first-class). */
function withPluginPermissions(role: ConsoleRoleView, catalog: readonly ConsolePluginPermissionInfo[]): ConsoleRoleView {
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  const levelOf = pluginPermissionLevelResolver(catalog);
  const out = new Map<string, ConsoleRolePluginPermission>();
  for (const permission of role.permissions) {
    if (!isConsolePluginPermission(permission)) continue;
    const entry = byId.get(permission);
    out.set(permission, Object.freeze({
      id: permission,
      level: consolePluginPermissionLevel(permission, levelOf),
      source: 'explicit' as const,
      known: entry !== undefined,
      ...(entry?.description ? { description: entry.description } : {}),
    }));
  }
  for (const entry of catalog) {
    if (out.has(entry.id) || !role.permissions.includes(CONSOLE_PLUGIN_LEVEL_PERMISSIONS[entry.level])) continue;
    out.set(entry.id, Object.freeze({
      id: entry.id, level: entry.level, source: 'level' as const, known: true,
      ...(entry.description ? { description: entry.description } : {}),
    }));
  }
  const pluginPermissions = Object.freeze([...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return Object.freeze({ ...role, pluginPermissions });
}

/**
 * Catalog permissions plus plugin permissions (`<plugin>:<action>`). A plugin id need not be
 * loaded right now (plugins are installed, disabled and hot-reloaded independently of roles);
 * callers report unloaded ones as warnings. It grants nothing until a plugin uses it.
 */
function permissionList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new IamError('invalid_input', 'permissions 必须是数组');
  if (value.length > 512) throw new IamError('invalid_input', 'permissions 过多');
  const unknown = value.filter(item => !isConsolePermission(item) && !isConsolePluginPermission(item));
  if (unknown.length) throw new IamError('invalid_input', `未知权限：${unknown.map(String).join(', ').slice(0, 200)}`);
  return Object.freeze([...new Set(value as string[])].sort());
}

function descriptionOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 512) : '';
}

function userView(row: Record<string, unknown>, bindings: readonly ConsoleBindingView[]): ConsoleUserView {
  return Object.freeze({
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    disabled: Number(row.disabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    passwordChangedAt: Number(row.password_changed_at),
    bindings: Object.freeze(bindings.map(({ id, roleId, role, scope }) => Object.freeze({ id, roleId, role, scope }))),
  });
}

function roleView(row: Record<string, unknown>): ConsoleRoleView {
  return Object.freeze({
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    builtin: Number(row.builtin) === 1,
    permissions: Object.freeze([...(parseList(row.permissions) ?? [])]),
  });
}

function tokenView(row: Record<string, unknown>): ConsoleTokenView {
  const optional = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return Object.freeze({
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    permissions: parseList(row.permissions),
    expiresAt: optional(row.expires_at),
    lastUsedAt: optional(row.last_used_at),
    createdAt: Number(row.created_at),
  });
}

function auditView(row: Record<string, unknown>): ConsoleAuditView {
  let detail: unknown = null;
  if (typeof row.detail === 'string') {
    try { detail = JSON.parse(row.detail); } catch { detail = null; }
  }
  return Object.freeze({
    id: String(row.id),
    at: Number(row.at),
    actor: String(row.actor),
    action: String(row.action),
    target: row.target === null || row.target === undefined ? null : String(row.target),
    outcome: String(row.outcome),
    detail,
    ip: row.ip === null || row.ip === undefined ? null : String(row.ip),
  });
}
