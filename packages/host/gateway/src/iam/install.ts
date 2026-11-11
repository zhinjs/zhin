import { join } from 'node:path';
import type { HttpHost } from '@zhin.js/host-http';
import { readEnvFile, writeEnvFile } from '../config/environment-files.js';
import { normalizeBase } from '../http-response.js';
import { registerConsoleAuthRoutes } from './routes.js';
import { ConsoleIamService, type IamDatabase } from './service.js';
import { ConsoleSetupService, type SetupConfigPort } from './setup-service.js';
import { defineConsoleIamTables, type IamTableHost } from './tables.js';

export interface InstallConsoleIamOptions {
  /** Process database; tables are defined here, so call before it starts. */
  readonly database: IamDatabase & IamTableHost;
  /** Config file writer (ConsoleConfigurationStore). */
  readonly configStore: SetupConfigPort;
  readonly projectRoot: string;
  readonly apiBase?: string;
  readonly logger?: Readonly<{ warn(message: string): void }>;
  /** Process restart after the setup wizard changed the database. */
  readonly requestRestart?: () => void;
  /** `${…}` lookup for setup validation (defaults to process env + project `.env`). */
  readonly environment?: () => Promise<Readonly<Record<string, string | undefined>>>;
}

export interface ConsoleIamInstallation {
  readonly service: ConsoleIamService;
  readonly setup: ConsoleSetupService;
  /** Whether this database dialect can hold accounts. */
  readonly supported: boolean;
  /** Call once the database has started (idempotent). */
  activate(): Promise<void>;
  dispose(): void;
}

/**
 * The single wiring point of Console access control (ADR 0049) into a Host process:
 * tables, the session resolver behind `http.tokenRegistry`, `/auth/*` routes and the setup flow.
 * Depends only on host-http, the database port and config/env file IO.
 */
export function installConsoleIam(http: HttpHost, options: InstallConsoleIamOptions): ConsoleIamInstallation {
  const supported = defineConsoleIamTables(options.database);
  const service = new ConsoleIamService({
    database: options.database,
    projectRoot: options.projectRoot,
    onError: error => options.logger?.warn(`console iam: ${error instanceof Error ? error.message : String(error)}`),
  });
  const setup = new ConsoleSetupService({
    projectRoot: options.projectRoot,
    config: options.configStore,
    envFile: {
      read: () => readEnvFile(options.projectRoot, '.env'),
      write: content => writeEnvFile(options.projectRoot, '.env', content),
    },
    iam: () => (supported ? service : undefined),
    environment: options.environment ?? (() => projectEnvironment(options.projectRoot)),
  });
  const disposers: Array<() => void> = [];
  if (supported) disposers.push(http.tokenRegistry.useAccessProvider(service));
  else options.logger?.warn('console iam: the configured database cannot store Console users; run the setup wizard to choose sqlite/mysql/pg/mongodb');
  disposers.push(...registerConsoleAuthRoutes({
    http,
    base: normalizeBase(options.apiBase ?? '/api'),
    iam: () => (supported ? service : undefined),
    setup,
    ...(options.requestRestart ? { requestRestart: options.requestRestart } : {}),
  }));
  let activation: Promise<void> | undefined;
  return Object.freeze({
    service,
    setup,
    supported,
    activate() {
      if (!supported) return Promise.resolve();
      activation ??= service.start();
      return activation;
    },
    dispose() {
      service.stop();
      for (const dispose of disposers.reverse()) dispose();
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
