/**
 * Console access control in the gateway (ADR 0054 §3 / §7, ADR 0049, ADR 0053 §4): the gateway
 * opens the project database itself, owns the `console_*` tables, authenticates sessions / API
 * tokens / the bootstrap token locally, and serves `/auth/*`, `iam.*`, `onboarding.update`, the
 * setup wizard, the terminal and the audit log — all without an instance.
 *
 * The instance contributes what only it knows over the bridge: the plugin permission catalog
 * (`catalog`) and its own audit entries (`audit`); the gateway tells it when a user's credentials
 * were revoked (`principal-revoked`) so it closes that user's SSE / WebSocket connections.
 */
import { join } from 'node:path';
import {
  auditActor,
  authorizeConsoleRpc,
  jsonResponse,
  rpcAuditDetail,
  rpcAuditTarget,
  type ConsoleAccessProvider,
  type ConsoleAuditEntry,
  type ConsolePrincipal,
  type ConsoleRequestMeta,
  type ConsoleRpcDecision,
  type RouteContext,
  type TokenRegistry,
} from '@zhin.js/host-http';
import { ONBOARDING_RPC, type ConsolePluginPermissionInfo } from '@zhin.js/console-protocol';
import { DEFAULT_ROOT_CONFIG_FILE_NAME } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { ConsoleConfigurationStore } from '../config/configuration.js';
import { readEnvFile, writeEnvFile } from '../config/environment-files.js';
import { loadExpandedProjectConfig, resolveProjectDatabaseConfig, type ProjectDatabaseConfig } from '../database/config.js';
import { ProjectDatabase } from '../database/project-database.js';
import { projectEnvironment } from '../iam/install.js';
import { createLocalConsoleAdmin, type LocalConsoleAdmin } from '../iam/local-admin.js';
import { registerConsoleAuthRoutes } from '../iam/routes.js';
import { dispatchIamRpc, isIamRpc } from '../iam/rpc.js';
import { ConsoleIamService, type IamDatabase } from '../iam/service.js';
import { ConsoleSetupService } from '../iam/setup-service.js';
import { defineConsoleIamTables } from '../iam/tables.js';
import { OnboardingError } from '../onboarding/errors.js';
import { OnboardingService, type OnboardingStatus } from '../onboarding/service.js';
import { findConfigFile } from '../project/config-file.js';
import type { ConsoleTerminalHandle } from '../terminal/index.js';
import { installHostConsoleTerminal } from '../terminal/host.js';
import type { GatewayRpcHandler } from './console-rpc.js';
import type { GatewayHttpServer } from './gateway-http-server.js';

const logger = getLogger('gateway');
const DEFAULT_RETRY_MS = 10_000;

/** What the Console module needs from the instance bridge (`IpcInstanceTransport` has all of it). */
export interface GatewayConsoleInstancePort {
  /** Plugin permission catalog the instance last reported. */
  pluginPermissions?(): readonly ConsolePluginPermissionInfo[];
  /** Sends `principal-revoked` (the instance closes that user's live connections). */
  revokePrincipal?(principalId: string, reason?: string): void;
  /** Audit entries written by the instance. */
  onAudit?(listener: (entry: ConsoleAuditEntry) => void): () => void;
}

export interface GatewayConsoleOptions {
  readonly server: GatewayHttpServer;
  readonly projectRoot: string;
  /** Selects `.env.<environment>` for `${…}` in `database` / `console.terminal`. Default `development`. */
  readonly environment?: string;
  readonly instance?: GatewayConsoleInstancePort;
  /** Restarts the instance after the setup wizard switched databases (ADR 0054 §7). */
  readonly restartInstance?: () => Promise<void>;
  /** Overrides the project `database` block (tests). */
  readonly database?: ProjectDatabaseConfig;
  /** Overrides the project `console.terminal` block. */
  readonly terminal?: unknown;
  readonly onboarding?: OnboardingService;
  /** Retry interval while the database cannot be opened. Default 10 s. */
  readonly retryMs?: number;
}

export interface GatewayConsole {
  /** Settles once the first database open attempt finished (never rejects). */
  readonly ready: Promise<void>;
  /** The IAM service bound to the open database; undefined when the dialect cannot hold accounts. */
  iam(): ConsoleIamService | undefined;
  /** The gateway's database connection (undefined before the first open). */
  database(): ProjectDatabase | undefined;
  readonly setup: ConsoleSetupService;
  readonly onboarding: OnboardingService;
  readonly terminal: ConsoleTerminalHandle;
  /** Closes the gateway's connection and opens the configured database again (setup wizard). */
  reopenDatabase(): Promise<void>;
  /** Socket-only `gateway.console.*` (`zhin console init` / `zhin console user` beside the gateway). */
  readonly localAdmin: LocalConsoleAdmin;
  close(): Promise<void>;
}

/** A database that never starts: the IAM service then fails closed on its setup marker. */
const UNAVAILABLE_DATABASE: IamDatabase = Object.freeze({ started: false, models: Object.freeze({ get: () => undefined }) });

interface Connection {
  readonly database?: ProjectDatabase;
  readonly service?: ConsoleIamService;
  readonly supported: boolean;
  readonly dispose: Array<() => void>;
}

export async function startGatewayConsole(options: GatewayConsoleOptions): Promise<GatewayConsole> {
  const { server, projectRoot } = options;
  const failClosed = (): Connection => ({
    service: new ConsoleIamService({ database: UNAVAILABLE_DATABASE, projectRoot }),
    supported: true,
    dispose: [],
  });
  const environment = options.environment ?? 'development';
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const registry: TokenRegistry = server.tokenRegistry;
  const settings = await loadExpandedProjectConfig(projectRoot, environment).catch((error: unknown) => {
    logger.warn(formatCompact({ op: 'gateway_config_read_failed', error: errorText(error) }));
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  });
  // Until (and while re-) connecting, fail closed: the owner state comes from the setup marker.
  let connection: Connection = failClosed();
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let opening: Promise<void> | undefined;
  const iam = (): ConsoleIamService | undefined => (connection.supported ? connection.service : undefined);

  const disposers: Array<() => void> = [];
  // Level grants need the catalog of the instance's loaded plugins (kept across restarts).
  disposers.push(registry.usePluginPermissions(() => options.instance?.pluginPermissions?.() ?? []));
  const access: ConsoleAccessProvider = Object.freeze({
    initialized: () => connection.service?.initialized() ?? false,
    authenticate: async (token: string, meta: ConsoleRequestMeta) => (await iam()?.authenticate(token, meta)) ?? null,
    audit: (entry: ConsoleAuditEntry) => { iam()?.audit(entry); },
  });
  disposers.push(registry.useAccessProvider(access));
  const stopInstanceAudit = options.instance?.onAudit?.((entry) => { iam()?.audit(entry); });
  if (stopInstanceAudit) disposers.push(stopInstanceAudit);

  const terminal = installHostConsoleTerminal(server, {
    config: options.terminal !== undefined ? options.terminal : readTerminalBlock(settings),
    projectRoot,
    base: server.apiBase,
    iam,
    logger: { warn: (message: string) => logger.warn(message), info: (message: string) => logger.info(message) },
  });

  const revoke = (userId: string, reason: string): void => {
    terminal.terminatePrincipal(`user:${userId}`, 'revoked');
    try { options.instance?.revokePrincipal?.(userId, reason); } catch { /* bridge gone */ }
  };

  async function connect(): Promise<void> {
    let config: ProjectDatabaseConfig;
    try {
      config = options.database ?? await resolveProjectDatabaseConfig(projectRoot, await loadExpandedProjectConfig(projectRoot, environment));
    } catch (error) {
      logger.warn(formatCompact({ op: 'gateway_database_config_invalid', error: errorText(error) }));
      connection = failClosed();
      return;
    }
    let database: ProjectDatabase;
    try {
      database = new ProjectDatabase(config);
    } catch (error) {
      logger.warn(formatCompact({ op: 'gateway_database_driver_failed', dialect: config.dialect, error: errorText(error) }));
      connection = failClosed();
      return;
    }
    const supported = defineConsoleIamTables(database);
    if (!supported) {
      logger.warn('console iam: the configured database cannot store Console users; run the setup wizard to choose sqlite/mysql/pg/mongodb');
      connection = { database, supported: false, dispose: [] };
      return;
    }
    const service = new ConsoleIamService({
      database,
      projectRoot,
      onError: (error) => logger.warn(`console iam: ${errorText(error)}`),
      pluginPermissions: () => registry.pluginPermissions(),
    });
    const dispose = [service.onCredentialsRevoked(({ userId, reason }) => revoke(userId, reason))];
    connection = { database, service, supported: true, dispose };
    try {
      await database.start();
      await service.start();
      logger.info(formatCompact({ op: 'gateway_database_open', dialect: config.dialect }));
    } catch (error) {
      // Not ready: `/auth/*` answers 503 and the owner state comes from the setup marker.
      logger.warn(formatCompact({ op: 'gateway_database_open_failed', dialect: config.dialect, error: errorText(error) }));
      scheduleRetry();
    }
  }


  function scheduleRetry(): void {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (closed) return;
      void reopen();
    }, retryMs);
    retryTimer.unref?.();
  }

  async function disconnect(): Promise<void> {
    const current = connection;
    connection = failClosed();
    for (const dispose of current.dispose.splice(0)) dispose();
    current.service?.stop();
    await current.database?.stop().catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_database_close_failed', error: errorText(error) }));
    });
  }

  function reopen(): Promise<void> {
    opening = (opening ?? Promise.resolve()).then(async () => {
      if (closed) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      await disconnect();
      if (!closed) await connect();
    });
    return opening;
  }

  const configFile = join(projectRoot, findConfigFile(projectRoot) ?? DEFAULT_ROOT_CONFIG_FILE_NAME);
  const setup = new ConsoleSetupService({
    projectRoot,
    config: new ConsoleConfigurationStore({ projectRoot, document: createConfigDocument(configFile) }),
    envFile: {
      read: () => readEnvFile(projectRoot, '.env'),
      write: (content) => writeEnvFile(projectRoot, '.env', content),
    },
    iam,
    environment: () => projectEnvironment(projectRoot),
  });
  const onboarding = options.onboarding ?? new OnboardingService({
    projectRoot,
    hasOwner: () => connection.service?.initialized() ?? false,
  });

  const restartInstance = (): void => {
    void options.restartInstance?.().catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_database_switch_failed', error: errorText(error) }));
    });
  };
  const localAdmin = createLocalConsoleAdmin({
    setup,
    iam,
    // ADR 0054 §7, as for the web wizard: the gateway uses the new database before it answers.
    switchDatabase: async () => {
      await reopen();
      restartInstance();
      return { restarting: options.restartInstance !== undefined };
    },
  });

  disposers.push(...registerConsoleAuthRoutes({
    http: server,
    base: server.apiBase,
    iam,
    setup,
    onboarding: () => onboarding.status(),
    // ADR 0054 §7: close the gateway's connection, open the new database, restart the instance.
    requestRestart: () => {
      void reopen()
        .then(() => options.restartInstance?.())
        .catch((error: unknown) => logger.warn(formatCompact({ op: 'gateway_database_switch_failed', error: errorText(error) })));
    },
  }));
  // `/auth/*` belongs to the gateway alone: nothing under it is forwarded to the instance.
  disposers.push(server.route('ALL', `${server.apiBase}/auth/*`, () => jsonResponse(404, { success: false, code: 'not_found', error: 'Not found' }), { summary: 'Unknown /auth route', tags: ['auth'] }));
  disposers.push(server.useConsoleRpc(createGatewayAccountRpc({ iam, onboarding })));

  const ready = reopen().catch((error: unknown) => {
    logger.warn(formatCompact({ op: 'gateway_database_open_failed', error: errorText(error) }));
  });
  let closeResult: Promise<void> | undefined;
  return Object.freeze({
    ready,
    iam,
    database: () => connection.database,
    setup,
    onboarding,
    terminal,
    reopenDatabase: reopen,
    localAdmin,
    close(): Promise<void> {
      closeResult ??= (async () => {
        closed = true;
        clearTimeout(retryTimer);
        terminal.close();
        for (const dispose of disposers.splice(0).reverse()) {
          try { dispose(); } catch { /* keep closing */ }
        }
        await opening?.catch(() => undefined);
        await disconnect();
      })();
      return closeResult;
    },
  });
}

/** `console.terminal` of the expanded root config. */
function readTerminalBlock(document: Readonly<Record<string, unknown>>): unknown {
  const block = document.console;
  return block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>).terminal : undefined;
}

export interface GatewayAccountRpcOptions {
  readonly iam: () => ConsoleIamService | undefined;
  readonly onboarding: OnboardingService;
}

const ONBOARDING_STEPS = new Set(['ai', 'adapters', 'finish']);

/**
 * `iam.*` (ADR 0049 §5) and `onboarding.update` (ADR 0053 §4) on the gateway's
 * `POST {base}/console/request`. Authorization uses the shared permission map
 * (`CONSOLE_RPC_PERMISSIONS`); denials and writes are audited like in the instance dispatcher.
 */
export function createGatewayAccountRpc(options: GatewayAccountRpcOptions): GatewayRpcHandler {
  return Object.freeze({
    owns: (type: string) => isIamRpc(type) || type === ONBOARDING_RPC.UPDATE,
    async handle(message: Readonly<Record<string, unknown>>, context: RouteContext, registry: TokenRegistry): Promise<Response> {
      const noStore = { 'cache-control': 'no-store' };
      const requestId = message.requestId;
      const principal: ConsolePrincipal | undefined = context.principal;
      if (!principal) {
        return jsonResponse(401, { success: false, code: 'unauthorized', error: 'Invalid or missing token', requestId }, noStore);
      }
      const decision: ConsoleRpcDecision = authorizeConsoleRpc(principal, message);
      const audit = (outcome: 'ok' | 'denied' | 'error'): void => {
        try {
          registry.accessProvider?.audit?.({
            actor: auditActor(principal),
            action: `rpc:${String(message.type ?? '')}`.slice(0, 256),
            ...(decision.allowed && rpcAuditTarget(decision.rule) ? { target: rpcAuditTarget(decision.rule)! } : {}),
            outcome,
            detail: rpcAuditDetail(message),
            ...(context.remoteAddress ? { ip: context.remoteAddress } : {}),
          });
        } catch { /* audit never breaks a request */ }
      };
      if (!decision.allowed) {
        audit('denied');
        return jsonResponse(403, { success: false, code: decision.code, error: decision.error, requestId }, noStore);
      }
      const result = isIamRpc(message.type)
        ? await dispatchIamRpc(message, options.iam(), principal)
        : await updateOnboarding(options.onboarding, message, principal);
      if (decision.write) audit(result.status < 400 && result.body.success !== false ? 'ok' : 'error');
      else if (result.status === 403) audit('denied');
      return jsonResponse(result.status, result.body, { ...noStore, ...result.headers });
    },
  });
}

async function updateOnboarding(
  onboarding: OnboardingService,
  message: Readonly<Record<string, unknown>>,
  principal: ConsolePrincipal,
): Promise<{ status: number; body: Record<string, unknown>; headers?: Record<string, string> }> {
  const type = String(message.type ?? '');
  const requestId = message.requestId;
  // The Console sends `{ type, step, status }`; `data` is accepted as well.
  const payload = (message.data && typeof message.data === 'object' && !Array.isArray(message.data) ? message.data : message) as Record<string, unknown>;
  try {
    const step = payload.step;
    if (typeof step !== 'string' || !ONBOARDING_STEPS.has(step)) throw new OnboardingError('invalid_input', 'step 只能是 ai / adapters / finish');
    const status: OnboardingStatus = step === 'finish'
      ? await onboarding.complete({ principal })
      : await onboarding.markStep(step, payload.status, { principal });
    return { status: 200, body: { success: true, data: status, type, requestId } };
  } catch (error) {
    if (error instanceof OnboardingError) {
      return { status: error.status, body: { success: false, code: error.code, error: error.message, requestId } };
    }
    return { status: 500, body: { success: false, code: 'failed', error: '引导状态更新失败', requestId } };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
