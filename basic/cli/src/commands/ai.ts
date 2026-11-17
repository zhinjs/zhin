/**
 * `zhin ai account …` — Host model accounts (#1250): list them, add / re-point ones that read a Host environment variable, test one.
 * `zhin ai purposes revert ambient-judge` — undo the ADR 0066 interjection judge migration (before a downgrade).
 *
 * Runs only over the project's gateway control socket (`.zhin/gateway.sock`) as the local owner:
 * the instance accepts these requests from no Console session. The CLI sends variable names, never
 * values, and does not import any IM layer (ADR 0054): it calls the running instance's routes.
 */
import { Command } from 'commander';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';
import { hostGet, hostPost, loadHostHttpConfig, type HostFetchResult, type HostHttpConfig } from '../utils/host-http.js';
import { normalizedTrigger, type AmbientJudgeView } from '../utils/ambient-judge-check.js';

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

/** One model account as `zhin ai account list` shows it: names of referenced variables, never values. */
export interface AccountListRow {
  readonly id: string;
  readonly name?: string;
  readonly serviceId: string;
  readonly service?: string;
  readonly method: string;
  readonly env: readonly string[];
  readonly status: string;
}

interface InferenceViewSlice {
  readonly services?: Readonly<Record<string, { readonly label?: string }>>;
  readonly accounts?: Readonly<Record<string, { readonly id: string; readonly label?: string; readonly serviceId: string;
    readonly authentication?: { readonly method?: string; readonly source?: string } }>>;
  readonly statuses?: Readonly<Record<string, { readonly status?: string; readonly environment?: 'present' | 'missing' }>>;
}

/** Variable names an `env://NAME` source or a `${NAME…}` expression reads. */
function referencedVariables(source: string | undefined): string[] {
  if (!source) return [];
  const direct = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(source)?.[1];
  if (direct) return [direct];
  return [...new Set([...source.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/gu)].map(match => match[1]!))];
}

const STATUS_TEXT: Readonly<Record<string, string>> = Object.freeze({
  ready: '可用', authenticated: '可用', 'exchange-pending': '登录中', 'not-authorized': '未授权',
  disconnected: '已断开', reauthorize: '需重新授权', uncertain: '状态未知',
});

/** Rows of the instance's model-management view, sorted by id. */
export function accountRows(view: InferenceViewSlice): AccountListRow[] {
  return Object.values(view.accounts ?? {}).map((account): AccountListRow => {
    const status = view.statuses?.[account.id];
    const service = view.services?.[account.serviceId];
    return {
      id: account.id,
      ...(account.label ? { name: account.label } : {}),
      serviceId: account.serviceId,
      ...(service?.label ? { service: service.label } : {}),
      method: account.authentication?.method ?? 'unknown',
      env: referencedVariables(account.authentication?.source),
      status: status?.status === 'not-authorized' && status.environment
        ? `environment-${status.environment}` : status?.status ?? 'unknown',
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function statusText(status: string): string {
  if (status === 'environment-present') return '待激活（环境变量已设置，首次调用或 zhin ai account test 时激活）';
  if (status === 'environment-missing') return '⚠ 环境变量未设置';
  return STATUS_TEXT[status] ?? status;
}

export async function runAccountList(input: Readonly<{ client: HostHttpConfig; json?: boolean; output?: AiOutput }>): Promise<boolean> {
  const output = input.output ?? processOutput;
  // The view is the management root itself (`GET {base}/agent/inference`).
  const root = { ...input.client, baseUrl: input.client.baseUrl.replace(/\/agent\/inference$/u, '') };
  const viewed = await hostGet<InferenceViewSlice>(root, '/agent/inference');
  if (!viewed.ok || !viewed.data) { fail(output, viewed); return false; }
  const rows = accountRows(viewed.data);
  if (input.json) { output.log(JSON.stringify(rows, null, 2)); return true; }
  if (!rows.length) {
    output.log('还没有 Host 模型账号。使用 zhin ai account add 添加，或在 Console「模型」中添加。');
    return true;
  }
  for (const row of rows) {
    output.log(`${row.id}${row.name ? `  ${row.name}` : ''}`);
    output.log(`  服务：${row.service ? `${row.service}（${row.serviceId}）` : row.serviceId}`);
    output.log(`  认证：${row.method}${row.env.length ? `，读取环境变量 ${row.env.join(', ')}` : ''}`);
    output.log(`  状态：${statusText(row.status)}`);
  }
  return true;
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

/** Why `zhin ai purposes revert ambient-judge` was refused, in words (ADR 0066 D5.5). */
const REVERT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  'no-migration': '没有可回退的插话判断迁移记录（从未迁移，或迁移没有成功）',
  'already-reverted': '插话判断迁移已经回退过',
  changed: '插话判断（purposes.ambient）在迁移后被修改过，不能自动回退；需要时可按迁移记录手动恢复',
  conflict: '模型配置正在被其他操作修改，请稍后重试',
  'not-committed': '没有写入成功，请重试',
  'invalid-graph': '迁移前的旧写法现在已不成立（例如它引用的模型配置已被删除）',
});

/**
 * `zhin ai purposes revert ambient-judge`: restores the purposes the ADR 0066 migration replaced,
 * only while `purposes.ambient` is unchanged since. The yml keys the migration read
 * (`ai.trigger.ambient.minConfidence` / `mode`) and that were removed since (`zhin doctor --fix`)
 * are written back first, under the configuration write lock; if that is impossible nothing is
 * reverted (M2). Run it before downgrading to a version without `purposes.ambient`.
 */
type AmbientYml = Record<string, unknown>;

function readAmbientYml(document: unknown): AmbientYml | undefined {
  return (document as { ai?: { trigger?: { ambient?: AmbientYml } } }).ai?.trigger?.ambient;
}

/** Writes the yml keys that are absent; returns the keys written and the ones present with another value. */
async function writeAmbientYml(configPath: string, values: Readonly<Record<string, unknown>>): Promise<Readonly<{ written: string[]; differing: string[] }>> {
  const config = createConfigDocument(configPath);
  const snapshot = await config.read();
  const ambient = readAmbientYml(snapshot.document);
  const missing = Object.keys(values).filter(key => !ambient || !Object.hasOwn(ambient, key));
  const differing = Object.keys(values).filter(key => ambient && Object.hasOwn(ambient, key) && normalizedTrigger(key, ambient[key]) !== values[key]);
  if (missing.length) {
    await (await config.prepare(snapshot, missing.map(key => ({ op: 'set' as const, path: ['ai', 'trigger', 'ambient', key], value: values[key] })))).commit();
  }
  return { written: missing, differing };
}

async function removeAmbientYml(configPath: string, keys: readonly string[]): Promise<void> {
  const config = createConfigDocument(configPath);
  const snapshot = await config.read();
  await (await config.prepare(snapshot, keys.map(key => ({ op: 'remove' as const, path: ['ai', 'trigger', 'ambient', key] })))).commit();
}

export async function runRevertAmbientJudge(input: Readonly<{ client: HostHttpConfig; configPath?: string; output?: AiOutput }>): Promise<boolean> {
  const output = input.output ?? processOutput;
  const viewed = await hostGet<AmbientJudgeView>(input.client, '/ambient-judge');
  if (!viewed.ok || !viewed.data) { fail(output, viewed); return false; }
  const migration = viewed.data.migration;
  const values = migration?.status === 'migrated' ? migration.triggerValues ?? {} : {};
  // No yml change is converted while this runs (N1); cleared at the end whatever happens.
  const pending = migration?.status === 'migrated';
  if (pending) await hostPost(input.client, '/cli/purposes/revert-ambient-judge/pending', { pending: true });
  try {
    let restored: string[] = [];
    if (Object.keys(values).length) {
      const manual = Object.entries(values).map(([key, value]) => `ai.trigger.ambient.${key}: ${JSON.stringify(value)}`).join('、');
      try {
        if (!input.configPath) throw new Error('未找到配置文件');
        restored = (await writeAmbientYml(input.configPath, values)).written;
      } catch (error) {
        output.error(`未回退：迁移时读入的 ${manual} 已不在配置文件里，且无法写回（${error instanceof Error ? error.message.split('\n')[0] : String(error)}）。`);
        output.error(`请先在 zhin.config.yml 的 ai.trigger.ambient 下手工加回 ${manual}，再重新运行本命令。`);
        process.exitCode = 1;
        return false;
      }
    }
    const reverted = await hostPost<{ status: 'reverted'; graphRevision: number; yml?: Record<string, unknown>; lost?: string[] } | { status: 'refused'; reason: string; path?: string }>(
      input.client, '/cli/purposes/revert-ambient-judge', {});
    if (!reverted.ok || !reverted.data || reverted.data.status !== 'reverted') {
      // Nothing was reverted: take back what was written to the file above.
      if (restored.length && input.configPath) await removeAmbientYml(input.configPath, restored).catch(() => undefined);
      if (!reverted.ok || !reverted.data) { fail(output, reverted); return false; }
      const refusal = reverted.data as { reason: string; path?: string };
      output.error(`未回退：${REVERT_REFUSALS[refusal.reason] ?? refusal.reason}${refusal.path ? `（位置 ${refusal.path}）` : ''}`);
      process.exitCode = 1;
      return false;
    }
    const done = reverted.data;
    // A purposes.ambient seeded before the migration: its threshold / mode go to the yml keys an older version reads (N2).
    const lost = [...(done.lost ?? [])];
    if (done.yml && Object.keys(done.yml).length) {
      try {
        if (!input.configPath) throw new Error('未找到配置文件');
        const { written, differing } = await writeAmbientYml(input.configPath, done.yml);
        restored = [...restored, ...written];
        for (const key of differing) lost.push(`ai.trigger.ambient.${key} 应为 ${JSON.stringify(done.yml[key])}（配置文件里是另一个值）`);
      } catch {
        for (const [key, value] of Object.entries(done.yml)) lost.push(`ai.trigger.ambient.${key}: ${JSON.stringify(value)}（无法写入配置文件）`);
      }
    }
    output.log(`已回退插话判断迁移：模型配置恢复为迁移前的旧写法（修订号 ${done.graphRevision}）。`);
    if (restored.length) output.log(`已把 ${restored.map(key => `ai.trigger.ambient.${key}`).join('、')} 写回配置文件。`);
    if (lost.length) {
      output.error('以下设置旧版本无法读取，降级后它们会失效或行为不同：');
      for (const line of lost) output.error(`  · ${line}`);
      output.error('降级前请手工处理：在 zhin.config.yml 的 ai.trigger.ambient 下补上上面列出的值，或在 Console 改成旧版本能表达的配置后再回退；处理完之前不要降级。');
      process.exitCode = 1;
      return true;
    }
    output.log('现在可以降级到旧版本。');
    output.log('不降级时，当前版本会按旧写法换算运行，行为不变；在 Console「插话判断」保存一次即改回新写法。');
    return true;
  } finally {
    if (pending) await hostPost(input.client, '/cli/purposes/revert-ambient-judge/pending', { pending: false }).catch(() => undefined);
  }
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

accountCommand.command('list')
  .description('列出 Host 模型账号：id、名称、服务、引用的环境变量名（不含值）与状态')
  .option('--json', '以 JSON 输出')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (options: { json?: boolean; cwd?: string }) => {
    const client = await requireLocal(options.cwd ?? process.cwd());
    if (client) await runAccountList({ client, json: options.json });
  });

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

const purposesCommand = new Command('purposes').description('模型用途（本机）');

purposesCommand.command('revert')
  .description('回退一次配置迁移：ambient-judge 把插话判断恢复为迁移前的旧写法（降级到旧版本前运行）')
  .argument('<migration>', '迁移名：ambient-judge')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .action(async (migration: string, options: { cwd?: string }) => {
    if (migration !== 'ambient-judge') {
      console.error(`未知的迁移：${migration}（可回退：ambient-judge）`);
      process.exitCode = 1;
      return;
    }
    const root = options.cwd ?? process.cwd();
    const client = await requireLocal(root);
    const configFile = findConfigFile(root);
    if (client) await runRevertAmbientJudge({ client, ...(configFile ? { configPath: join(root, configFile) } : {}) });
  });

export const aiCommand = new Command('ai').description('模型服务管理（本机）').addCommand(accountCommand).addCommand(purposesCommand);
