/**
 * `zhin ai account …` — Host model accounts that read a Host environment variable (#1250).
 *
 * Runs only over the project's gateway control socket (`.zhin/gateway.sock`) as the local owner:
 * the instance accepts these requests from no Console session. The CLI sends variable names, never
 * values, and does not import any IM layer (ADR 0054): it calls the running instance's routes.
 */
import { Command } from 'commander';
import { hostPost, loadHostHttpConfig, type HostFetchResult, type HostHttpConfig } from '../utils/host-http.js';

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export interface AiOutput {
  log(line: string): void;
  error(line: string): void;
}
const processOutput: AiOutput = { log: line => console.log(line), error: line => console.error(line) };

/** Local-socket client without any Console token: the gateway runs the request as the local owner. */
export async function localInstanceClient(root: string): Promise<HostHttpConfig | undefined> {
  const config = await loadHostHttpConfig(root).catch(() => null);
  // Never send ZHIN_CONSOLE_TOKEN here: these routes accept only the local socket principal.
  return config?.fetch ? { baseUrl: `${config.baseUrl}/agent/inference`, token: '', fetch: config.fetch } : undefined;
}

interface ProbeView {
  readonly status: 'ok' | 'failed';
  readonly kind?: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly durationMs: number;
}

/** One line for a connectivity test result (outcome class only). */
export function describeProbe(result: ProbeView): string {
  if (result.status === 'ok') return `连接测试成功（${result.durationMs}ms）`;
  const status = result.httpStatus ? ` HTTP ${result.httpStatus}` : '';
  const code = result.code ? ` ${result.code}` : '';
  return `连接测试失败：${result.kind ?? 'unknown'}${status}${code}（${result.durationMs}ms）`;
}

function fail(output: AiOutput, result: HostFetchResult<unknown>): void {
  output.error(result.error ?? `请求失败（HTTP ${result.status}）`);
  process.exitCode = 1;
}

export async function runAccountAdd(input: Readonly<{
  client: HostHttpConfig; service: string; env: string; name?: string; test?: boolean; output?: AiOutput;
}>): Promise<boolean> {
  const output = input.output ?? processOutput;
  if (!VARIABLE.test(input.env)) {
    output.error(`环境变量名不合法：${input.env}`);
    process.exitCode = 1;
    return false;
  }
  const added = await hostPost<{ accountId: string; serviceId: string; createdService: boolean; result: { status: string } }>(
    input.client, '/cli/account/add', { service: input.service, env: input.env, ...(input.name ? { label: input.name } : {}) });
  if (!added.ok || !added.data) { fail(output, added); return false; }
  if (added.data.result.status !== 'committed') {
    output.error(`账号未保存（${added.data.result.status}），请重试`);
    process.exitCode = 1;
    return false;
  }
  output.log(`已添加 Host 账号 ${added.data.accountId}（读取环境变量 ${input.env}${added.data.createdService ? `，新建服务 ${added.data.serviceId}` : ''}）`);
  output.log('账号还没有模型配置时，请在 Console「模型」中为它添加模型并绑定用途。');
  if (input.test) return runAccountTest({ client: input.client, account: added.data.accountId, output });
  return true;
}

export async function runAccountTest(input: Readonly<{ client: HostHttpConfig; account: string; output?: AiOutput }>): Promise<boolean> {
  const output = input.output ?? processOutput;
  const tested = await hostPost<{ result: ProbeView }>(input.client, '/account/test', { accountId: input.account }, 60_000);
  if (!tested.ok || !tested.data) {
    if (tested.status === 422) output.error('该账号还没有语言模型配置，无法测试连接；请先在 Console 为它添加模型');
    else fail(output, tested);
    process.exitCode = 1;
    return false;
  }
  const line = describeProbe(tested.data.result);
  if (tested.data.result.status === 'ok') output.log(line);
  else { output.error(line); process.exitCode = 1; }
  return tested.data.result.status === 'ok';
}

export async function runRenameEnv(input: Readonly<{
  client: HostHttpConfig; account: string; from: string; to: string; reauthorize?: boolean; output?: AiOutput;
}>): Promise<boolean> {
  const output = input.output ?? processOutput;
  if (!VARIABLE.test(input.from) || !VARIABLE.test(input.to)) {
    output.error('环境变量名不合法');
    process.exitCode = 1;
    return false;
  }
  const renamed = await hostPost<{ accountId: string; credential: 'pending' | 'kept' | 'reset'; result: { status: string } }>(
    input.client, '/cli/account/rename-env',
    { account: input.account, from: input.from, to: input.to, ...(input.reauthorize ? { reauthorize: true } : {}) });
  if (!renamed.ok || !renamed.data) { fail(output, renamed); return false; }
  if (renamed.data.result.status !== 'committed') {
    output.error(`引用未修改（${renamed.data.result.status}），请重试`);
    process.exitCode = 1;
    return false;
  }
  output.log(`账号 ${renamed.data.accountId} 现在读取 ${input.to}（原 ${input.from}）`);
  output.log({
    kept: '新变量的值与原凭据一致，凭据保持可用。',
    pending: '账号还没有激活凭据：下次调用或 zhin ai account test 时按新变量激活。',
    reset: '已清除旧凭据：下次调用或 zhin ai account test 时按新变量重新授权。',
  }[renamed.data.credential]);
  return true;
}

async function requireLocal(root: string): Promise<HostHttpConfig | undefined> {
  const client = await localInstanceClient(root);
  if (!client) {
    console.error('该命令只能经本机网关执行：请先在项目目录运行 zhin start');
    process.exitCode = 1;
  }
  return client;
}

const accountCommand = new Command('account').description('管理引用 Host 环境变量的模型账号（仅本机）');

accountCommand.command('add')
  .description('新增 Host API Key 账号，从 Host 环境变量读取密钥（不回显值）')
  .requiredOption('--service <service>', '已有服务的 id 或名称，或内置服务类型（如 openai、deepseek，使用官方地址）')
  .requiredOption('--env <NAME>', '环境变量名（如 OPENAI_API_KEY）')
  .option('--name <label>', '账号名称')
  .option('--test', '添加后立即做一次连接测试')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (options: { service: string; env: string; name?: string; test?: boolean; cwd?: string }) => {
    const client = await requireLocal(options.cwd ?? process.cwd());
    if (client) await runAccountAdd({ client, service: options.service, env: options.env, name: options.name, test: options.test });
  });

accountCommand.command('rename-env')
  .description('修改 Host 账号引用的环境变量名（账号身份不变，只换取值来源）')
  .argument('<account>', '账号 id 或名称')
  .argument('<OLD>', '当前引用的变量名')
  .argument('<NEW>', '新的变量名')
  .option('--reauthorize', '新变量的值与原凭据不同时，确认清除旧凭据并按新变量重新授权')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (account: string, from: string, to: string, options: { reauthorize?: boolean; cwd?: string }) => {
    const client = await requireLocal(options.cwd ?? process.cwd());
    if (client) await runRenameEnv({ client, account, from, to, reauthorize: options.reauthorize });
  });

accountCommand.command('test')
  .description('对账号做一次带工具的最小对话请求，成功时顺带激活凭据')
  .argument('<account>', '账号 id')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (account: string, options: { cwd?: string }) => {
    const client = await requireLocal(options.cwd ?? process.cwd());
    if (client) await runAccountTest({ client, account });
  });

export const aiCommand = new Command('ai').description('模型服务管理（本机）').addCommand(accountCommand);
