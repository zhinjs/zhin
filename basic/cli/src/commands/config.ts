import { Command, Option } from 'commander';
import { randomUUID } from 'node:crypto';
import {
  CONFIG_RPC, type ConsoleConfigPatchOperation, type ConsoleConfigProjectPatchResult, type ConsoleConfigProjectRead,
  type ConsoleConfigSource,
} from '@zhin.js/console-protocol';
import { configCheckCommand } from './config-check.js';
import { loadHostHttpConfig } from '../utils/host-http.js';
import {
  ConsoleAuthenticationError, ConsoleConnectionError, ConsoleRequestUnconfirmedError, ConsoleRpcError, requestPluginConsole,
} from '../plugin-management/console-client.js';
import { parseConfigurationPath } from '../plugin-runtime/console/configuration-path.js';
import { createOfflineConfigurationStore, ENVIRONMENT_NAME, requireConfigFile } from '../utils/config-offline.js';

/**
 * Public exit-code contract of `zhin config get|set|unset|list` (documented in docs/cli).
 * 1 covers every other failure (usage, not found, authentication, authoritative Host rejection) and a write
 * that was saved but not applied (superseded, or a failed/blocked group): the file was written in that case.
 */
export const CONFIG_EXIT_CODES = Object.freeze({
  ok: 0,
  error: 1,
  restartPending: 3,
  conflict: 4,
  invalid: 5,
  unknown: 6,
  notConnected: 7,
} as const);

type Options = {
  offline?: boolean; host?: string; live?: string; tokenEnv?: string; json?: boolean; environment?: string; reveal?: boolean;
};
type Connection = { host: string; token?: string; tokenEnvironment: string };
type Outcome = Readonly<Record<string, unknown> & { status: string; message: string }>;

class ConfigCommandError extends Error {
  constructor(readonly outcome: Outcome, readonly exitCode: number) {
    super(outcome.message);
  }
}

const NOT_CONNECTED_MESSAGE = '未连接到运行中的 Host，未发送任何请求，文件未修改；如确认要离线操作，请显式加 --offline';

/** Verification evidence for operators: what to look up before deciding whether to resubmit. */
function evidence(outcome: Readonly<Record<string, unknown>>): string | undefined {
  const parts = (['requestId', 'expectedRevision'] as const)
    .filter(key => typeof outcome[key] === 'string').map(key => `${key}=${String(outcome[key])}`);
  return parts.length ? parts.join(' ') : undefined;
}

/** `--json` prints exactly one compact JSON object; otherwise only the human-readable lines. */
function emit(outcome: Readonly<Record<string, unknown>>, options: Options, human: string): void {
  if (options.json) { console.log(JSON.stringify(outcome)); return; }
  console.log(human);
  const line = evidence(outcome);
  if (line) console.error(line);
}

function usage(message: string): ConfigCommandError {
  return new ConfigCommandError({ status: 'usage', message }, CONFIG_EXIT_CODES.error);
}

async function connection(options: Options): Promise<Connection> {
  const tokenEnvironment = options.tokenEnv ?? 'ZHIN_CONSOLE_TOKEN';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnvironment)) throw usage('无效的 token 环境变量名');
  if (tokenEnvironment !== 'ZHIN_CONSOLE_TOKEN' && process.env[tokenEnvironment] === undefined) {
    throw usage(`指定的 Console token 环境变量 ${tokenEnvironment} 未设置`);
  }
  const explicit = options.host ?? options.live;
  if (explicit) return { host: explicit, token: process.env[tokenEnvironment], tokenEnvironment };
  const discovered = await loadHostHttpConfig(process.cwd());
  if (!discovered) {
    throw new ConfigCommandError({ status: 'not-connected',
      message: `未找到 Host 地址；请用 --host <url> 指定运行中的 Host。${NOT_CONNECTED_MESSAGE}` }, CONFIG_EXIT_CODES.notConnected);
  }
  // ZHIN_CONSOLE_TOKEN (or --token-env) wins over the project's http.token.
  return { host: discovered.baseUrl, token: process.env[tokenEnvironment] || discovered.token || undefined, tokenEnvironment };
}

/** Pre-mutation requests: a lost reply means nothing was written, so it is not `unknown`. */
async function read<T>(target: Connection, data: Record<string, unknown>): Promise<T> {
  try {
    return await requestPluginConsole<T>(target.host, data, target.tokenEnvironment, { token: target.token });
  } catch (error) {
    throw transportFailure(error, false);
  }
}

function transportFailure(error: unknown, dispatchedMutation: boolean, extra: Readonly<Record<string, unknown>> = {}): unknown {
  if (error instanceof ConsoleConnectionError) {
    return new ConfigCommandError({ status: 'not-connected', host: error.host, code: error.code ?? null, message: NOT_CONNECTED_MESSAGE },
      CONFIG_EXIT_CODES.notConnected);
  }
  if (error instanceof ConsoleAuthenticationError) {
    return new ConfigCommandError({ status: 'unauthorized', httpStatus: error.status,
      message: 'Host 拒绝了 Console 凭据（检查 ZHIN_CONSOLE_TOKEN / http.token）；未回退离线' }, CONFIG_EXIT_CODES.error);
  }
  if (error instanceof ConsoleRpcError) {
    return new ConfigCommandError({ status: 'rejected', ...extra, message: `Host 拒绝请求：${error.message}` }, CONFIG_EXIT_CODES.error);
  }
  if (error instanceof ConsoleRequestUnconfirmedError) {
    const httpStatus = error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus };
    return dispatchedMutation
      ? new ConfigCommandError({ status: 'unknown', ...extra, requestId: error.requestId, ...httpStatus,
        message: '结果未知：请求已发出但未收到确定回执。请先用 zhin config get 核对，勿重复提交；未回退离线、未重试。' }, CONFIG_EXIT_CODES.unknown)
      : new ConfigCommandError({ status: 'error', requestId: error.requestId, ...httpStatus,
        message: '未收到 Host 的有效响应；未发送任何写入' }, CONFIG_EXIT_CODES.error);
  }
  return error;
}

function commandPath(input: string): readonly string[] {
  let path: readonly string[];
  try { path = parseConfigurationPath(input); }
  catch { throw new ConfigCommandError({ status: 'invalid-path', message: `无效的配置路径：${input}` }, CONFIG_EXIT_CODES.error); }
  if (!path.length) throw new ConfigCommandError({ status: 'invalid-path', message: '配置路径不能为空' }, CONFIG_EXIT_CODES.error);
  return path;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const sourceRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const paths = (value: unknown): boolean => Array.isArray(value) && value.every(path => strings(path) && path.every(segment => segment.length > 0));
const GROUP_STATUSES = ['applied', 'restart-pending', 'blocked', 'failed', 'superseded', 'unknown'];
function receipt(value: unknown, expectedRevision: string): boolean {
  return record(value) && typeof value.operationId === 'string' && value.operationId.length > 0
    && value.sourceRevision === expectedRevision && value.saved === true
    && Number.isSafeInteger(value.generation) && Number(value.generation) > 0
    && Number.isSafeInteger(value.applicationRevision) && Number(value.applicationRevision) >= 0
    && Array.isArray(value.groups) && value.groups.every(group => record(group)
      && typeof group.id === 'string' && paths(group.paths) && strings(group.dependsOn)
      && typeof group.status === 'string' && GROUP_STATUSES.includes(group.status));
}

/** A structurally invalid mutation reply is not evidence of anything: it is `unknown`. */
function patchResult(value: unknown, expectedRevision: string): ConsoleConfigProjectPatchResult | undefined {
  if (!record(value)) return undefined;
  let valid = false;
  if (value.status === 'unconfirmed') valid = typeof value.message === 'string' && value.expectedRevision === expectedRevision;
  else if (value.status === 'conflict') valid = sourceRevision(value.revision) && typeof value.message === 'string'
    && Array.isArray(value.current) && value.current.every(item => record(item) && paths([item.path]));
  else if (value.status === 'invalid') valid = typeof value.message === 'string' && sourceRevision(value.revision)
    && strings(value.missingEnv) && Array.isArray(value.errors)
    && value.errors.every(error => record(error) && typeof error.path === 'string' && typeof error.message === 'string');
  else if (value.status === 'saved') valid = sourceRevision(value.revision)
    && typeof value.restartRequired === 'boolean' && typeof value.message === 'string' && paths(value.paths) && strings(value.missingEnv)
    && (value.application === undefined || receipt(value.application, value.revision as string))
    && (value.applicationError === undefined || (typeof value.applicationError === 'string'
      && ['unconfirmed', 'superseded', 'invalid'].includes(value.applicationError)));
  return valid ? value as ConsoleConfigProjectPatchResult : undefined;
}

/** Maps a Host patch receipt onto the public exit-code contract. */
export function configPatchExitCode(result: ConsoleConfigProjectPatchResult): number {
  switch (result.status) {
    case 'conflict': return CONFIG_EXIT_CODES.conflict;
    case 'invalid': return CONFIG_EXIT_CODES.invalid;
    case 'unconfirmed': return CONFIG_EXIT_CODES.unknown;
    case 'saved': {
      if (result.applicationError === 'unconfirmed') return CONFIG_EXIT_CODES.unknown;
      if (result.applicationError === 'invalid') return CONFIG_EXIT_CODES.invalid;
      if (result.applicationError === 'superseded') return CONFIG_EXIT_CODES.error;
      const groups = result.application?.groups ?? [];
      if (groups.some(group => group.status === 'unknown')) return CONFIG_EXIT_CODES.unknown;
      if (groups.some(group => ['failed', 'blocked', 'superseded'].includes(group.status))) return CONFIG_EXIT_CODES.error;
      if (result.restartRequired || groups.some(group => group.status === 'restart-pending')) return CONFIG_EXIT_CODES.restartPending;
      return CONFIG_EXIT_CODES.ok;
    }
  }
}

function patchMessage(result: ConsoleConfigProjectPatchResult, code: number): string {
  if (result.status === 'conflict') {
    return [`${result.message}（版本冲突，未保存）`,
      ...result.current.map(item => `  ${item.path.join('.')}: ${item.value === undefined ? '(不存在)' : JSON.stringify(item.value)}`)].join('\n');
  }
  if (result.status === 'invalid') {
    return [`${result.message}`, ...result.errors.map(error => `  ${error.path}: ${error.message}`)].join('\n');
  }
  if (result.status === 'unconfirmed') return '结果未知：Host 无法确认是否已保存。请先用 zhin config get 核对，勿重复提交。';
  if (code === CONFIG_EXIT_CODES.ok) return result.application ? '已保存并生效' : result.message;
  if (code === CONFIG_EXIT_CODES.restartPending) return '已保存；部分配置需重启进程后生效';
  if (code === CONFIG_EXIT_CODES.unknown) return '已保存，但生效结果未知；请先用 zhin config get 核对，勿重复提交';
  return result.message;
}

async function readProject(options: Options, path: readonly string[]): Promise<ConsoleConfigProjectRead> {
  const request = { path: [...path], reveal: options.reveal === true };
  if (options.offline) return createOfflineConfigurationStore(process.cwd(), options.environment ?? 'development').readProject(request);
  return read<ConsoleConfigProjectRead>(await connection(options), { type: CONFIG_RPC.GET_PROJECT, ...request });
}

async function mutate(options: Options, patches: readonly ConsoleConfigPatchOperation[]): Promise<void> {
  if (options.offline) {
    const store = createOfflineConfigurationStore(process.cwd(), options.environment ?? 'development');
    const { revision: expectedRevision } = await store.readProject({ path: [], reveal: true });
    const result = await store.patchProject({ expectedRevision, patches });
    const code = result.status === 'saved' ? CONFIG_EXIT_CODES.ok : configPatchExitCode(result);
    const outcome = result.status === 'saved'
      ? { status: 'saved', revision: result.revision, paths: result.paths, missingEnv: result.missingEnv, application: 'not-requested',
        message: '已离线保存；运行中的 Host 只有在 --watch config 或 Console「应用配置」之后才会生效' }
      : result;
    emit(outcome, options, result.status === 'saved' ? outcome.message as string : patchMessage(result, code));
    process.exitCode = code;
    return;
  }
  const target = await connection(options);
  const source = await read<ConsoleConfigSource>(target, { type: CONFIG_RPC.GET_SOURCE });
  if (!sourceRevision(source?.revision)) {
    throw new ConfigCommandError({ status: 'error', message: 'Host 返回了无效的配置版本；未发送任何写入' }, CONFIG_EXIT_CODES.error);
  }
  const expectedRevision = source.revision;
  const requestId = randomUUID();
  let reply: unknown;
  try {
    // Exactly one dispatch; the Host owns read-modify-write against expectedRevision.
    reply = await requestPluginConsole<unknown>(target.host, { type: CONFIG_RPC.PATCH_PROJECT, expectedRevision, patches },
      target.tokenEnvironment, { token: target.token, requestId });
  } catch (error) {
    throw transportFailure(error, true, { expectedRevision });
  }
  const result = patchResult(reply, expectedRevision);
  if (!result) throw transportFailure(new ConsoleRequestUnconfirmedError(requestId), true, { expectedRevision });
  const code = configPatchExitCode(result);
  // Every exit-6 outcome (unconfirmed write, unconfirmed application, unknown group) carries its evidence.
  emit(code === CONFIG_EXIT_CODES.unknown ? { ...result, requestId, expectedRevision } : result, options, patchMessage(result, code));
  process.exitCode = code;
}

function run(action: (args: unknown[], options: Options) => Promise<void>) {
  return async (...args: unknown[]) => {
    const invoked = args.at(-1) as Command;
    const options = invoked.optsWithGlobals<Options>();
    try {
      if (options.offline && (options.host || options.live)) throw usage('--offline 不能与 --host 同时使用');
      if (options.offline && !ENVIRONMENT_NAME.test(options.environment ?? 'development')) {
        throw usage(`无效的环境名称：${options.environment}（仅允许小写字母、数字和 -）`);
      }
      await action(args, options);
    } catch (error) {
      if (!(error instanceof ConfigCommandError)) throw error;
      if (options.json) console.log(JSON.stringify(error.outcome));
      else {
        console.error(error.outcome.message);
        const line = evidence(error.outcome);
        if (line) console.error(line);
      }
      process.exitCode = error.exitCode;
    }
  };
}

function printRead(result: ConsoleConfigProjectRead, options: Options, key?: string): void {
  if (!result.exists) {
    throw new ConfigCommandError({ status: 'not-found', path: result.path, message: `配置项不存在：${key}` }, CONFIG_EXIT_CODES.error);
  }
  console.log(JSON.stringify(result.value, null, options.json ? undefined : 2));
  if (!options.json && result.redacted) console.error('（敏感值已打码；需要原值请加 --reveal）');
}

/** `get|set|unset|list` go to the running Host by default; only an explicit `--offline` touches the local file. */
export function createConfigCommand(): Command {
  const command = new Command('config')
    .description('通过运行中的 Host 读取/修改配置；--offline 显式离线操作本地文件')
    .option('--offline', '不连接 Host：本地校验后保存（不启动 Runtime、不执行插件 setup，可能执行模块顶层代码），不请求生效')
    .option('--host <url>', '运行中 Host 的 HTTP(S) API 地址（默认按配置 http.* 推导）')
    .addOption(new Option('--live <url>', '--host 的别名（兼容）').hideHelp())
    .option('--token-env <name>', 'Console full token 所在环境变量（优先于配置 http.token）', 'ZHIN_CONSOLE_TOKEN')
    .option('--environment <name>', '--offline 校验时加载 .env.<name>', 'development')
    .option('--reveal', '读取时显示原值（默认按 Schema 打码敏感值）')
    .option('--json', '仅输出紧凑 JSON');

  command.addCommand(new Command('list').alias('ls').description('显示完整配置（敏感值默认打码）')
    .action(run(async (_args, options) => { printRead(await readProject(options, []), options); })));
  command.addCommand(new Command('get').argument('<key>', '点路径或 JSON Pointer，例如 log_level 或 /plugin/key.with.dot')
    .description('获取配置项（敏感值默认打码）')
    .action(run(async ([key], options) => { printRead(await readProject(options, commandPath(String(key))), options, String(key)); })));
  command.addCommand(new Command('set').argument('<key>', '点路径或 JSON Pointer').argument('<value>', 'JSON 值；解析失败时作为字符串')
    .description('校验、保存并按需生效（Host 未运行时失败，不回退离线）')
    .action(run(async ([key, raw], options) => {
      let value: unknown;
      try { value = JSON.parse(String(raw)); } catch { value = String(raw); }
      await mutate(options, [{ op: 'set', path: [...commandPath(String(key))], value }]);
    })));
  command.addCommand(new Command('unset').aliases(['delete', 'del']).argument('<key>', '点路径或 JSON Pointer')
    .description('删除配置项（数组删除会收拢后续索引）')
    .action(run(async ([key], options) => { await mutate(options, [{ op: 'remove', path: [...commandPath(String(key))] }]); })));
  command.addCommand(new Command('path').description('显示本地配置文件路径')
    .action(run(async () => {
      try { console.log(requireConfigFile(process.cwd())); }
      catch (error) {
        throw new ConfigCommandError({ status: 'error', message: error instanceof Error ? error.message : String(error) }, CONFIG_EXIT_CODES.error);
      }
    })));
  command.addCommand(configCheckCommand);
  return command;
}

export const configCommand = createConfigCommand();
