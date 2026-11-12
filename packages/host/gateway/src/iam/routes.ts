import { CONSOLE_AUTH_ROUTES } from '@zhin.js/console-protocol';
import {
  HttpBodyError,
  globalPermissions,
  isUserPrincipal,
  jsonResponse,
  readJsonBody,
  requestMeta,
  type ConsolePrincipal,
  type ConsoleRequestMeta,
  type HttpHost,
  type TokenRegistry,
} from '@zhin.js/host-http';
import { CONSOLE_PERMISSIONS } from '@zhin.js/console-protocol';
import { DATABASE_BUSY_RETRY_AFTER_SECONDS, isDatabaseBusyError } from '../database/project-database.js';
import { IamError, type ConsoleIamService } from './service.js';
import type { ConsoleSetupService } from './setup-service.js';

/** What `/auth/*` needs from a Host: the gateway's HTTP server or an in-process `HttpHost`. */
export interface ConsoleAuthRouteHost {
  route: HttpHost['route'];
  readonly tokenRegistry: TokenRegistry;
}

export interface RegisterConsoleAuthRoutesOptions {
  readonly http: ConsoleAuthRouteHost;
  readonly base: string;
  readonly iam: () => ConsoleIamService | undefined;
  readonly setup: ConsoleSetupService;
  /** Restarts the process after the database changed (injected; never exits directly). */
  readonly requestRestart?: () => void;
  /**
   * Onboarding state (ADR 0053 §4): added to `GET /auth/setup`, and to `/auth/me` for callers
   * holding `plugin.manage`.
   */
  readonly onboarding?: () => Promise<unknown>;
}

type Handler = (input: Readonly<{
  request: Request;
  /** Audit / session metadata (peer address, user agent). */
  meta: ConsoleRequestMeta;
  principal: ConsolePrincipal | undefined;
  body: () => Promise<Record<string, unknown>>;
}>) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;

const BODY_LIMIT = 16 * 1024;

/** `/auth/*` (ADR 0049 §5, §7). The HTTP Host has already authenticated the caller. */
export function registerConsoleAuthRoutes(options: RegisterConsoleAuthRoutesOptions): Array<() => void> {
  const { http, base } = options;
  const route = (method: string, path: string, handler: Handler, summary: string) => http.route(method, `${base}${path}`, async (request, { principal, remoteAddress }) => {
    const noStore = { 'cache-control': 'no-store' };
    try {
      const result = await handler({
        request,
        meta: requestMeta(request, remoteAddress),
        principal,
        body: async () => {
          const value = await readJsonBody<Record<string, unknown>>(request, { limit: BODY_LIMIT });
          return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        },
      });
      return jsonResponse(result.status, result.body, { ...noStore, ...result.headers });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        return jsonResponse(error.statusCode, { success: false, error: error.message }, noStore);
      }
      if (error instanceof IamError) {
        return jsonResponse(error.status, { success: false, code: error.code, error: error.message },
          error.retryAfterMs ? { ...noStore, 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) } : noStore);
      }
      if (isDatabaseBusyError(error)) {
        return jsonResponse(503, { success: false, code: 'database_busy', error: '数据库正忙，请稍后重试' },
          { ...noStore, 'retry-after': String(DATABASE_BUSY_RETRY_AFTER_SECONDS) });
      }
      return jsonResponse(500, { success: false, code: 'failed', error: '操作失败' }, noStore);
    }
  }, { summary, tags: ['auth'] });

  const requireIam = (): ConsoleIamService => {
    const iam = options.iam();
    if (!iam?.ready) throw new IamError('unavailable', '当前数据库不能存储账号，或尚未就绪');
    return iam;
  };
  const requireUser = (principal: ConsolePrincipal | undefined) => {
    if (!isUserPrincipal(principal)) throw new IamError('unauthorized', '需要登录');
    return principal;
  };
  /** Setup is open only to the bootstrap principal while no owner exists. */
  const requireSetup = (principal: ConsolePrincipal | undefined) => {
    if (!options.setup.setupRequired()) throw new IamError('conflict', '已初始化');
    if (principal?.kind !== 'bootstrap') throw new IamError('forbidden', '需要初始化令牌');
  };
  const ok = (data: unknown, status = 200) => ({ status, body: { success: true, data } });
  const onboarding = async (): Promise<{ onboarding?: unknown }> => {
    if (!options.onboarding) return {};
    try {
      return { onboarding: await options.onboarding() };
    } catch {
      return {};
    }
  };
  const managesPlugins = (permissions: readonly string[]) => permissions.includes(CONSOLE_PERMISSIONS.PLUGIN_MANAGE);

  return [
    route('POST', CONSOLE_AUTH_ROUTES.LOGIN, async ({ meta, body }) => {
      const input = await body();
      const result = await requireIam().login(input.username, input.password, meta);
      return ok(result);
    }, 'Console login'),
    route('POST', CONSOLE_AUTH_ROUTES.LOGOUT, async ({ principal }) => {
      await requireIam().logout(requireUser(principal));
      return ok({ loggedOut: true });
    }, 'Console logout'),
    route('GET', CONSOLE_AUTH_ROUTES.ME, async ({ principal }) => {
      const setupRequired = options.setup.setupRequired();
      if (!principal) return ok({ kind: 'anonymous', permissions: [], bindings: [], setupRequired });
      if (principal.kind === 'bootstrap') {
        const permissions = globalPermissions(principal);
        return ok({
          kind: 'bootstrap', open: principal.open, permissions, bindings: [], setupRequired,
          ...(managesPlugins(permissions) ? await onboarding() : {}),
        });
      }
      const user = await options.iam()?.getUser(principal.userId);
      // Level grants expanded over the loaded plugins' permission catalog.
      const permissions = globalPermissions(principal, options.http.tokenRegistry?.pluginPermissions?.() ?? []);
      return ok({
        kind: principal.kind,
        user: user ? { id: user.id, username: user.username, displayName: user.displayName } : { id: principal.userId, username: principal.username, displayName: principal.displayName },
        permissions,
        bindings: principal.grants.map(grant => ({ role: grant.role, scope: grant.scope, permissions: grant.permissions })),
        setupRequired,
        ...(managesPlugins(permissions) ? await onboarding() : {}),
      });
    }, 'Current Console principal'),
    route('POST', CONSOLE_AUTH_ROUTES.PASSWORD, async ({ meta, principal, body }) => {
      const input = await body();
      const issued = await requireIam().changePassword(requireUser(principal), input.currentPassword, input.newPassword, meta);
      return ok({ changed: true, ...issued });
    }, 'Change own password'),
    route('GET', CONSOLE_AUTH_ROUTES.TOKENS, async ({ principal }) => {
      return ok({ tokens: await requireIam().listTokens(requireUser(principal).userId) });
    }, 'List own API tokens'),
    route('POST', CONSOLE_AUTH_ROUTES.TOKENS, async ({ principal, body }) => {
      const user = requireUser(principal);
      const input = await body();
      const created = await requireIam().createToken(user.userId, { name: input.name, permissions: input.permissions, expiresAt: input.expiresAt });
      requireIam().audit({ actor: `user:${user.userId}`, action: 'auth.tokens.create', target: `api-token:${created.record.id}`, outcome: 'ok' });
      return ok(created, 201);
    }, 'Create own API token'),
    route('POST', CONSOLE_AUTH_ROUTES.TOKENS_REVOKE, async ({ principal, body }) => {
      const user = requireUser(principal);
      const input = await body();
      await requireIam().revokeToken(String(input.id ?? ''), user.userId);
      requireIam().audit({ actor: `user:${user.userId}`, action: 'auth.tokens.revoke', target: `api-token:${String(input.id ?? '')}`, outcome: 'ok' });
      return ok({ revoked: true });
    }, 'Revoke own API token'),
    // ---------------------------------------------------------------- setup (bootstrap only)
    route('GET', CONSOLE_AUTH_ROUTES.SETUP, async ({ principal }) => {
      requireSetup(principal);
      return ok({ ...await options.setup.status(), ...await onboarding() });
    }, 'Setup status'),
    route('POST', CONSOLE_AUTH_ROUTES.SETUP, async ({ meta, principal, body }) => {
      requireSetup(principal);
      const input = await body();
      const { user } = await options.setup.createOwner({ username: input.username, password: input.password, displayName: input.displayName });
      const iam = requireIam();
      const session = await iam.issueSession(user.id, meta);
      iam.audit({ actor: 'bootstrap', action: 'auth.setup', target: `user:${user.id}`, outcome: 'ok' });
      return ok({ ...session, user }, 201);
    }, 'Create the first owner'),
    route('GET', CONSOLE_AUTH_ROUTES.SETUP_DATABASE, async ({ principal }) => {
      requireSetup(principal);
      const status = await options.setup.status();
      return ok({ ...status.database, drivers: await options.setup.drivers() });
    }, 'Setup database choices'),
    route('POST', CONSOLE_AUTH_ROUTES.SETUP_DATABASE_TEST, async ({ principal, body }) => {
      requireSetup(principal);
      const input = await body();
      return ok(await options.setup.testDatabase({ dialect: input.dialect, connection: input.connection }));
    }, 'Test a database connection'),
    route('POST', CONSOLE_AUTH_ROUTES.SETUP_DATABASE, async ({ principal, body }) => {
      requireSetup(principal);
      const input = await body();
      const result = await options.setup.applyDatabase({ dialect: input.dialect, connection: input.connection });
      if (!options.requestRestart) return ok({ restarting: false, ...result });
      // Respond first; the database is a process resource and needs a restart.
      setTimeout(() => options.requestRestart?.(), 300).unref?.();
      return ok({ restarting: true, notice: result.notice });
    }, 'Save the setup database'),
  ];
}
