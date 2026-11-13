/**
 * Console access control in the gateway (ADR 0054 §3 / §7, ADR 0049, ADR 0053 §4, ADR 0059): the
 * gateway keeps the access-control tables in its own store `.zhin/gateway.db`, authenticates
 * sessions / API tokens / the bootstrap token locally, and serves `/auth/*`, `iam.*`,
 * `onboarding.update`, the setup wizard, the terminal and the audit log — all without an
 * instance. It holds no connection to the project database: it connects only to import the
 * tables an earlier version left there (and the setup wizard tests a connection).
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
import { openGatewayStore, type GatewayStore, type OpenGatewayStoreOptions } from '../database/gateway-store.js';
import { projectEnvironment } from '../iam/install.js';
import { createLocalConsoleAdmin, type LocalConsoleAdmin } from '../iam/local-admin.js';
import { registerConsoleAuthRoutes } from '../iam/routes.js';
import { dispatchIamRpc, isIamRpc } from '../iam/rpc.js';
import { ensureGatewayStoreMarker, importLegacyIamTables, inspectLegacyIamImport, isTransientLegacyImportError, LegacyImportError, readLegacyImportRecord } from '../iam/legacy-import.js';
import { ConsoleIamService, type IamDatabase } from '../iam/service.js';
import { ConsoleSetupService } from '../iam/setup-service.js';
import { OnboardingError } from '../onboarding/errors.js';
import { OnboardingService, type OnboardingStatus } from '../onboarding/service.js';
import { findConfigFile } from '../project/config-file.js';
import type { ConsoleTerminalHandle } from '../terminal/index.js';
import { installHostConsoleTerminal } from '../terminal/host.js';
import type { GatewayRpcHandler } from './console-rpc.js';
import type { GatewayHttpServer } from './gateway-http-server.js';

const logger = getLogger('gateway');
const DEFAULT_RETRY_MS = 10_000;
/** Cap of the retry backoff while the project database stays unreachable. */
const MAX_RETRY_MS = 5 * 60_000;

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
  /** Overrides the project `database` block the old `console_*` tables are imported from (tests). */
  readonly database?: ProjectDatabaseConfig;
  /** Gateway store overrides (tests; default `.zhin/gateway.db`). */
  readonly store?: OpenGatewayStoreOptions;
  /** Overrides the project `console.terminal` block. */
  readonly terminal?: unknown;
  readonly onboarding?: OnboardingService;
  /** Retry interval while gateway.db or the import of the old tables fails. Default 10 s. */
  readonly retryMs?: number;
}

export interface GatewayConsole {
  /** Settles once the first open attempt finished (never rejects). */
  readonly ready: Promise<void>;
  /** The IAM service; fails closed (`unavailableReason()`) until gateway.db is open and imported. */
  iam(): ConsoleIamService | undefined;
  /** The gateway store `.zhin/gateway.db` (undefined before it opened). */
  database(): GatewayStore | undefined;
  readonly setup: ConsoleSetupService;
  readonly onboarding: OnboardingService;
  readonly terminal: ConsoleTerminalHandle;
  /** Closes gateway.db and opens it again (and retries a pending import). */
  reopenDatabase(): Promise<void>;
  /**
   * Writes the store marker into the project database if it is missing (after the first owner was
   * created and after the instance first reported ready: a first-run project file exists by then).
   */
  ensureStoreMarker(): Promise<void>;
  /** Socket-only `gateway.console.*` (`zhin console init` / `zhin console user` beside the gateway). */
  readonly localAdmin: LocalConsoleAdmin;
  close(): Promise<void>;
}

/** A database that never starts: the IAM service then fails closed. */
const UNAVAILABLE_DATABASE: IamDatabase = Object.freeze({ started: false, models: Object.freeze({ get: () => undefined }) });

interface Connection {
  readonly database?: GatewayStore;
  readonly service: ConsoleIamService;
  readonly dispose: Array<() => void>;
}

export async function startGatewayConsole(options: GatewayConsoleOptions): Promise<GatewayConsole> {
  const { server, projectRoot } = options;
  /** Why access control is closed (undefined once gateway.db is open and the import settled). */
  let pending: string | undefined = 'Console 访问控制正在启动';
  /** Category of `pending` shown to anonymous callers (never the detail). */
  let pendingCode = 'starting';
  /** Consecutive transient failures (backoff exponent). */
  let failures = 0;
  const failClosed = (): Connection => ({
    service: new ConsoleIamService({
      database: UNAVAILABLE_DATABASE,
      projectRoot,
      unavailable: () => pending ?? 'Console 访问控制正在重新连接',
      unavailableCode: () => (pending === undefined ? 'starting' : pendingCode),
    }),
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
  const iam = (): ConsoleIamService | undefined => connection.service;

  const disposers: Array<() => void> = [];
  // Level grants need the catalog of the instance's loaded plugins (kept across restarts).
  disposers.push(registry.usePluginPermissions(() => options.instance?.pluginPermissions?.() ?? []));
  const access: ConsoleAccessProvider = Object.freeze({
    initialized: () => connection.service.initialized(),
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

  const projectDatabase = async (): Promise<ProjectDatabaseConfig> => options.database
    ?? resolveProjectDatabaseConfig(projectRoot, await loadExpandedProjectConfig(projectRoot, environment));

  async function connect(): Promise<void> {
    let store: GatewayStore;
    try {
      store = await openGatewayStore(projectRoot, options.store ?? {});
    } catch (error) {
      pending = `无法打开 .zhin/gateway.db：${errorText(error)}`;
      pendingCode = 'store';
      logger.warn(formatCompact({ op: 'gateway_store_open_failed', error: errorText(error) }));
      scheduleRetry();
      return;
    }
    connection = { database: store, service: connection.service, dispose: [] };
    // ADR 0059 §3: the old console_* tables of the project database come over before anything
    // reads gateway.db; until then access control stays closed (an empty store is not "no owner").
    try {
      const record = await importLegacyIamTables({
        store,
        projectRoot,
        projectDatabase,
        logger: { info: (message) => logger.info(message), warn: (message) => logger.warn(message) },
      });
      if (record.status === 'done' && record.changed) {
        logger.warn(formatCompact({ op: 'gateway_legacy_import_changed', export: record.changedExport }));
      }
    } catch (error) {
      const code = error instanceof LegacyImportError ? error.code : 'error';
      const transient = isTransientLegacyImportError(error);
      pending = code === 'store_lost' || code === 'store_mismatch'
        ? errorText(error)
        : transient
          ? `正在等待项目数据库，以迁移旧版的 Console 账号表：${errorText(error)}`
          : `迁移旧版 Console 账号表失败，需要处理后重启网关（zhin stop && zhin start）：${errorText(error)}`;
      pendingCode = code === 'store_lost' || code === 'store_mismatch' ? code : transient ? 'migration_pending' : 'migration_failed';
      logger.warn(formatCompact({ op: 'gateway_legacy_import_failed', code, transient, error: errorText(error) }));
      // Retrying cannot fix a conflict, a mismatch or a lost store: stay closed until the operator acts.
      if (transient) scheduleRetry();
      return;
    }
    const service = new ConsoleIamService({
      database: store,
      projectRoot,
      onError: (error) => logger.warn(`console iam: ${errorText(error)}`),
      pluginPermissions: () => registry.pluginPermissions(),
      onOwnerCreated: () => { void ensureStoreMarker(); },
    });
    try {
      await service.start();
    } catch (error) {
      pending = `Console 访问控制无法启动：${errorText(error)}`;
      pendingCode = 'store';
      logger.warn(formatCompact({ op: 'gateway_store_open_failed', error: errorText(error) }));
      service.stop();
      scheduleRetry();
      return;
    }
    const dispose = [service.onCredentialsRevoked(({ userId, reason }) => revoke(userId, reason))];
    connection = { database: store, service, dispose };
    pending = undefined;
    failures = 0;
    logger.info(formatCompact({ op: 'gateway_store_open', file: store.filename }));
  }

  /** Writes the project database's store marker if missing; a foreign marker closes the Console. */
  async function ensureStoreMarker(): Promise<void> {
    const store = connection.database;
    if (!store || pending !== undefined) return;
    try {
      await ensureGatewayStoreMarker({ store, projectRoot, projectDatabase, logger: { warn: (message) => logger.warn(message) } });
    } catch (error) {
      if (error instanceof LegacyImportError && (error.code === 'store_mismatch' || error.code === 'store_lost')) {
        // The project database belongs to another gateway.db (found after the start, e.g. once the
        // project database became reachable): the same fail-closed state as at connect — Console
        // closed, no retry, until the operator acts (`zhin console init --reset-store`).
        logger.warn(formatCompact({ op: 'gateway_legacy_import_failed', code: error.code, transient: false, error: errorText(error) }));
        opening = (opening ?? Promise.resolve()).then(async () => {
          const current = connection;
          if (closed || current.database !== store) return;
          pending = errorText(error);
          pendingCode = error.code;
          const users = await current.service.listUsers().catch(() => [] as const);
          // gateway.db stays open (the local owner can inspect it, `--reset-store` can run).
          connection = { database: store, service: failClosed().service, dispose: [] };
          for (const dispose of current.dispose.splice(0)) dispose();
          current.service.stop();
          // Sessions and API tokens no longer authenticate (the service is closed); what is already
          // open ends too: terminals and the instance's sockets of every user, as on a revocation.
          for (const user of users) revoke(user.id, error.code);
          for (const session of terminal.sessions()) terminal.terminatePrincipal(session.principalId, 'revoked');
        });
        await opening;
        return;
      }
      logger.warn(formatCompact({ op: 'gateway_store_marker_failed', error: errorText(error) }));
    }
  }

  /** Transient failure: retry with a growing delay (retryMs, 2×, 4×, … at most MAX_RETRY_MS). */
  function scheduleRetry(): void {
    if (closed || retryTimer) return;
    const delay = Math.min(retryMs * 2 ** failures, Math.max(retryMs, MAX_RETRY_MS));
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (closed) return;
      void reopen();
    }, delay);
    retryTimer.unref?.();
  }

  async function disconnect(): Promise<void> {
    const current = connection;
    pending ??= 'Console 访问控制正在重新连接';
    connection = failClosed();
    for (const dispose of current.dispose.splice(0)) dispose();
    current.service.stop();
    await current.database?.close().catch((error: unknown) => {
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
    hasOwner: () => connection.service.initialized(),
  });

  const restartInstance = (): void => {
    void options.restartInstance?.().catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_database_switch_failed', error: errorText(error) }));
    });
  };
  const localAdmin = createLocalConsoleAdmin({
    setup,
    iam,
    // The accounts stay in gateway.db (ADR 0059): only the instance uses the new database.
    switchDatabase: async () => {
      restartInstance();
      return { restarting: options.restartInstance !== undefined };
    },
    migration: async () => {
      const store = connection.database;
      if (!store) return { pending };
      const inspection = await inspectLegacyIamImport({ store, projectRoot, projectDatabase });
      return { ...inspection, record: inspection.record ?? await readLegacyImportRecord(store), ...(pending !== undefined ? { pending, pendingCode } : {}) };
    },
  });

  disposers.push(...registerConsoleAuthRoutes({
    http: server,
    base: server.apiBase,
    iam,
    setup,
    onboarding: () => onboarding.status(),
    // The instance restarts on the new project database; the accounts stay in gateway.db (ADR 0059).
    requestRestart: () => { restartInstance(); },
  }));
  // `/auth/*` belongs to the gateway alone: nothing under it is forwarded to the instance.
  disposers.push(server.route('ALL', `${server.apiBase}/auth/*`, () => jsonResponse(404, { success: false, code: 'not_found', error: 'Not found' }), { summary: 'Unknown /auth route', tags: ['auth'] }));
  disposers.push(server.useConsoleRpc(createGatewayAccountRpc({ iam, onboarding })));

  const ready = reopen().catch((error: unknown) => {
    logger.warn(formatCompact({ op: 'gateway_store_open_failed', error: errorText(error) }));
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
    ensureStoreMarker,
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
