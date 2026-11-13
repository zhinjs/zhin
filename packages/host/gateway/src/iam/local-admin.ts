/**
 * Socket-only Console administration (`gateway.console.*`, principal `'local'`): what
 * `zhin console init` / `zhin console user …` do when a gateway runs (ADR 0049 §7, ADR 0053 §5).
 * The gateway's own {@link ConsoleSetupService} and {@link ConsoleIamService} answer, so the CLI
 * and the web wizard share one flow, a database switch is applied by the gateway itself and the
 * owner state changes at once. Never reachable over HTTP (the local socket's owner check is the
 * authentication).
 */
import { DATABASE_BUSY_RETRY_AFTER_SECONDS, isDatabaseBusyError } from '../database/project-database.js';
import { LOCAL_GATEWAY_RPC, type LocalGatewayError } from '../local/protocol.js';
import { IamError, type ConsoleIamService } from './service.js';
import type { ConsoleSetupService } from './setup-service.js';

export type LocalConsoleAdminResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; error: LocalGatewayError }>;

export interface LocalConsoleAdmin {
  owns(type: string): boolean;
  handle(type: string, data: unknown): Promise<LocalConsoleAdminResult>;
}

export interface LocalConsoleAdminOptions {
  readonly setup: ConsoleSetupService;
  readonly iam: () => ConsoleIamService | undefined;
  /**
   * After the setup database was written: reconnect the gateway to it (awaited, so the next
   * request already uses it) and restart the instance (not awaited). Returns whether the instance
   * is being restarted.
   */
  readonly switchDatabase: () => Promise<{ restarting: boolean }>;
  /** `gateway.console.migration.status`: the import state and whether old tables reappeared. */
  readonly migration?: () => Promise<unknown>;
}

const TYPES: ReadonlySet<string> = new Set([
  LOCAL_GATEWAY_RPC.CONSOLE_SETUP_STATUS,
  LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DRIVERS,
  LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE_TEST,
  LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE,
  LOCAL_GATEWAY_RPC.CONSOLE_SETUP_OWNER,
  LOCAL_GATEWAY_RPC.CONSOLE_USER_LIST,
  LOCAL_GATEWAY_RPC.CONSOLE_USER_CREATE,
  LOCAL_GATEWAY_RPC.CONSOLE_USER_PASSWD,
  LOCAL_GATEWAY_RPC.CONSOLE_USER_DISABLE,
  LOCAL_GATEWAY_RPC.CONSOLE_MIGRATION_STATUS,
]);

const ACTOR = 'local';

export function createLocalConsoleAdmin(options: LocalConsoleAdminOptions): LocalConsoleAdmin {
  const { setup } = options;
  const requireIam = (): ConsoleIamService => {
    const iam = options.iam();
    if (!iam?.ready) throw new IamError('unavailable', iam?.unavailableReason() ?? 'Console 访问控制尚未就绪');
    return iam;
  };
  const requireUser = async (iam: ConsoleIamService, username: unknown) => {
    const user = typeof username === 'string' ? await iam.findUser(username) : null;
    if (!user) throw new IamError('not_found', `用户不存在：${typeof username === 'string' ? username : ''}`);
    return user;
  };
  const audit = (action: string, target?: string): void => {
    options.iam()?.audit({ actor: ACTOR, action, ...(target ? { target } : {}), outcome: 'ok' });
  };

  async function run(type: string, input: Record<string, unknown>): Promise<unknown> {
    switch (type) {
      case LOCAL_GATEWAY_RPC.CONSOLE_SETUP_STATUS: return setup.status();
      case LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DRIVERS: return setup.drivers();
      case LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE_TEST:
        return setup.testDatabase({ dialect: input.dialect, connection: input.connection });
      case LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE: {
        const applied = await setup.applyDatabase({ dialect: input.dialect, connection: input.connection });
        const { restarting } = await options.switchDatabase();
        audit('auth.setup.database');
        return { notice: applied.notice, switched: true, restarting };
      }
      case LOCAL_GATEWAY_RPC.CONSOLE_SETUP_OWNER: {
        const { user } = await setup.createOwner({ username: input.username, password: input.password, displayName: input.displayName });
        audit('auth.setup', `user:${user.id}`);
        return { user };
      }
      case LOCAL_GATEWAY_RPC.CONSOLE_USER_LIST: return { users: await requireIam().listUsers() };
      case LOCAL_GATEWAY_RPC.CONSOLE_USER_CREATE: {
        const role = typeof input.role === 'string' && input.role ? input.role : 'viewer';
        const user = await requireIam().createUser({
          username: input.username, password: input.password, displayName: input.displayName,
          bindings: [{ role, scopeKind: 'global' }],
        });
        audit('iam.users.create', `user:${user.id}`);
        return { user };
      }
      case LOCAL_GATEWAY_RPC.CONSOLE_USER_PASSWD: {
        const iam = requireIam();
        const user = await requireUser(iam, input.username);
        await iam.resetPassword(user.id, input.password);
        audit('iam.users.resetPassword', `user:${user.id}`);
        return { user };
      }
      case LOCAL_GATEWAY_RPC.CONSOLE_USER_DISABLE: {
        const iam = requireIam();
        const user = await requireUser(iam, input.username);
        const updated = await iam.setDisabled(user.id, input.disabled !== false);
        audit(updated.disabled ? 'iam.users.disable' : 'iam.users.enable', `user:${user.id}`);
        return { user: updated };
      }
      case LOCAL_GATEWAY_RPC.CONSOLE_MIGRATION_STATUS:
        if (!options.migration) throw new IamError('unavailable', '迁移状态不可用');
        return options.migration();
      default: throw new IamError('invalid_input', `Unknown RPC type: ${type}`);
    }
  }

  return Object.freeze({
    owns: (type: string) => TYPES.has(type),
    async handle(type: string, data: unknown): Promise<LocalConsoleAdminResult> {
      const input = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
      try {
        return { ok: true, data: await run(type, input) };
      } catch (error) {
        if (error instanceof IamError) return { ok: false, error: { code: error.code, message: error.message, status: error.status } };
        if (isDatabaseBusyError(error)) {
          return { ok: false, error: { code: 'database_busy', message: `数据库正忙，请 ${DATABASE_BUSY_RETRY_AFTER_SECONDS} 秒后重试`, status: 503 } };
        }
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), status: 500 } };
      }
    },
  });
}
