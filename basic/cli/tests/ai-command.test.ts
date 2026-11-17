import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountRows, describeProbe, runAccountAdd, runAccountList, runAccountTest, runRenameEnv, runRevertAmbientJudge, aiCommand } from '../src/commands/ai.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

function client(handler: (path: string, body: Record<string, unknown>) => { status: number; body: unknown }) {
  const requests: Array<{ path: string; body: Record<string, unknown>; authorization?: string }> = [];
  const config: HostHttpConfig = {
    baseUrl: 'http://gateway.local/api/agent/inference',
    token: '',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ path: url.pathname, body, ...(headers.Authorization ? { authorization: headers.Authorization } : {}) });
      const reply = handler(url.pathname, body);
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    },
  };
  return { config, requests };
}
function output() {
  const lines: string[] = [], errors: string[] = [];
  return { lines, errors, sink: { log: (line: string) => lines.push(line), error: (line: string) => errors.push(line) } };
}

afterEach(() => { process.exitCode = undefined; });

it('registers zhin ai account list / add / rename-env / test', () => {
  const account = aiCommand.commands.find(command => command.name() === 'account')!;
  expect(account.commands.map(command => command.name()).sort()).toEqual(['add', 'list', 'rename-env', 'test']);
});

it('adds a Host env account over the local socket with names only, then tests it on request', async () => {
  const { config, requests } = client(path => path.endsWith('/cli/account/add')
    ? { status: 200, body: { success: true, data: { accountId: 'account:1', serviceId: 'service:1', createdService: true, result: { status: 'committed' } } } }
    : { status: 200, body: { success: true, data: { result: { status: 'ok', durationMs: 12 } } } });
  const out = output();
  expect(await runAccountAdd({ client: config, service: 'openai', env: 'OPENAI_API_KEY', name: '主账号', test: true, output: out.sink })).toBe(true);
  expect(requests).toEqual([
    { path: '/api/agent/inference/cli/account/add', body: { service: 'openai', env: 'OPENAI_API_KEY', label: '主账号' } },
    { path: '/api/agent/inference/account/test', body: { accountId: 'account:1' } },
  ]);
  expect(out.lines.join('\n')).toContain('OPENAI_API_KEY');
  expect(out.lines.join('\n')).toContain('连接测试成功');
  expect(process.exitCode).toBeUndefined();
});

it('rejects an invalid variable name before calling the instance', async () => {
  const { config, requests } = client(() => ({ status: 500, body: {} }));
  const out = output();
  expect(await runAccountAdd({ client: config, service: 'openai', env: 'NOT-A-NAME', output: out.sink })).toBe(false);
  expect(requests).toEqual([]);
  expect(process.exitCode).toBe(1);
});

it('prints the instance refusal (e.g. not the local CLI channel) and fails', async () => {
  const { config } = client(() => ({ status: 403, body: { success: false, code: 'forbidden', reason: 'environment-local-only', error: '该操作只能由 Host 管理员在本机用 zhin 命令完成' } }));
  const out = output();
  expect(await runAccountAdd({ client: config, service: 'openai', env: 'OPENAI_API_KEY', output: out.sink })).toBe(false);
  expect(out.errors).toEqual(['该操作只能由 Host 管理员在本机用 zhin 命令完成']);
  expect(process.exitCode).toBe(1);
});

it('renames an env reference and explains the credential outcome', async () => {
  const { config, requests } = client(() => ({ status: 200, body: { success: true, data: { accountId: 'account:1', credential: 'reset', result: { status: 'committed' } } } }));
  const out = output();
  expect(await runRenameEnv({ client: config, account: 'main', from: 'OLD_API_KEY', to: 'NEW_API_KEY', reauthorize: true, output: out.sink })).toBe(true);
  expect(requests[0]).toEqual({ path: '/api/agent/inference/cli/account/rename-env', body: { account: 'main', from: 'OLD_API_KEY', to: 'NEW_API_KEY', reauthorize: true } });
  expect(out.lines.join('\n')).toContain('重新授权');
});

it('reports a failed connection test with its outcome class only', async () => {
  const { config } = client(() => ({ status: 200, body: { success: true, data: { result: { status: 'failed', kind: 'auth', httpStatus: 401, durationMs: 40 } } } }));
  const out = output();
  expect(await runAccountTest({ client: config, account: 'account:1', output: out.sink })).toBe(false);
  expect(out.errors).toEqual(['连接测试失败：auth HTTP 401（40ms）']);
  expect(describeProbe({ status: 'failed', kind: 'credential', code: 'not-authorized', durationMs: 1 })).toBe('连接测试失败：credential not-authorized（1ms）');
});

describe('zhin ai account list (#1250 ai-account-cli-no-list)', () => {
  const view = {
    services: { 'service:1': { label: 'OpenAI 官方' }, 'service:2': {} },
    accounts: {
      'account:2': { id: 'account:2', serviceId: 'service:2', authentication: { method: 'oauth' } },
      'account:1': { id: 'account:1', label: '主账号', serviceId: 'service:1', authentication: { method: 'api-key', source: 'env://OPENAI_API_KEY' } },
      'account:3': { id: 'account:3', serviceId: 'service:1', authentication: { method: 'api-key', source: '${PRIMARY_API_KEY:-${BACKUP_API_KEY}}' } },
    },
    statuses: {
      'account:1': { status: 'not-authorized', environment: 'missing' },
      'account:2': { status: 'ready' },
      'account:3': { status: 'ready' },
    },
  };

  it('reads the management view and shows id, name, service, variable names and status, never a value', async () => {
    const { config, requests } = client(() => ({ status: 200, body: { success: true, data: view } }));
    const out = output();
    expect(await runAccountList({ client: config, output: out.sink })).toBe(true);
    expect(requests.map(request => request.path)).toEqual(['/api/agent/inference']);
    const text = out.lines.join('\n');
    expect(text).toContain('account:1  主账号');
    expect(text).toContain('服务：OpenAI 官方（service:1）');
    expect(text).toContain('读取环境变量 OPENAI_API_KEY');
    expect(text).toContain('⚠ 环境变量未设置');
    expect(text).toContain('读取环境变量 PRIMARY_API_KEY, BACKUP_API_KEY');
    expect(text.indexOf('account:1')).toBeLessThan(text.indexOf('account:2'));
  });

  it('prints JSON rows with --json', async () => {
    const { config } = client(() => ({ status: 200, body: { success: true, data: view } }));
    const out = output();
    expect(await runAccountList({ client: config, json: true, output: out.sink })).toBe(true);
    expect(JSON.parse(out.lines.join('\n'))).toEqual(accountRows(view));
    expect(accountRows(view)[0]).toEqual({ id: 'account:1', name: '主账号', serviceId: 'service:1', service: 'OpenAI 官方',
      method: 'api-key', env: ['OPENAI_API_KEY'], status: 'environment-missing' });
  });

  it('prints the instance message on failure', async () => {
    const { config } = client(() => ({ status: 503, body: { success: false, code: 'unavailable', error: '模型服务管理暂时不可用' } }));
    const out = output();
    expect(await runAccountList({ client: config, output: out.sink })).toBe(false);
    expect(out.errors).toEqual(['模型服务管理暂时不可用']);
    expect(process.exitCode).toBe(1);
  });
});

describe('zhin ai purposes revert ambient-judge (ADR 0066 D5.5)', () => {
  it('is registered under purposes', () => {
    const purposes = aiCommand.commands.find(command => command.name() === 'purposes')!;
    expect(purposes.commands.map(command => command.name())).toEqual(['revert']);
  });

  it('asks the instance over the local socket and reports the restored revision', async () => {
    const { config, requests } = client(path => path.endsWith('/ambient-judge')
      ? { status: 200, body: { success: true, data: { migration: { status: 'migrated', at: 1 } } } }
      : { status: 200, body: { success: true, data: { status: 'reverted', graphRevision: 7 } } });
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(true);
    // The pending mark brackets the revert (N1): set first, cleared last.
    expect(requests.map(request => [request.path, request.body])).toEqual([
      ['/api/agent/inference/ambient-judge', {}],
      ['/api/agent/inference/cli/purposes/revert-ambient-judge/pending', { pending: true }],
      ['/api/agent/inference/cli/purposes/revert-ambient-judge', {}],
      ['/api/agent/inference/cli/purposes/revert-ambient-judge/pending', { pending: false }],
    ]);
    expect(out.lines.join('\n')).toContain('现在可以降级');
    expect(out.lines.join('\n')).toContain('修订号 7');
    expect(process.exitCode).toBeUndefined();
  });

  it('writes back the yml keys the migration read and doctor --fix removed, then reverts (M2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ambient-revert-'));
    try {
      const file = join(dir, 'zhin.config.yml');
      await writeFile(file, 'ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n');
      const { config } = client(path => path.endsWith('/ambient-judge')
        ? { status: 200, body: { success: true, data: { migration: { status: 'migrated', at: 1, triggerKeys: ['ai.trigger.ambient.mode'], triggerValues: { mode: 'shadow' } } } } }
        : { status: 200, body: { success: true, data: { status: 'reverted', graphRevision: 3 } } });
      const out = output();
      expect(await runRevertAmbientJudge({ client: config, configPath: file, output: out.sink })).toBe(true);
      expect(await readFile(file, 'utf8')).toContain('mode: shadow');
      expect(out.lines.join('\n')).toContain('写回配置文件');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses without reverting when the yml keys cannot be written back, and takes back a write when the revert is refused', async () => {
    const view = { status: 200, body: { success: true, data: { migration: { status: 'migrated', at: 1, triggerKeys: ['ai.trigger.ambient.mode'], triggerValues: { mode: 'shadow' } } } } };
    const unwritable = client(() => view);
    const out = output();
    expect(await runRevertAmbientJudge({ client: unwritable.config, output: out.sink })).toBe(false);
    // No revert was asked; the pending mark was set and cleared.
    expect(unwritable.requests.map(request => request.path)).toEqual(['/api/agent/inference/ambient-judge',
      '/api/agent/inference/cli/purposes/revert-ambient-judge/pending', '/api/agent/inference/cli/purposes/revert-ambient-judge/pending']);
    expect(out.errors.join('\n')).toContain('手工加回 ai.trigger.ambient.mode: "shadow"');
    process.exitCode = undefined;
    const dir = await mkdtemp(join(tmpdir(), 'ambient-revert-'));
    try {
      const file = join(dir, 'zhin.config.yml');
      const original = 'ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n';
      await writeFile(file, original);
      const refused = client(path => path.endsWith('/ambient-judge') ? view : { status: 200, body: { success: true, data: { status: 'refused', reason: 'changed' } } });
      expect(await runRevertAmbientJudge({ client: refused.config, configPath: file, output: output().sink })).toBe(false);
      expect(await readFile(file, 'utf8')).not.toContain('mode');
      // The pending mark is cleared after a refused revert too.
      expect(refused.requests.at(-1)).toEqual({ path: '/api/agent/inference/cli/purposes/revert-ambient-judge/pending', body: { pending: false } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('explains a refusal (changed since the migration) and exits 1', async () => {
    const { config } = client(path => path.endsWith('/ambient-judge') ? { status: 200, body: { success: true, data: {} } }
      : { status: 200, body: { success: true, data: { status: 'refused', reason: 'changed' } } });
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(false);
    expect(out.errors.join('\n')).toContain('被修改过');
    expect(process.exitCode).toBe(1);
  });

  it('writes the seeded threshold / mode to the yml and, when something cannot be expressed, does not say a downgrade is safe (N2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ambient-revert-'));
    try {
      const file = join(dir, 'zhin.config.yml');
      await writeFile(file, 'ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n');
      const { config } = client(path => path.endsWith('/ambient-judge')
        ? { status: 200, body: { success: true, data: { migration: { status: 'migrated', at: 1 } } } }
        : { status: 200, body: { success: true, data: { status: 'reverted', graphRevision: 4, yml: { mode: 'shadow' }, lost: ['对照模型 spare（旧版本只能用决策模型陪跑）'] } } });
      const out = output();
      expect(await runRevertAmbientJudge({ client: config, configPath: file, output: out.sink })).toBe(true);
      expect(await readFile(file, 'utf8')).toContain('mode: shadow');
      expect(out.errors.join('\n')).toContain('旧版本无法读取');
      expect(out.errors.join('\n')).toContain('对照模型 spare');
      expect(out.lines.join('\n')).not.toContain('可以降级');
      expect(process.exitCode).toBe(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
