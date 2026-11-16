// #1250 第 39 批：`zhin packages status` / `verification-plan` / `apply` / `verify` ask the running
// instance through this project's gateway when --live is omitted; offline status is `unknown` with a
// reason instead of `pending-restart`.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@zhin.js/gateway/plugin-management');
  vi.doUnmock('../src/utils/host-http.js');
});

const live = {
  packageName: 'api60s', instanceKey: 'api60s', status: 'enabled', published: true, restartRequired: false, generation: 1,
};
const offlineState = {
  packageName: 'api60s', instanceKey: 'api60s', status: 'unknown', statusReason: '没有连上运行中的实例：只检查了本地文件', published: false, restartRequired: false, generation: null,
};
const plan = { packageName: 'api60s', instanceKey: 'api60s', generation: 1, projectRevision: 'rev', checkRevision: 'chk', checks: [{ id: 'ping', title: 'Ping', effects: [], scope: 'local' }] };

/** A local-socket fetch whose gateway forwards `/api/console/request` to the instance. */
function gatewayFetch(answer: (body: Record<string, unknown>) => unknown) {
  return vi.fn(async (_url: string | URL, init?: { body?: string | null }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ requestId: body.requestId, data: answer(body) }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

async function run(args: string[], gateway: 'running' | 'stopped', fetch = gatewayFetch(body => body.type === 'plugin:inspect' ? live : plan)) {
  const workflow = { inspect: vi.fn(async () => offlineState), verificationPlan: vi.fn(async () => ({ ...plan, generation: null, checks: [] })) };
  vi.doMock('@zhin.js/gateway/plugin-management', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@zhin.js/gateway/plugin-management')>();
    return { ...actual, PluginManagementWorkflow: class { inspect = workflow.inspect; verificationPlan = workflow.verificationPlan; } };
  });
  vi.doMock('../src/utils/host-http.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/utils/host-http.js')>();
    return {
      ...actual,
      loadHostHttpConfig: async () => {
        if (gateway === 'stopped') throw new actual.HostTargetError('gateway-not-running', 'not running');
        return { baseUrl: 'http://127.0.0.1:8086/api', token: '', fetch };
      },
    };
  });
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...items: unknown[]) => { lines.push(items.join(' ')); });
  const { packagesCommand } = await import('../src/commands/packages.js');
  await packagesCommand.parseAsync(['node', 'packages', ...args]);
  return { text: lines.join('\n'), workflow, fetch };
}

describe('zhin packages status', () => {
  it('reads the live instance through the local gateway: its generation, not a file-only pending-restart', async () => {
    const { text, workflow, fetch } = await run(['status', 'api60s'], 'running');
    expect(JSON.parse(text)).toEqual(live);
    expect(workflow.inspect).not.toHaveBeenCalled();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:8086/api/console/request');
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: 'plugin:inspect', instanceKey: 'api60s' });
    // No token over the local socket: the gateway runs it as the local owner.
    expect(JSON.stringify(init)).not.toContain('authorization');
  });

  it('without a gateway: checks the files and reports unknown with the reason', async () => {
    const { text, workflow } = await run(['status', 'api60s'], 'stopped');
    expect(workflow.inspect).toHaveBeenCalledWith('api60s');
    const state = JSON.parse(text) as typeof offlineState;
    expect(state.status).toBe('unknown');
    expect(state.statusReason).toContain('没有连上运行中的实例');
    expect(state.statusReason).toContain('本项目的网关未运行');
  });

  it('a gateway whose instance does not answer falls back to the files and says so', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'instance not ready' }), { status: 503 }));
    const { text } = await run(['status', 'api60s'], 'running', fetch as never);
    expect((JSON.parse(text) as typeof offlineState).statusReason).toContain('网关在运行，但实例没有给出结果');
  });
});

describe('zhin packages verification-plan / verify / apply', () => {
  it('verification-plan comes from the instance through the gateway, and the verify command needs no --live', async () => {
    const { text, workflow } = await run(['verification-plan', 'api60s'], 'running');
    expect(workflow.verificationPlan).not.toHaveBeenCalled();
    expect(text).toContain('（经本项目网关读取运行中的实例）');
    expect(text).toContain('当前 generation: 1');
    expect(text).toContain('zhin packages verify api60s <check-id> --generation 1 --project-revision rev --check-revision chk');
  });

  it('verification-plan offline explains the missing generation and why', async () => {
    const { text } = await run(['verification-plan', 'api60s'], 'stopped');
    expect(text).toContain('（离线）');
    expect(text).toContain('没有连上运行中的实例：本项目的网关未运行');
  });

  it('verify and apply go through the gateway without --live', async () => {
    const fetch = gatewayFetch(body => ({ echoed: body.type }));
    const verified = await run(['verify', 'api60s', 'ping', '--generation', '1', '--project-revision', 'rev', '--check-revision', 'chk'], 'running', fetch);
    expect(JSON.parse(verified.text)).toEqual({ echoed: 'plugin:verify' });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ instanceKey: 'api60s', checkId: 'ping', expectedGeneration: 1 });
  });

  it('apply refuses without an instance instead of pretending', async () => {
    await expect(run(['apply', 'api60s', '--project-revision', 'rev'], 'stopped')).rejects.toThrow('没有连上运行中的实例');
  });
});
