import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { createConfigDocument } from '@zhin.js/config-file';
import { CONFIG_RPC, type ConsoleConfigSource, type ConsoleConfigProjectPatchResult, type ConsoleConfigApplyResult } from '@zhin.js/console-protocol';
import { createConfigCheckCommand } from './config-check.js';
import { loadHostHttpConfig } from '../utils/host-http.js';
import { requestPluginConsole, ConsoleRequestUnconfirmedError } from '../plugin-management/console-client.js';
import { parseConfigurationPath, jsonSchemaToConsoleSchema } from '../plugin-runtime/console/module.js';
import { patchOfflineConfiguration, requireConfigFile, validateOfflineConfiguration } from '../utils/config-offline.js';

type Options = { offline?: boolean; live?: string; tokenEnv?: string; json?: boolean; environment?: string; expectedRevision?: string };
type Connection = { host: string; token?: string; tokenEnvironment: string };

async function connection(options: Options): Promise<Connection> {
  if (options.offline && options.live) throw new TypeError('--offline 不能与 --live 同时使用');
  const tokenEnvironment = options.tokenEnv ?? 'ZHIN_CONSOLE_TOKEN';
  if (tokenEnvironment !== 'ZHIN_CONSOLE_TOKEN' && process.env[tokenEnvironment] === undefined) throw new TypeError('指定的 Console token 环境变量未设置');
  if (options.live) return { host: options.live, tokenEnvironment };
  const discovered = await loadHostHttpConfig(process.cwd());
  if (!discovered) throw new Error('未找到 Host 地址；请通过 --live <url> 指定运行中 Host，离线操作必须显式 --offline');
  return { host: discovered.baseUrl, token: process.env[tokenEnvironment] ?? discovered.token, tokenEnvironment };
}

function request<T>(target: Connection, data: Record<string, unknown>, requestId?: string): Promise<T> {
  return requestPluginConsole<T>(target.host, data, target.tokenEnvironment, { token: target.token, requestId });
}

function readPath(document: unknown, path: readonly string[]): unknown {
  let value = document;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('配置项不存在');
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)) throw new TypeError('无效的配置数组索引');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function commandPath(input: string): readonly string[] {
  const path = parseConfigurationPath(input);
  if (!path.length) throw new TypeError('配置路径不能为空');
  return path;
}

function print(value: unknown, options: Options): void {
  if (!options.json && value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') console.log(value.message);
  console.log(JSON.stringify(value, null, options.json ? undefined : 2));
}
function revision(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('无效的配置版本');
  return value;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const sourceRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const paths = (value: unknown): boolean => Array.isArray(value) && value.every(path => strings(path) && path.every(segment => segment.length > 0));
function receipt(value: unknown, expectedRevision: string): boolean {
  return record(value) && typeof value.operationId === 'string' && value.operationId.length > 0
    && value.sourceRevision === expectedRevision && value.saved === true
    && Number.isSafeInteger(value.generation) && Number(value.generation) > 0
    && Number.isSafeInteger(value.applicationRevision) && Number(value.applicationRevision) >= 0
    && Array.isArray(value.groups) && value.groups.every(group => record(group)
      && typeof group.id === 'string' && paths(group.paths) && strings(group.dependsOn)
      && typeof group.effect === 'string' && ['in-place', 'replace-resource', 'reconnect-endpoint', 'reload-plugin', 'restart-process'].includes(group.effect)
      && typeof group.status === 'string' && ['applied', 'restart-pending', 'blocked', 'failed', 'superseded', 'unknown'].includes(group.status)
      && (group.reasonCode === undefined || typeof group.reasonCode === 'string'));
}

/** Validate only configuration-mutation replies here; other Console consumers retain their contracts. */
function mutationResult(value: unknown, kind: 'patch', expectedRevision: string, requestId: string): ConsoleConfigProjectPatchResult;
function mutationResult(value: unknown, kind: 'apply', expectedRevision: string, requestId: string): ConsoleConfigApplyResult;
function mutationResult(value: unknown, kind: 'patch' | 'apply', expectedRevision: string, requestId: string): ConsoleConfigProjectPatchResult | ConsoleConfigApplyResult {
  let valid = false;
  if (record(value)) {
    if (value.status === 'applied' && kind === 'apply') valid = receipt(value.application, expectedRevision);
    else if (value.status === 'unconfirmed') valid = typeof value.message === 'string'
      && (kind === 'apply' || value.expectedRevision === expectedRevision);
    else if (value.status === 'conflict') valid = sourceRevision(value.revision) && typeof value.message === 'string'
      && (kind === 'apply' || (Array.isArray(value.current) && value.current.every(item => record(item) && paths([item.path]))));
    else if (value.status === 'invalid') valid = typeof value.message === 'string' && (kind === 'apply'
      || (sourceRevision(value.revision) && strings(value.missingEnv) && Array.isArray(value.errors)
        && value.errors.every(error => record(error) && typeof error.path === 'string' && typeof error.message === 'string')));
    else if (value.status === 'saved' && kind === 'patch') valid = sourceRevision(value.revision)
      && typeof value.restartRequired === 'boolean' && typeof value.message === 'string' && paths(value.paths) && strings(value.missingEnv)
      && (value.application === undefined || receipt(value.application, value.revision))
      && (value.applicationError === undefined || (typeof value.applicationError === 'string' && ['unconfirmed', 'superseded', 'invalid'].includes(value.applicationError)));
  }
  if (!valid) throw new ConsoleRequestUnconfirmedError(requestId);
  return value as ConsoleConfigProjectPatchResult | ConsoleConfigApplyResult;
}

function finish(result: ConsoleConfigProjectPatchResult | ConsoleConfigApplyResult, options: Options): void {
  print(result, options);
  if ((result.status !== 'saved' && result.status !== 'applied')
    || ('applicationError' in result && result.applicationError)
    || ('application' in result && result.application?.groups.some(group => ['unknown', 'failed', 'blocked', 'superseded'].includes(group.status)))) process.exitCode = 1;
}

/** Commands share one Host/CAS boundary; only explicit offline mutations use local documents. */
export function createConfigCommand(): Command {
  const command = new Command('config')
    .description('通过运行中 Host 管理配置；--offline 显式离线读写')
    .option('--offline', '仅操作本地配置；保存前完整校验，不请求生效')
    .option('--live <host-url>', '指定运行中 Host 的 HTTP(S) API 地址')
    .option('--token-env <name>', 'Console full token 所在环境变量', 'ZHIN_CONSOLE_TOKEN')
    .option('--environment <name>', '离线校验加载 .env.<name>', 'development')
    .option('--json', '仅输出紧凑的机器可读 JSON，不附加人读消息');

  const run = (action: (args: unknown[], options: Options) => Promise<void>) => async (...args: unknown[]) => {
    const invoked = args.at(-1) as Command;
    const options = invoked.optsWithGlobals<Options>();
    if (options.offline && options.live) throw new TypeError('--offline 不能与 --live 同时使用');
    await action(args, options);
  };
  const read = async (options: Options): Promise<Record<string, unknown>> => {
    if (options.offline) return (await createConfigDocument(requireConfigFile(process.cwd())).read()).document as Record<string, unknown>;
    const { source, format } = await request<ConsoleConfigSource>(await connection(options), { type: CONFIG_RPC.GET_SOURCE });
    const document: unknown = format === 'json' ? JSON.parse(source) : parseYaml(source);
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Host 返回的配置文件不是对象');
    return document as Record<string, unknown>;
  };

  command.addCommand(new Command('list').alias('ls').description('显示期望配置（默认读取 Host）')
    .action(run(async (_args, options) => { print(await read(options), options); })));
  command.addCommand(new Command('get').argument('<key>', '点路径或 JSON Pointer，例如 /plugins/com.example')
    .description('获取配置项').action(run(async ([key], options) => {
      print(readPath(await read(options), commandPath(String(key))), options);
    })));

  const mutate = (op: 'set' | 'remove') => run(async (args, options) => {
    const path = commandPath(String(args[0]));
    let value: unknown;
    if (op === 'set') {
      try { value = JSON.parse(String(args[1])); } catch { value = String(args[1]); }
    }
    const patches = op === 'set' ? [{ op, path, value }] : [{ op, path }];
    if (options.offline) {
      const result = await patchOfflineConfiguration(process.cwd(), patches, options.environment ?? 'development');
      print(result, options);
      if (result.status === 'unconfirmed') process.exitCode = 1;
      return;
    }
    const target = await connection(options);
    const source = await request<ConsoleConfigSource>(target, { type: CONFIG_RPC.GET_SOURCE });
    const expectedRevision = revision(source.revision);
    const requestId = randomUUID();
    try {
      const result = mutationResult(await request<unknown>(target, { type: CONFIG_RPC.PATCH_PROJECT, expectedRevision, patches }, requestId), 'patch', expectedRevision, requestId);
      if (result.status === 'unconfirmed') {
        print({ ...result, requestId }, options);
        process.exitCode = 1;
      } else finish(result, options);
    } catch (error) {
      if (!(error instanceof ConsoleRequestUnconfirmedError)) throw error;
      print({ status: 'unconfirmed', expectedRevision, requestId,
        message: '保存或生效结果未确认；请用 config status 核对版本及回执，不要直接重试。未回退到离线保存。' }, options);
      process.exitCode = 1;
    }
  });
  command.addCommand(new Command('set').argument('<key>').argument('<value>', 'JSON 值，解析失败时作为字符串')
    .description('校验、保存并按需应用配置').action(mutate('set')));
  command.addCommand(new Command('delete').alias('del').argument('<key>')
    .description('删除配置项；数组删除会收拢后续索引').action(mutate('remove')));

  command.addCommand(new Command('schema').argument('[section]', 'Host 配置区或精确插件实例键')
    .description('显示 Console 表单 Schema 投影，非完整验证器')
    .action(run(async ([section], options) => {
      if (options.offline) {
        const snapshot = await createConfigDocument(requireConfigFile(process.cwd())).read();
        const composed = await validateOfflineConfiguration(process.cwd(), snapshot.document, options.environment ?? 'development', snapshot.pluginOrder);
        const properties = composed.effectiveSchema.properties as Record<string, unknown>;
        const selected = section === undefined ? composed.effectiveSchema : properties[String(section)];
        if (!selected) throw new Error('配置区 Schema 不存在');
        // Keep local $ref resolution when projecting a selected Host section.
        print({ projection: 'console-form', schema: jsonSchemaToConsoleSchema(section === undefined ? selected
          : { ...(selected as object), $defs: composed.effectiveSchema.$defs }) }, options);
      } else {
        const schema = await request(await connection(options), section === undefined
          ? { type: 'schema:get-all' } : { type: 'schema:get', pluginName: String(section) });
        print({ projection: 'console-form', schema }, options);
      }
    })));
  command.addCommand(new Command('status').description('读取保存版本与最近一次生效回执')
    .action(run(async (_args, options) => {
      if (options.offline) {
        const source = await createConfigDocument(requireConfigFile(process.cwd())).read();
        print({ revision: source.revision, application: 'not-requested', message: '仅本地文件版本，未查询运行中 Host' }, options);
      } else {
        const { source: _source, ...status } = await request<ConsoleConfigSource>(await connection(options), { type: CONFIG_RPC.GET_SOURCE });
        print(status, options);
      }
    })));
  command.addCommand(new Command('apply').option('--expected-revision <revision>', '仅应用该已保存版本')
    .description('请求运行中 Host 应用已保存配置，不保存文件')
    .action(run(async (_args, options) => {
      if (options.offline) throw new TypeError('apply 需要运行中 Host，不能使用 --offline');
      const target = await connection(options);
      const expectedRevision = revision(options.expectedRevision ?? (await request<ConsoleConfigSource>(target, { type: CONFIG_RPC.GET_SOURCE })).revision);
      const requestId = randomUUID();
      try {
        const result = mutationResult(await request<unknown>(target, { type: CONFIG_RPC.APPLY, expectedRevision }, requestId), 'apply', expectedRevision, requestId);
        if (result.status === 'unconfirmed') {
          print({ ...result, expectedRevision, requestId }, options);
          process.exitCode = 1;
        } else finish(result, options);
      }
      catch (error) {
        if (!(error instanceof ConsoleRequestUnconfirmedError)) throw error;
        print({ status: 'unconfirmed', expectedRevision, requestId,
          message: '生效结果未确认；请用 config status 核对回执，不要直接重试。' }, options);
        process.exitCode = 1;
      }
    })));
  command.addCommand(new Command('path').description('显示本地配置文件路径')
    .action(() => { console.log(requireConfigFile(process.cwd())); }));
  command.addCommand(createConfigCheckCommand());
  return command;
}

export const configCommand = createConfigCommand();
