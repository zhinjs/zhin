/**
 * `zhin db console-role` and `zhin doctor --fix` (ADR 0059 §4): create the restricted database
 * account raw Console SQL runs on (PostgreSQL / MySQL), with the main account, store its password
 * in `.env` and reference it from `database.console`. Never run at instance start: the instance
 * only probes the account (and refreshes PostgreSQL grants).
 */
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { DEFAULT_ROOT_CONFIG_FILE_NAME } from '@zhin.js/plugin-runtime';
import {
  consoleRoleName,
  generateConsolePassword,
  planConsoleRole,
  provisionConsoleRole,
  scrubSecret,
  type ConsoleCredentialDialect,
} from '@zhin.js/database';
import { ConsoleConfigurationStore } from '../config/configuration.js';
import { readEnvFile, writeEnvFile } from '../config/environment-files.js';
import { upsertDotenv } from '../iam/setup-service.js';
import { IAM_TABLES } from '../iam/tables.js';
import { findConfigFile } from '../project/config-file.js';
import { loadExpandedProjectConfig, resolveProjectDatabaseConfig } from './config.js';
import { ProjectDatabase } from './project-database.js';

export const CONSOLE_ROLE_USER_ENV = 'ZHIN_DB_CONSOLE_USER';
export const CONSOLE_ROLE_PASSWORD_ENV = 'ZHIN_DB_CONSOLE_PASSWORD';
/** Stands for the password in `--print-sql` output (the real one is only written to `.env`). */
export const CONSOLE_ROLE_PASSWORD_PLACEHOLDER = `<${CONSOLE_ROLE_PASSWORD_ENV}>`;

export class ConsoleRoleError extends Error {
  constructor(readonly code: 'unsupported' | 'unavailable' | 'pending_migration' | 'denied', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConsoleRoleError';
  }
}

export interface SetupConsoleRoleOptions {
  readonly projectRoot: string;
  /** Selects `.env.<environment>` for `${…}` (default `development`). */
  readonly environment?: string;
  /** Role name (default `zhin_console_<hash of the project root>`). */
  readonly role?: string;
  /**
   * Do not create the account: write the password to `.env` and the reference to the config,
   * and return the statements for a DBA (password shown as {@link CONSOLE_ROLE_PASSWORD_PLACEHOLDER}).
   */
  readonly printSql?: boolean;
}

export interface SetupConsoleRoleResult {
  readonly dialect: ConsoleCredentialDialect;
  readonly user: string;
  /** Created / rotated by this run (false with `printSql`). */
  readonly provisioned: boolean;
  /** The statements (password replaced by the placeholder). */
  readonly statements: readonly string[];
  readonly envFile: string;
}

const ENV_REFERENCE = { user: `\${${CONSOLE_ROLE_USER_ENV}}`, password: `\${${CONSOLE_ROLE_PASSWORD_ENV}}` } as const;

export async function setupConsoleRole(options: SetupConsoleRoleOptions): Promise<SetupConsoleRoleResult> {
  const { projectRoot } = options;
  const expanded = await loadExpandedProjectConfig(projectRoot, options.environment ?? 'development');
  const config = await resolveProjectDatabaseConfig(projectRoot, expanded);
  if (config.dialect !== 'pg' && config.dialect !== 'mysql') {
    throw new ConsoleRoleError('unsupported', `项目数据库是 ${config.dialect}：只有 PostgreSQL / MySQL 需要受限账号（SQLite 的 Console 账号在另一个文件里，且实例连接拒绝 ATTACH）`);
  }
  const dialect = config.dialect;
  const main = new ProjectDatabase(config);
  try {
    await main.start();
  } catch (error) {
    throw new ConsoleRoleError('unavailable', `无法用主账号连接项目数据库：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const password = generateConsolePassword();
  let statements: readonly string[];
  let user: string;
  try {
    // The old console_* tables would be inside a MySQL database-wide grant: import them first.
    const legacy = await main.tableExists(Object.values(IAM_TABLES));
    if (legacy.length) {
      throw new ConsoleRoleError('pending_migration', `项目数据库里还有旧版的 Console 账号表（${legacy.join(', ')}）：先运行 zhin start 或 zhin console migrate 完成迁移`);
    }
    const run = (sql: string, params?: unknown[]) => main.query(sql, params);
    const request = { dialect, projectKey: projectRoot, password, ...(options.role ? { role: options.role } : {}) } as const;
    if (options.printSql) {
      const plan = await planConsoleRole(run, request);
      statements = plan.statements;
      user = plan.user;
    } else {
      try {
        const plan = await provisionConsoleRole(run, request);
        statements = plan.statements;
        user = plan.user;
      } catch (error) {
        // The message never carries the new password (provisionConsoleRole scrubs; scrub again here).
        throw new ConsoleRoleError('denied', scrubSecret(`主账号无法创建受限账号（${error instanceof Error ? error.message : String(error)}）；改用 zhin db console-role --print-sql 把 SQL 交给 DBA 执行`, [password]));
      }
    }
  } catch (error) {
    if (error instanceof ConsoleRoleError) throw error;
    throw new ConsoleRoleError('unavailable', scrubSecret(error instanceof Error ? error.message : String(error), [password]));
  } finally {
    await main.stop().catch(() => undefined);
  }
  // The password lives only in .env (ADR 0057); the config references it.
  await writeEnvFile(projectRoot, '.env', upsertDotenv(await readEnvFile(projectRoot, '.env'), {
    [CONSOLE_ROLE_USER_ENV]: user,
    [CONSOLE_ROLE_PASSWORD_ENV]: password,
  }));
  const store = new ConsoleConfigurationStore({
    projectRoot,
    document: createConfigDocument(join(projectRoot, findConfigFile(projectRoot) ?? DEFAULT_ROOT_CONFIG_FILE_NAME)),
  });
  const document = await store.readDocument();
  const block = document.database && typeof document.database === 'object' && !Array.isArray(document.database)
    ? document.database as Record<string, unknown>
    : { dialect };
  await store.setKey('database', { ...block, console: { ...ENV_REFERENCE } });
  return Object.freeze({
    dialect,
    user,
    provisioned: !options.printSql,
    // PostgreSQL statements carry a SCRAM verifier, never the password; MySQL's are shown with a placeholder.
    statements: Object.freeze(statements.map(statement => scrubSecret(statement, [password]).split('[redacted]').join(CONSOLE_ROLE_PASSWORD_PLACEHOLDER))),
    envFile: '.env',
  });
}

/** The default role name of a project (what `zhin db console-role` creates). */
export function defaultConsoleRoleName(projectRoot: string): string {
  return consoleRoleName(projectRoot);
}
