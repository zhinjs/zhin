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

describe('zhin ai purposes revert ambient-judge (ADR 0066 D5.5, R2)', () => {
  type Answer = { status: number; body: unknown };
  const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });
  /** A fake instance: the judge view, the pending mark and the dry / real revert answers. */
  function instance(options: { view?: unknown; pending?: string; dry?: unknown; revert?: unknown }) {
    return client((path, body) => {
      if (path.endsWith('/ambient-judge')) return ok(options.view ?? { migration: { status: 'migrated', at: 1 } });
      if (path.endsWith('/pending')) return ok({ status: body.pending ? options.pending ?? 'pending' : 'cleared' });
      if (body.dryRun) return ok(options.dry ?? { status: 'ready' });
      return ok(options.revert ?? { status: 'reverted', graphRevision: 7 });
    });
  }
  async function withYml(text: string, run: (file: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'ambient-revert-'));
    try { const file = join(dir, 'zhin.config.yml'); await writeFile(file, text); await run(file); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
  const pathsOf = (requests: Array<{ path: string; body: Record<string, unknown> }>) => requests.map(request => [request.path.replace('/api/agent/inference', ''), request.body]);

  it('is registered under purposes', () => {
    const purposes = aiCommand.commands.find(command => command.name() === 'purposes')!;
    expect(purposes.commands.map(command => command.name())).toEqual(['revert']);
  });

  it('marks pending, dry-runs, reverts, then clears the mark', async () => {
    const { config, requests } = instance({});
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(true);
    expect(pathsOf(requests)).toEqual([
      ['/ambient-judge', {}],
      ['/cli/purposes/revert-ambient-judge/pending', { pending: true }],
      ['/cli/purposes/revert-ambient-judge', { dryRun: true }],
      ['/cli/purposes/revert-ambient-judge', {}],
      ['/cli/purposes/revert-ambient-judge/pending', { pending: false }],
    ]);
    expect(out.lines.join('\n')).toContain('修订号 7');
    expect(out.lines.join('\n')).toContain('现在可以降级');
    expect(process.exitCode).toBeUndefined();
  });

  it('aborts when the pending mark cannot be set, without reverting or clearing someone else\'s mark', async () => {
    const { config, requests } = instance({ pending: 'conflict' });
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(false);
    expect(pathsOf(requests)).toEqual([['/ambient-judge', {}], ['/cli/purposes/revert-ambient-judge/pending', { pending: true }]]);
    expect(process.exitCode).toBe(1);
  });

  it('case D: a seeded shadow over yml active — writes the shadow the instance runs with before the revert, listing what it overwrote', async () => {
    await withYml('ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n      mode: active\n', async file => {
      const { config, requests } = instance({ dry: { status: 'ready', yml: { mode: 'shadow' } } });
      const out = output();
      expect(await runRevertAmbientJudge({ client: config, configPath: file, output: out.sink })).toBe(true);
      expect(await readFile(file, 'utf8')).toContain('mode: shadow');
      expect(out.lines.join('\n')).toContain('当前版本已按这些值运行');
      expect(out.lines.join('\n')).toContain('ai.trigger.ambient.mode（原为 "active"）');
      // The yml was written between the dry run and the real revert.
      expect(pathsOf(requests).map(([path, body]) => `${path}${(body as { dryRun?: boolean }).dryRun ? ' dry' : ''}`))
        .toEqual(['/ambient-judge', '/cli/purposes/revert-ambient-judge/pending', '/cli/purposes/revert-ambient-judge dry', '/cli/purposes/revert-ambient-judge', '/cli/purposes/revert-ambient-judge/pending']);
    });
  });

  it('does not revert when the yml cannot be written, and clears the mark', async () => {
    const { config, requests } = instance({ dry: { status: 'ready', yml: { mode: 'shadow' } } });
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(false);
    expect(pathsOf(requests).filter(([path, body]) => path === '/cli/purposes/revert-ambient-judge' && !(body as { dryRun?: boolean }).dryRun)).toEqual([]);
    expect(pathsOf(requests).at(-1)).toEqual(['/cli/purposes/revert-ambient-judge/pending', { pending: false }]);
    expect(out.errors.join('\n')).toContain('手工写上 ai.trigger.ambient.mode: "shadow"');
  });

  it('undoes its yml write when the revert commit is refused, and clears the mark', async () => {
    const original = 'ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n      mode: active\n';
    await withYml(original, async file => {
      const { config, requests } = instance({ dry: { status: 'ready', yml: { mode: 'shadow', minConfidence: 0.8 } }, revert: { status: 'refused', reason: 'conflict' } });
      const out = output();
      expect(await runRevertAmbientJudge({ client: config, configPath: file, output: out.sink })).toBe(false);
      const text = await readFile(file, 'utf8');
      expect(text).toContain('mode: active');
      expect(text).not.toContain('minConfidence');
      expect(out.errors.join('\n')).toContain('模型配置正在被其他操作修改');
      expect(pathsOf(requests).at(-1)).toEqual(['/cli/purposes/revert-ambient-judge/pending', { pending: false }]);
    });
  });

  it('explains a refused dry run (changed since the migration) and writes nothing', async () => {
    await withYml('ai:\n  trigger:\n    ambient:\n      conversations: ["*"]\n', async file => {
      const { config } = instance({ dry: { status: 'refused', reason: 'changed' } });
      const out = output();
      expect(await runRevertAmbientJudge({ client: config, configPath: file, output: out.sink })).toBe(false);
      expect(out.errors.join('\n')).toContain('被修改过');
      expect(await readFile(file, 'utf8')).not.toContain('mode');
      expect(process.exitCode).toBe(1);
    });
  });

  it('does not say a downgrade is safe when the old form cannot express everything (N2)', async () => {
    const { config } = instance({ dry: { status: 'ready', lost: ['对照模型 spare（旧版本只能用决策模型陪跑）'] } });
    const out = output();
    expect(await runRevertAmbientJudge({ client: config, output: out.sink })).toBe(true);
    expect(out.errors.join('\n')).toContain('旧版本无法读取');
    expect(out.lines.join('\n')).not.toContain('可以降级');
    expect(process.exitCode).toBe(1);
  });
});
