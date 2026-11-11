/**
 * `zhin console init` / `zhin console user …` (ADR 0049 §7): offline setup and rescue that open
 * the project database directly, without a running Host. Same ConsoleSetupService as `/auth/setup*`.
 */
import path from 'node:path';
import { Command } from 'commander';
import inquirer from 'inquirer';
import {
  CONSOLE_BUILTIN_ROLE_NAMES,
} from '@zhin.js/console-protocol';
import { DEFAULT_ROOT_CONFIG_FILE_NAME, expandEnvironmentValue } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '@zhin.js/gateway/config';
import { readEnvFile, writeEnvFile } from '@zhin.js/gateway/config';
import { projectEnvironment } from '@zhin.js/gateway/iam';
import { ConsoleIamService, IamError } from '@zhin.js/gateway/iam';
import { ConsoleSetupService, type SetupDatabaseField, type SetupDriver } from '@zhin.js/gateway/iam';
import { defineConsoleIamTables } from '@zhin.js/gateway/iam';
import { findConfigFile } from '@zhin.js/gateway/project';
import { loadHostHttpConfig } from '../utils/host-http.js';
import { importProjectInstanceCli, type ProjectDatabaseHost } from '../utils/project-instance.js';
import { recordOnboardingSteps, setupOnboardingDeps } from './setup-onboarding.js';

export interface ConsoleCliIo {
  log(message: string): void;
  error(message: string): void;
  /** Reads all of stdin (for `--password-stdin`). */
  readStdin(): Promise<string>;
  prompt<T extends Record<string, unknown>>(questions: readonly Record<string, unknown>[]): Promise<T>;
  /** True when a Host answers on the configured address. */
  hostRunning(projectRoot: string): Promise<boolean>;
}

export interface OpenedProject {
  readonly setup: ConsoleSetupService;
  readonly iam: ConsoleIamService | undefined;
  readonly dialect: string;
  close(): Promise<void>;
}

/** Opens the project database the same way `zhin runtime start` resolves it. */
export async function openProjectConsole(projectRoot: string): Promise<OpenedProject> {
  const configFile = path.join(projectRoot, findConfigFile(projectRoot) ?? DEFAULT_ROOT_CONFIG_FILE_NAME);
  const document = createConfigDocument(configFile);
  const configStore = new ConsoleConfigurationStore({ projectRoot, document });
  const environment = await projectEnvironment(projectRoot);
  const raw = (await document.read()).document;
  const expanded = expandEnvironmentValue(raw, key => environment[key]);
  // DatabaseHost is instance (IM) code until the gateway opens the database itself (B1.4).
  const instance = await importProjectInstanceCli(projectRoot);
  const resolved = await instance.resolveDatabaseConfig(projectRoot, expanded as never) as { dialect: string; filename?: unknown };
  // The Host runs from the project root; the CLI may not, so anchor a relative sqlite file there.
  const config = resolved.dialect === 'sqlite' && typeof resolved.filename === 'string' && !path.isAbsolute(resolved.filename)
    ? { ...resolved, filename: path.resolve(projectRoot, resolved.filename) }
    : resolved;
  const database = instance.createDatabaseHost(config as never) as ProjectDatabaseHost
    & Parameters<typeof defineConsoleIamTables>[0] & ConstructorParameters<typeof ConsoleIamService>[0]['database'];
  const supported = defineConsoleIamTables(database);
  let iam: ConsoleIamService | undefined;
  if (supported) {
    await database.start();
    iam = new ConsoleIamService({ database, projectRoot });
    await iam.start({ timers: false });
  }
  const setup = new ConsoleSetupService({
    projectRoot,
    config: configStore,
    envFile: { read: () => readEnvFile(projectRoot, '.env'), write: content => writeEnvFile(projectRoot, '.env', content) },
    iam: () => iam,
    environment: () => projectEnvironment(projectRoot),
  });
  return {
    setup,
    iam,
    dialect: database.dialect,
    close: async () => { iam?.stop(); if (supported) await database.stop(); },
  };
}

export const defaultConsoleCliIo: ConsoleCliIo = {
  log: message => console.log(message),
  error: message => console.error(message),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8');
  },
  prompt: questions => inquirer.prompt(questions as never) as never,
  hostRunning: async projectRoot => {
    try {
      const http = await loadHostHttpConfig(projectRoot);
      if (!http) return false;
      const origin = new URL(http.baseUrl).origin;
      const response = await fetch(`${origin}/pub/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  },
};

export interface ConsoleInitOptions {
  readonly status?: boolean;
  readonly database?: string;
  /** `--database-<field>` values keyed by field name. */
  readonly connection?: Readonly<Record<string, string>>;
  readonly passwordEnv?: string;
  readonly owner?: string;
  readonly displayName?: string;
  readonly passwordStdin?: boolean;
  readonly yes?: boolean;
}

type Opener = (projectRoot: string) => Promise<OpenedProject>;

function firstLine(text: string): string {
  return text.replace(/\r?\n$/u, '').split(/\r?\n/u)[0] ?? '';
}

/** `zhin console init`; returns the process exit code. */
export async function runConsoleInit(
  projectRoot: string,
  options: ConsoleInitOptions,
  io: ConsoleCliIo = defaultConsoleCliIo,
  open: Opener = openProjectConsole,
): Promise<number> {
  let project = await open(projectRoot);
  try {
    const status = await project.setup.status();
    if (options.status) {
      io.log(JSON.stringify(status, null, 2));
      return 0;
    }
    if (!status.setupRequired) {
      io.error('已初始化：请改用 `zhin console user …` 管理用户。');
      return 1;
    }
    const interactive = !options.yes && !options.database && !options.owner;
    // Onboarding steps 1–2 (ADR 0053 §5); the owner step follows IAM.
    const onboarding = setupOnboardingDeps.createService(projectRoot, () => !project.setup.setupRequired());
    // ---- step 1: database
    let databaseInput: { dialect: string; connection: Record<string, unknown> } | undefined;
    if (options.database) {
      const connection: Record<string, unknown> = { ...(options.connection ?? {}) };
      if (options.passwordEnv) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.passwordEnv)) throw new IamError('invalid_input', '--database-password-env 不是合法变量名');
        connection.password = `\${${options.passwordEnv}}`;
      }
      databaseInput = { dialect: options.database, connection };
    } else if (interactive) {
      io.log(`当前数据库：${status.database.dialect}（${status.database.source === 'config' ? '配置文件' : '默认'}）`);
      const { change } = await io.prompt<{ change: boolean }>([{
        type: 'confirm', name: 'change', message: '要更换数据库吗？', default: false,
      }]);
      if (change) databaseInput = await promptDatabase(project.setup, io);
    }
    if (databaseInput) {
      const tested = await project.setup.testDatabase(databaseInput);
      if (!tested.ok) {
        io.error(`数据库连接失败：${tested.error ?? 'unknown error'}`);
        return 1;
      }
      const applied = await project.setup.applyDatabase(databaseInput);
      io.log(`已写入数据库配置。${applied.notice}`);
      // Continue on the new database directly.
      await project.close();
      project = await open(projectRoot);
      if (!(await project.setup.status()).setupRequired) {
        io.error('新数据库里已有所有者：请改用 `zhin console user …`。');
        return 1;
      }
    }
    await recordOnboardingSteps(onboarding, {
      database: databaseInput || status.database.source === 'config' ? 'done' : 'skipped',
    }, setupOnboardingDeps.io);
    // ---- step 2: owner
    let username = options.owner;
    let displayName = options.displayName;
    let password: string | undefined;
    if (options.passwordStdin) password = firstLine(await io.readStdin());
    if (!username || password === undefined) {
      if (!interactive && !options.database && options.yes) {
        io.error('非交互初始化需要 --owner <name> 与 --password-stdin');
        return 1;
      }
      if (options.database && (!username || password === undefined)) {
        io.error('非交互初始化需要 --owner <name> 与 --password-stdin');
        return 1;
      }
      const answers = await io.prompt<{ username?: string; displayName?: string; password?: string; confirm?: string }>([
        ...(username ? [] : [{ type: 'input', name: 'username', message: '所有者用户名' }]),
        ...(displayName || username ? [] : [{ type: 'input', name: 'displayName', message: '显示名（可留空）' }]),
        ...(password === undefined ? [
          { type: 'password', name: 'password', message: '密码（至少 10 位）', mask: '*' },
          { type: 'password', name: 'confirm', message: '再次输入密码', mask: '*' },
        ] : []),
      ]);
      username ??= answers.username;
      displayName ??= answers.displayName || undefined;
      if (password === undefined) {
        if (answers.password !== answers.confirm) {
          io.error('两次输入的密码不一致');
          return 1;
        }
        password = answers.password;
      }
    }
    const { user } = await project.setup.createOwner({ username, password, displayName });
    io.log(`已创建所有者 ${user.username}。现在可以用它登录 Console。`);
    await recordOnboardingSteps(onboarding, {}, setupOnboardingDeps.io);
    if (databaseInput && await io.hostRunning(projectRoot)) {
      io.log('检测到 Host 正在运行：请重启它以使用新的数据库。');
    }
    return 0;
  } catch (error) {
    if (error instanceof IamError) {
      io.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await project.close();
  }
}

async function promptDatabase(setup: ConsoleSetupService, io: ConsoleCliIo): Promise<{ dialect: string; connection: Record<string, unknown> }> {
  const drivers = await setup.drivers();
  const { dialect } = await io.prompt<{ dialect: string }>([{
    type: 'list',
    name: 'dialect',
    message: '选择数据库',
    choices: drivers.map((driver: SetupDriver) => ({
      name: driver.available ? `${driver.label} — ${driver.description}` : `${driver.label}（需安装 pnpm add ${driver.missingPackage}）`,
      value: driver.dialect,
      disabled: driver.available ? false : `需安装 ${driver.missingPackage}`,
    })),
  }]);
  const driver = drivers.find(candidate => candidate.dialect === dialect)!;
  for (;;) {
    const connection = await io.prompt<Record<string, unknown>>(driver.fields.map((field: SetupDatabaseField) => ({
      type: field.secret ? 'password' : field.type === 'enum' ? 'list' : 'input',
      name: field.name,
      message: field.secret ? `${field.name}（写入 .env 的 ${field.env}）` : field.name,
      ...(field.default !== undefined ? { default: field.default } : {}),
      ...(field.options ? { choices: field.options } : {}),
      ...(field.secret ? { mask: '*' } : {}),
    })));
    const result = await setup.testDatabase({ dialect, connection });
    if (result.ok) {
      io.log(`连接成功（${result.latencyMs ?? 0} ms）`);
      return { dialect, connection };
    }
    io.error(`连接失败：${result.error ?? 'unknown error'}`);
    const { retry } = await io.prompt<{ retry: boolean }>([{ type: 'confirm', name: 'retry', message: '重新填写？', default: true }]);
    if (!retry) throw new IamError('invalid_input', '已取消');
  }
}

async function withProject<T>(projectRoot: string, open: Opener, io: ConsoleCliIo, run: (iam: ConsoleIamService) => Promise<T>): Promise<number> {
  const project = await open(projectRoot);
  try {
    if (!project.iam) {
      io.error(`当前数据库（${project.dialect}）不能存储 Console 用户；请先运行 zhin console init 选择 sqlite/mysql/pg/mongodb`);
      return 1;
    }
    await run(project.iam);
    return 0;
  } catch (error) {
    if (error instanceof IamError) {
      io.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await project.close();
  }
}

async function readPassword(io: ConsoleCliIo, fromStdin: boolean | undefined): Promise<string> {
  if (fromStdin) return firstLine(await io.readStdin());
  const { password, confirm } = await io.prompt<{ password: string; confirm: string }>([
    { type: 'password', name: 'password', message: '密码（至少 10 位）', mask: '*' },
    { type: 'password', name: 'confirm', message: '再次输入密码', mask: '*' },
  ]);
  if (password !== confirm) throw new IamError('invalid_input', '两次输入的密码不一致');
  return password;
}

async function requireUser(iam: ConsoleIamService, username: string) {
  const user = await iam.findUser(username);
  if (!user) throw new IamError('not_found', `用户不存在：${username}`);
  return user;
}

export const consoleUserActions = {
  async create(projectRoot: string, username: string, options: { role?: string; displayName?: string; passwordStdin?: boolean }, io = defaultConsoleCliIo, open: Opener = openProjectConsole) {
    return withProject(projectRoot, open, io, async iam => {
      const role = options.role ?? 'viewer';
      const password = await readPassword(io, options.passwordStdin);
      const user = await iam.createUser({ username, password, displayName: options.displayName, bindings: [{ role, scopeKind: 'global' }] });
      io.log(`已创建用户 ${user.username}（${role}）`);
    });
  },
  async passwd(projectRoot: string, username: string, options: { passwordStdin?: boolean }, io = defaultConsoleCliIo, open: Opener = openProjectConsole) {
    return withProject(projectRoot, open, io, async iam => {
      const user = await requireUser(iam, username);
      await iam.resetPassword(user.id, await readPassword(io, options.passwordStdin));
      io.log(`已重置 ${user.username} 的密码，其全部会话已失效`);
    });
  },
  async setDisabled(projectRoot: string, username: string, disabled: boolean, io = defaultConsoleCliIo, open: Opener = openProjectConsole) {
    return withProject(projectRoot, open, io, async iam => {
      const user = await requireUser(iam, username);
      await iam.setDisabled(user.id, disabled);
      io.log(`${user.username} 已${disabled ? '禁用' : '启用'}`);
    });
  },
  async list(projectRoot: string, io = defaultConsoleCliIo, open: Opener = openProjectConsole) {
    return withProject(projectRoot, open, io, async iam => {
      const users = await iam.listUsers();
      if (!users.length) io.log('（还没有用户，运行 zhin console init 初始化）');
      for (const user of users) {
        const roles = user.bindings.map(binding => binding.scope.kind === 'global' ? binding.role : `${binding.role}@${binding.scope.kind}:${binding.scope.key}`);
        io.log(`${user.username}\t${user.displayName}\t${user.disabled ? 'disabled' : 'enabled'}\t${roles.join(',') || '-'}`);
      }
    });
  },
};

const DATABASE_FIELDS = ['filename', 'mode', 'host', 'port', 'user', 'password', 'database', 'url', 'db-name'] as const;

function finish(code: number): void {
  if (code !== 0) process.exitCode = code;
}

const initCommand = new Command('init')
  .description('初始化 Console：选择数据库并创建第一个所有者（与 Console 初始化向导相同）')
  .option('--status', '只显示初始化状态')
  .option('--database <dialect>', '数据库：sqlite / mysql / pg / mongodb')
  .option('--database-password-env <VAR>', '密码引用已有环境变量（配置里写入 ${VAR}）')
  .option('--owner <name>', '所有者用户名')
  .option('--display-name <name>', '所有者显示名')
  .option('--password-stdin', '从标准输入读取密码')
  .option('-y, --yes', '非交互：不提问，缺少参数即失败');
for (const field of DATABASE_FIELDS) initCommand.option(`--database-${field} <value>`, `数据库连接字段 ${field}`);
initCommand.action(async (raw: Record<string, unknown>) => {
  const connection: Record<string, string> = {};
  for (const field of DATABASE_FIELDS) {
    const key = `database${field.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')}`;
    const value = raw[key];
    if (typeof value === 'string') connection[field === 'db-name' ? 'dbName' : field] = value;
  }
  finish(await runConsoleInit(process.cwd(), {
    status: raw.status === true,
    ...(typeof raw.database === 'string' ? { database: raw.database } : {}),
    connection,
    ...(typeof raw.databasePasswordEnv === 'string' ? { passwordEnv: raw.databasePasswordEnv } : {}),
    ...(typeof raw.owner === 'string' ? { owner: raw.owner } : {}),
    ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}),
    passwordStdin: raw.passwordStdin === true,
    yes: raw.yes === true,
  }));
});

const userCommand = new Command('user').description('离线管理 Console 用户（直接打开项目数据库）');
userCommand.command('create <username>')
  .description('创建用户')
  .option('--role <role>', `全局角色（${CONSOLE_BUILTIN_ROLE_NAMES.join(' / ')} 或自定义）`, 'viewer')
  .option('--display-name <name>', '显示名')
  .option('--password-stdin', '从标准输入读取密码')
  .action(async (username: string, raw: { role?: string; displayName?: string; passwordStdin?: boolean }) => {
    finish(await consoleUserActions.create(process.cwd(), username, raw));
  });
userCommand.command('passwd <username>')
  .description('重置密码（吊销该用户全部会话）')
  .option('--password-stdin', '从标准输入读取密码')
  .action(async (username: string, raw: { passwordStdin?: boolean }) => {
    finish(await consoleUserActions.passwd(process.cwd(), username, raw));
  });
userCommand.command('disable <username>').description('禁用用户').action(async (username: string) => {
  finish(await consoleUserActions.setDisabled(process.cwd(), username, true));
});
userCommand.command('enable <username>').description('启用用户').action(async (username: string) => {
  finish(await consoleUserActions.setDisabled(process.cwd(), username, false));
});
userCommand.command('list').description('列出用户').action(async () => {
  finish(await consoleUserActions.list(process.cwd()));
});

export const consoleCommand = new Command('console')
  .description('Console 访问控制：初始化与用户管理（ADR 0049）')
  .addCommand(initCommand)
  .addCommand(userCommand);
