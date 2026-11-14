import { describeProbe, runAccountAdd, runAccountTest, runRenameEnv, aiCommand } from '../src/commands/ai.js';
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

it('registers zhin ai account add / rename-env / test', () => {
  const account = aiCommand.commands.find(command => command.name() === 'account')!;
  expect(account.commands.map(command => command.name()).sort()).toEqual(['add', 'rename-env', 'test']);
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
