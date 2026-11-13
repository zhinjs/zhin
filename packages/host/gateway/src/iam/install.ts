import { join } from 'node:path';
import type { HttpHost } from '@zhin.js/host-http';
import { readEnvFile, writeEnvFile } from '../config/environment-files.js';
import type { ProjectDatabaseConfig } from '../database/config.js';
import { openGatewayStore, type GatewayStore } from '../database/gateway-store.js';
import { normalizeBase } from '../http-response.js';
import { importLegacyIamTables } from './legacy-import.js';
import { registerConsoleAuthRoutes } from './routes.js';
import { ConsoleIamService, type IamDatabase } from './service.js';
import { ConsoleSetupService, type SetupConfigPort } from './setup-service.js';

export interface InstallConsoleIamOptions {
  /** Config file writer (ConsoleConfigurationStore). */
  readonly configStore: SetupConfigPort;
  readonly projectRoot: string;
  /**
   * The project database the old `console_*` tables are imported from (ADR 0059 §3), opened on a
   * connection of its own — never the process DatabaseHost.
   */
  readonly projectDatabase: () => Promise<ProjectDatabaseConfig>;
  /** Opens the gateway store (default `.zhin/gateway.db` of the project; tests pass their own). */
  readonly openStore?: () => Promise<GatewayStore>;
  readonly apiBase?: string;
  readonly logger?: Readonly<{ warn(message: string): void; info?(message: string): void }>;
  /** Process restart after the setup wizard changed the database. */
  readonly requestRestart?: () => void;
  /** `${…}` lookup for setup validation (defaults to process env + project `.env`). */
  readonly environment?: () => Promise<Readonly<Record<string, string | undefined>>>;
}

export interface ConsoleIamInstallation {
  readonly service: ConsoleIamService;
  readonly setup: ConsoleSetupService;
  /** Opens the gateway store, imports the old tables, starts the service (idempotent). */
  activate(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Console access control (ADR 0049) inside one process — a standalone instance (`zhin start
 * --standalone`, development and tests) that has no gateway. It opens `.zhin/gateway.db` itself,
 * so there is no process isolation from plugins there; under the gateway the instance never
 * calls this. Wires the session resolver behind `http.tokenRegistry`, `/auth/*` and the setup flow.
 */
export function installConsoleIam(http: HttpHost, options: InstallConsoleIamOptions): ConsoleIamInstallation {
  let store: GatewayStore | undefined;
  let pending: string | undefined = 'Console 访问控制正在启动';
  const database: IamDatabase = Object.freeze({
    get started() { return store?.started ?? false; },
    models: Object.freeze({ get: (name: string) => store?.models.get(name) }),
  });
  const service = new ConsoleIamService({
    database,
    projectRoot: options.projectRoot,
    onError: error => options.logger?.warn(`console iam: ${error instanceof Error ? error.message : String(error)}`),
    // Installed on the token registry by the runtime composition root; empty until then.
    pluginPermissions: () => http.tokenRegistry.pluginPermissions(),
    unavailable: () => pending,
  });
  const setup = new ConsoleSetupService({
    projectRoot: options.projectRoot,
    config: options.configStore,
    envFile: {
      read: () => readEnvFile(options.projectRoot, '.env'),
      write: content => writeEnvFile(options.projectRoot, '.env', content),
    },
    iam: () => service,
    environment: options.environment ?? (() => projectEnvironment(options.projectRoot)),
  });
  const disposers: Array<() => void> = [http.tokenRegistry.useAccessProvider(service)];
  disposers.push(...registerConsoleAuthRoutes({
    http,
    base: normalizeBase(options.apiBase ?? '/api'),
    iam: () => service,
    setup,
    ...(options.requestRestart ? { requestRestart: options.requestRestart } : {}),
  }));
  let activation: Promise<void> | undefined;
  return Object.freeze({
    service,
    setup,
    activate() {
      activation ??= (async () => {
        try {
          store = await (options.openStore ?? (() => openGatewayStore(options.projectRoot)))();
          await importLegacyIamTables({
            store,
            projectRoot: options.projectRoot,
            projectDatabase: options.projectDatabase,
            logger: { info: message => options.logger?.info?.(message), warn: message => options.logger?.warn(message) },
          });
          await service.start();
          pending = undefined;
        } catch (error) {
          pending = `Console 访问控制不可用：${error instanceof Error ? error.message : String(error)}`;
          options.logger?.warn(`console iam: ${pending}`);
        }
      })();
      return activation;
    },
    async dispose() {
      service.stop();
      for (const dispose of disposers.reverse()) dispose();
      await store?.close().catch(() => undefined);
    },
  });
}

/** process env overlaid with the project `.env` (what `${…}` in config resolves against). */
export async function projectEnvironment(projectRoot: string): Promise<Readonly<Record<string, string | undefined>>> {
  const { parse } = await import('dotenv');
  const values: Record<string, string | undefined> = { ...process.env };
  for (const file of ['.env', `.env.${process.env.NODE_ENV === 'production' ? 'production' : 'development'}`]) {
    try {
      const { readFile } = await import('node:fs/promises');
      Object.assign(values, parse(await readFile(join(projectRoot, file), 'utf8')));
    } catch { /* missing layers are fine */ }
  }
  return values;
}
