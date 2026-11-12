/**
 * `zhin console init` / `zhin console user …` (ADR 0049 §7). With a gateway running for the
 * project they go through its local control socket (`gateway.console.*`, principal `'local'`):
 * the gateway's own setup / IAM services answer, so a database switch is applied live and the owner
 * state changes at once. Without one they open the project database directly (offline setup and
 * rescue). Both paths run the same ConsoleSetupService as `/auth/setup*`.
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
import { accountInputProblem, ConsoleIamService, IamError, type ConsoleUserView, type SetupDatabaseInput, type SetupStatus } from '@zhin.js/gateway/iam';
import { ConsoleSetupService, type SetupDatabaseField, type SetupDriver } from '@zhin.js/gateway/iam';
import { defineConsoleIamTables } from '@zhin.js/gateway/iam';
import {
  LOCAL_GATEWAY_RPC,
  LocalGatewayClient,
  LocalGatewayClientError,
  LocalGatewayRpcError,
} from '@zhin.js/gateway/local';
import { findConfigFile } from '@zhin.js/gateway/project';
import { ProjectDatabase, resolveProjectDatabaseConfig } from '@zhin.js/gateway/database';
import { loadHostHttpConfig } from '../utils/host-http.js';
import { describeGatewayError, probeGateway } from '../utils/gateway.js';
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

export type DatabaseProbe = Awaited<ReturnType<ConsoleSetupService['testDatabase']>>;

export interface ConsoleUserAdmin {
  list(): Promise<readonly ConsoleUserView[]>;
  create(input: Readonly<{ username: string; password: string; displayName?: string; role: string }>): Promise<ConsoleUserView>;
  /** Resets the password (revokes the user's sessions). */
  passwd(username: string, password: string): Promise<ConsoleUserView>;
  setDisabled(username: string, disabled: boolean): Promise<ConsoleUserView>;
}

/** The setup flow and user administration, through the running gateway or the database itself. */
export interface ConsoleAdmin {
  readonly via: 'gateway' | 'database';
  status(): Promise<SetupStatus>;
  drivers(): Promise<readonly SetupDriver[]>;
  testDatabase(input: SetupDatabaseInput): Promise<DatabaseProbe>;
  /** `switched`: the gateway already uses the new database (and restarts the instance). */
  applyDatabase(input: SetupDatabaseInput): Promise<{ notice: string; switched: boolean; restarting?: boolean }>;
  createOwner(input: Readonly<{ username: unknown; password: unknown; displayName?: unknown }>): Promise<{ user: ConsoleUserView }>;
  /** Undefined when the configured database cannot store Console users (direct access only). */
  readonly users: ConsoleUserAdmin | undefined;
  /** Dialect of the directly opened database (direct access only). */
  readonly dialect?: string;
  close(): Promise<void>;
}

/** Opens the project database the same way the gateway resolves it (ADR 0054 §7). */
export async function openProjectConsole(projectRoot: string): Promise<ConsoleAdmin> {
  const configFile = path.join(projectRoot, findConfigFile(projectRoot) ?? DEFAULT_ROOT_CONFIG_FILE_NAME);
  const document = createConfigDocument(configFile);
  const configStore = new ConsoleConfigurationStore({ projectRoot, document });
  const environment = await projectEnvironment(projectRoot);
  const raw = (await document.read()).document;
  const expanded = expandEnvironmentValue(raw, key => environment[key]);
  // Relative SQLite files are anchored at the project root, whatever the CLI's cwd.
  const database = new ProjectDatabase(await resolveProjectDatabaseConfig(projectRoot, expanded));
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
  const requireUser = async (service: ConsoleIamService, username: string) => {
    const user = await service.findUser(username);
    if (!user) throw new IamError('not_found', `用户不存在：${username}`);
    return user;
  };
  const users: ConsoleUserAdmin | undefined = iam && (service => ({
    list: () => service.listUsers(),
    create: input => service.createUser({ username: input.username, password: input.password, displayName: input.displayName, bindings: [{ role: input.role, scopeKind: 'global' }] }),
    passwd: async (username, password) => {
      const user = await requireUser(service, username);
      await service.resetPassword(user.id, password);
      return user;
    },
    setDisabled: async (username, disabled) => service.setDisabled((await requireUser(service, username)).id, disabled),
  }))(iam);
  return {
    via: 'database',
    status: () => setup.status(),
    drivers: () => setup.drivers(),
    testDatabase: input => setup.testDatabase(input),
    applyDatabase: async input => ({ notice: (await setup.applyDatabase(input)).notice, switched: false }),
    createOwner: input => setup.createOwner(input),
    users,
    dialect: database.dialect,
    close: async () => { iam?.stop(); if (supported) await database.stop(); },
  };
}

/** The running gateway's `gateway.console.*` over one local socket connection. */
export function gatewayConsoleAdmin(client: LocalGatewayClient): ConsoleAdmin {
  const call = <T>(type: string, data?: unknown): Promise<T> => client.request<T>(type, data);
  const user = async (type: string, data: unknown) => (await call<{ user: ConsoleUserView }>(type, data)).user;
  return {
    via: 'gateway',
    status: () => call(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_STATUS),
    drivers: () => call(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DRIVERS),
    testDatabase: input => call(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE_TEST, input),
    applyDatabase: input => call(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE, input),
    createOwner: input => call(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_OWNER, input),
    users: {
      list: async () => (await call<{ users: readonly ConsoleUserView[] }>(LOCAL_GATEWAY_RPC.CONSOLE_USER_LIST)).users,
      create: input => user(LOCAL_GATEWAY_RPC.CONSOLE_USER_CREATE, input),
      passwd: (username, password) => user(LOCAL_GATEWAY_RPC.CONSOLE_USER_PASSWD, { username, password }),
      setDisabled: (username, disabled) => user(LOCAL_GATEWAY_RPC.CONSOLE_USER_DISABLE, { username, disabled }),
    },
    close: async () => { client.close(); },
  };
}

export interface OpenConsoleAdminOptions {
  /** Socket owner check override (tests). */
  readonly uid?: () => number | undefined;
}

/**
 * Through the gateway when one runs for the project, else directly on the database. A gateway
 * that exists but cannot be used (other user, not answering) is an error: working on the files
 * behind its back would leave it on stale state.
 */
export async function openConsoleAdmin(projectRoot: string, options: OpenConsoleAdminOptions = {}): Promise<ConsoleAdmin> {
  const target = { root: projectRoot, ...(options.uid ? { uid: options.uid } : {}) };
  if (!await probeGateway(target)) return openProjectConsole(projectRoot);
  return gatewayConsoleAdmin(await LocalGatewayClient.connect(target));
}

/** Errors the commands report as a message (exit 1) instead of a stack. */
function reportable(error: unknown): string | undefined {
  if (error instanceof IamError) return error.message;
  if (error instanceof LocalGatewayRpcError) return error.message;
  if (error instanceof LocalGatewayClientError) return describeGatewayError(error);
  return undefined;
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
  /**
   * Read the database password from standard input. With `passwordStdin` too, the first line is
   * the database password and the second the owner password.
   */
  readonly databasePasswordStdin?: boolean;
  readonly owner?: string;
  readonly displayName?: string;
  readonly passwordStdin?: boolean;
  readonly yes?: boolean;
}

type Opener = (projectRoot: string) => Promise<ConsoleAdmin>;

function firstLine(text: string): string {
  return text.replace(/\r?\n$/u, '').split(/\r?\n/u)[0] ?? '';
}

/** `zhin console init`; returns the process exit code. */
export async function runConsoleInit(
  projectRoot: string,
  options: ConsoleInitOptions,
  io: ConsoleCliIo = defaultConsoleCliIo,
  open: Opener = openConsoleAdmin,
): Promise<number> {
  let project: ConsoleAdmin;
  try {
    project = await open(projectRoot);
  } catch (error) {
    const message = reportable(error);
    if (message === undefined) throw error;
    io.error(message);
    return 1;
  }
  try {
    const status = await project.status();
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
    const onboarding = setupOnboardingDeps.createService(projectRoot, async () => !(await project.status()).setupRequired);
    // ---- step 1: database
    let databaseInput: { dialect: string; connection: Record<string, unknown> } | undefined;
    const passwordSources = [
      options.connection?.password !== undefined,
      options.passwordEnv !== undefined,
      options.databasePasswordStdin === true,
    ].filter(Boolean).length;
    if (passwordSources > 1) {
      io.error('--database-password、--database-password-env 与 --database-password-stdin 只能选一个');
      return 1;
    }
    if (!options.database && (passwordSources > 0)) {
      io.error('数据库密码参数需要与 --database <dialect> 一起使用');
      return 1;
    }
    // One read serves both secrets: line 1 = database password, line 2 = owner password.
    const stdinLines = options.databasePasswordStdin || options.passwordStdin
      ? (await io.readStdin()).split(/\r?\n/u)
      : [];
    if (options.database) {
      const connection: Record<string, unknown> = { ...(options.connection ?? {}) };
      if (options.connection?.password !== undefined) {
        io.error('警告：--database-password 会把密码留在 shell 历史与进程列表里，不推荐；请改用 --database-password-env <VAR> 或 --database-password-stdin。');
      }
      if (options.passwordEnv) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.passwordEnv)) throw new IamError('invalid_input', '--database-password-env 不是合法变量名');
        connection.password = `\${${options.passwordEnv}}`;
      }
      if (options.databasePasswordStdin) {
        const databasePassword = stdinLines.shift() ?? '';
        if (!databasePassword) {
          io.error('--database-password-stdin：标准输入第一行为空');
          return 1;
        }
        // A literal secret: the setup service stores it in .env and writes ${VAR} into the config.
        connection.password = databasePassword;
      }
      databaseInput = { dialect: options.database, connection };
    } else if (interactive) {
      io.log(`当前数据库：${status.database.dialect}（${status.database.source === 'config' ? '配置文件' : '默认'}）`);
      const { change } = await io.prompt<{ change: boolean }>([{
        type: 'confirm', name: 'change', message: '要更换数据库吗？', default: false,
      }]);
      if (change) databaseInput = await promptDatabase(project, io);
    }
    // ---- step 2: owner — collected and checked before the database is switched or .env written
    let username = options.owner;
    let displayName = options.displayName;
    let password: string | undefined;
    if (options.passwordStdin) password = stdinLines.shift() ?? '';
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
    const ownerProblem = accountInputProblem({ username, password });
    if (ownerProblem) {
      io.error(`所有者账号无效：${ownerProblem}（数据库与 .env 未改动）`);
      return 1;
    }
    let switched = false;
    if (databaseInput) {
      const tested = await project.testDatabase(databaseInput);
      if (!tested.ok) {
        io.error(`数据库连接失败：${tested.error ?? 'unknown error'}`);
        return 1;
      }
      const applied = await project.applyDatabase(databaseInput);
      switched = applied.switched;
      io.log(`已写入数据库配置。${applied.notice}`);
      if (switched) {
        // The gateway reconnected before it answered; it serves the new database already.
        io.log(applied.restarting ? '网关已切换到新数据库，并在重启实例。' : '网关已切换到新数据库。');
      } else {
        // Continue on the new database directly.
        await project.close();
        project = await open(projectRoot);
      }
      if (!(await project.status()).setupRequired) {
        io.error('新数据库里已有所有者：请改用 `zhin console user …`。');
        return 1;
      }
    }
    await recordOnboardingSteps(onboarding, {
      database: databaseInput || status.database.source === 'config' ? 'done' : 'skipped',
    }, setupOnboardingDeps.io);
    const { user } = await project.createOwner({ username, password, displayName });
    io.log(`已创建所有者 ${user.username}。现在可以用它登录 Console。`);
    await recordOnboardingSteps(onboarding, {}, setupOnboardingDeps.io);
    if (databaseInput && !switched && await io.hostRunning(projectRoot)) {
      io.log('检测到 Host 正在运行：请重启它以使用新的数据库。');
    }
    return 0;
  } catch (error) {
    const message = reportable(error);
    if (message === undefined) throw error;
    io.error(message);
    return 1;
  } finally {
    await project.close();
  }
}

async function promptDatabase(setup: Pick<ConsoleAdmin, 'drivers' | 'testDatabase'>, io: ConsoleCliIo): Promise<{ dialect: string; connection: Record<string, unknown> }> {
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

async function withProject<T>(projectRoot: string, open: Opener, io: ConsoleCliIo, run: (users: ConsoleUserAdmin) => Promise<T>): Promise<number> {
  let project: ConsoleAdmin | undefined;
  try {
    project = await open(projectRoot);
    if (!project.users) {
      io.error(`当前数据库（${project.dialect ?? 'unknown'}）不能存储 Console 用户；请先运行 zhin console init 选择 sqlite/mysql/pg/mongodb`);
      return 1;
    }
    await run(project.users);
    return 0;
  } catch (error) {
    const message = reportable(error);
    if (message === undefined) throw error;
    io.error(message);
    return 1;
  } finally {
    await project?.close();
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

export const consoleUserActions = {
  async create(projectRoot: string, username: string, options: { role?: string; displayName?: string; passwordStdin?: boolean }, io = defaultConsoleCliIo, open: Opener = openConsoleAdmin) {
    return withProject(projectRoot, open, io, async users => {
      const role = options.role ?? 'viewer';
      const password = await readPassword(io, options.passwordStdin);
      const user = await users.create({ username, password, ...(options.displayName ? { displayName: options.displayName } : {}), role });
      io.log(`已创建用户 ${user.username}（${role}）`);
    });
  },
  async passwd(projectRoot: string, username: string, options: { passwordStdin?: boolean }, io = defaultConsoleCliIo, open: Opener = openConsoleAdmin) {
    return withProject(projectRoot, open, io, async users => {
      const password = await readPassword(io, options.passwordStdin);
      const user = await users.passwd(username, password);
      io.log(`已重置 ${user.username} 的密码，其全部会话已失效`);
    });
  },
  async setDisabled(projectRoot: string, username: string, disabled: boolean, io = defaultConsoleCliIo, open: Opener = openConsoleAdmin) {
    return withProject(projectRoot, open, io, async users => {
      const user = await users.setDisabled(username, disabled);
      io.log(`${user.username} 已${disabled ? '禁用' : '启用'}`);
    });
  },
  async list(projectRoot: string, io = defaultConsoleCliIo, open: Opener = openConsoleAdmin) {
    return withProject(projectRoot, open, io, async users => {
      const all = await users.list();
      if (!all.length) io.log('（还没有用户，运行 zhin console init 初始化）');
      for (const user of all) {
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
  .option('--database-password-env <VAR>', '数据库密码引用已有环境变量（配置里写入 ${VAR}；推荐）')
  .option('--database-password-stdin', '从标准输入第一行读取数据库密码（写入 .env，配置里写 ${VAR}；推荐）')
  .option('--owner <name>', '所有者用户名')
  .option('--display-name <name>', '所有者显示名')
  .option('--password-stdin', '从标准输入读取所有者密码（与 --database-password-stdin 同用时读第二行）')
  .option('-y, --yes', '非交互：不提问，缺少参数即失败');
for (const field of DATABASE_FIELDS) {
  initCommand.option(`--database-${field} <value>`, field === 'password'
    // Kept for compatibility; a secret on the command line ends up in shell history and `ps`.
    ? '数据库密码（不推荐：会留在 shell 历史与进程列表里；请用 --database-password-env 或 --database-password-stdin）'
    : `数据库连接字段 ${field}`);
}
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
    databasePasswordStdin: raw.databasePasswordStdin === true,
    ...(typeof raw.owner === 'string' ? { owner: raw.owner } : {}),
    ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}),
    passwordStdin: raw.passwordStdin === true,
    yes: raw.yes === true,
  }));
});

const userCommand = new Command('user').description('管理 Console 用户（网关运行时经由网关，否则直接打开项目数据库）');
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
