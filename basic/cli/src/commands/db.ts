/**
 * `zhin db console-role [--print-sql] [--role <name>]` (ADR 0059 §4): the restricted database
 * account raw Console SQL runs on (PostgreSQL / MySQL). Created with the main account; the
 * password goes to `.env`, `database.console` references it. `--print-sql` creates nothing and
 * prints the statements for a DBA. `zhin doctor --fix` runs the same action.
 */
import { Command } from 'commander';
import {
  CONSOLE_ROLE_PASSWORD_ENV,
  CONSOLE_ROLE_PASSWORD_PLACEHOLDER,
  ConsoleRoleError,
  setupConsoleRole,
  type SetupConsoleRoleResult,
} from '@zhin.js/gateway/database';

export interface DbCliIo {
  log(message: string): void;
  error(message: string): void;
}

export interface ConsoleRoleCommandOptions {
  readonly printSql?: boolean;
  readonly role?: string;
  /** Selects `.env.<environment>` for `${…}` (default from NODE_ENV). */
  readonly environment?: string;
}

const defaultIo: DbCliIo = { log: message => console.log(message), error: message => console.error(message) };

/** Lines `zhin db console-role` prints for a result (also used by `zhin doctor --fix`). */
export function describeConsoleRole(result: SetupConsoleRoleResult): string[] {
  if (!result.provisioned) {
    return [
      `-- 受限账号 ${result.user}（${result.dialect}）：请 DBA 用有建号权限的账号执行；`,
      `-- ${CONSOLE_ROLE_PASSWORD_PLACEHOLDER} 换成 ${result.envFile} 里 ${CONSOLE_ROLE_PASSWORD_ENV} 的值。`,
      ...result.statements.map(statement => `${statement};`),
      `-- 已写入 ${result.envFile} 与配置文件 database.console；执行完上述 SQL 后运行 zhin restart。`,
    ];
  }
  return [
    `已创建受限账号 ${result.user}（${result.dialect}），密码写入 ${result.envFile}，配置 database.console 引用它。`,
    '运行 zhin restart 后，Console 的原始 SQL 只用这个账号执行。',
  ];
}

export async function runConsoleRole(projectRoot: string, options: ConsoleRoleCommandOptions = {}, io: DbCliIo = defaultIo): Promise<number> {
  try {
    const result = await setupConsoleRole({
      projectRoot,
      environment: options.environment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      ...(options.role ? { role: options.role } : {}),
      ...(options.printSql ? { printSql: true } : {}),
    });
    for (const line of describeConsoleRole(result)) io.log(line);
    return 0;
  } catch (error) {
    if (error instanceof ConsoleRoleError || error instanceof TypeError) {
      io.error(error.message);
      return 1;
    }
    throw error;
  }
}

const consoleRoleCommand = new Command('console-role')
  .description('为 Console 的原始 SQL 创建受限数据库账号（PostgreSQL / MySQL，ADR 0059）')
  .option('--print-sql', '不建号，只打印 SQL 交给 DBA（仍写入 .env 与 database.console）')
  .option('--role <name>', '账号名（默认 zhin_console_<项目哈希>）')
  .action(async (raw: { printSql?: boolean; role?: string }) => {
    const code = await runConsoleRole(process.cwd(), { printSql: raw.printSql === true, ...(raw.role ? { role: raw.role } : {}) });
    if (code !== 0) process.exitCode = code;
  });

export const dbCommand = new Command('db')
  .description('项目数据库工具')
  .addCommand(consoleRoleCommand);
