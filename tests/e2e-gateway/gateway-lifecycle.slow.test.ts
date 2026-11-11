// Process-level end-to-end suite for the management gateway (ADR 0054, plan B1.7): a copy of
// examples/minimal-bot started with the real built `zhin` binary in the background, then
// first-run Console setup, restart, crash supervision, a rolled-back dependency install,
// session revocation and stop. Slow (about two minutes): `pnpm test` skips it; run it with
// `pnpm test:e2e:gateway` (after `pnpm build`). CI runs it once in full-validation.yml.
import { existsSync } from 'node:fs';
import {
  createGatewayProject,
  isProcessAlive,
  portClosed,
  sleep,
  waitFor,
  type GatewayProject,
  type StatusJson,
} from './harness/gateway-project.js';

const enabled = process.env.ZHIN_TEST_GATEWAY_E2E === '1' && process.platform !== 'win32';
const OWNER = { username: 'owner', password: 'e2e-owner-password-1' };
const OPERATOR = { username: 'operator', password: 'e2e-operator-password-1' };
const BROKEN_PLUGIN = 'zhin-plugin-e2e-broken';

/** Reads an SSE response until the server ends it; resolves with what arrived. */
async function readUntilClosed(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms))]);
}

describe.skipIf(!enabled)('management gateway end to end (zhin start, examples/minimal-bot)', () => {
  let project: GatewayProject;
  let gatewayPid: number;
  let ownerToken: string;

  const runningInstance = (label: string, previousPid?: number) => waitFor(label, async () => {
    const status = await project.status();
    const instance = status.instance;
    return instance?.state === 'running' && instance.pid !== undefined && instance.pid !== previousPid ? status : undefined;
  }, 60_000);

  beforeAll(async () => {
    project = await createGatewayProject('lifecycle');
  }, 60_000);

  afterAll(async () => {
    await project?.dispose();
  }, 60_000);

  it('starts the gateway in the background and serves health and an instance route on its port', async () => {
    const started = await project.zhin(['start']);
    expect(started.code, started.stderr).toBe(0);
    expect(started.stdout).toContain('网关已在后台启动');

    const status: StatusJson = await runningInstance('instance running after zhin start');
    expect(status.gateway).toMatchObject({ running: true, mode: 'daemon', ports: [project.port] });
    expect(status.consoleInitialized).toBe(false);
    gatewayPid = status.gateway.pid!;
    expect(isProcessAlive(gatewayPid)).toBe(true);
    expect(status.instance!.pid).not.toBe(gatewayPid);
    expect(existsSync(project.path('.zhin/gateway.sock'))).toBe(true);
    expect(existsSync(project.path('.zhin/gateway.json'))).toBe(true);

    const health = await project.json('/pub/health');
    expect(health.status).toBe(200);
    expect(health.body.instance).toEqual({ state: 'running', ready: true });

    // No http.token and no owner: the project is open (local development) until setup.
    const system = await project.json('/api/system/status');
    expect(system.status).toBe(200);
    expect(system.body.data.pid).toBe(status.instance!.pid);
  }, 90_000);

  it('first run: open bootstrap, zhin console init, then anonymous until login', async () => {
    const before = await project.json('/api/auth/me');
    expect(before.body.data).toMatchObject({ kind: 'bootstrap', open: true, setupRequired: true });

    const init = await project.zhin(['console', 'init', '--yes', '--owner', OWNER.username, '--password-stdin'], { input: `${OWNER.password}\n` });
    expect(init.code, init.stderr).toBe(0);

    // The gateway sees the owner written by another process: the open bootstrap ends.
    const after = await waitFor('setup to be noticed', async () => {
      const response = await project.json('/api/auth/me');
      return response.body.data.setupRequired === false ? response : undefined;
    }, 15_000);
    expect(after.body.data).toEqual({ kind: 'anonymous', permissions: [], bindings: [], setupRequired: false });
    expect((await project.json('/api/system/status')).status).toBe(401);
    expect((await project.rpc(undefined, 'gateway.instance.status')).status).toBe(401);

    ({ token: ownerToken } = await project.login(OWNER.username, OWNER.password));
    const me = await project.json('/api/auth/me', { token: ownerToken });
    expect(me.body.data).toMatchObject({ kind: 'user', user: { username: OWNER.username } });

    // Instance RPC forwarded through the gateway; gateway.* answered by the gateway itself.
    const endpoints = await project.rpc(ownerToken, 'endpoint.list');
    expect(endpoints.status, JSON.stringify(endpoints.body)).toBe(200);
    expect(endpoints.body.data.endpoints.map((item: { name: string }) => item.name)).toContain('terminal');
    const instance = await project.rpc(ownerToken, 'gateway.instance.status');
    expect(instance.status).toBe(200);
    expect(instance.body).toMatchObject({ success: true, type: 'gateway.instance.status', data: { state: 'running' } });
    expect((await project.json('/api/system/status', { token: ownerToken })).status).toBe(200);
  }, 60_000);

  it('zhin restart replaces the instance; the gateway keeps its pid and keeps answering', async () => {
    const before = await project.status();
    const codes: number[] = [];
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const response = await project.fetch('/api/system/status', { token: ownerToken }).catch(() => undefined);
        if (!response) throw new Error('gateway refused a connection during restart');
        if (response.status === 503) expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
        codes.push(response.status);
        await response.body?.cancel();
        await sleep(50);
      }
    })();
    const restarted = await project.zhin(['restart']);
    expect(restarted.code, restarted.stderr).toBe(0);
    const after = await runningInstance('instance after restart', before.instance!.pid);
    await sleep(300);
    polling = false;
    await poller;

    expect(after.gateway.pid).toBe(gatewayPid);
    expect(after.instance!.startedAt).toBeGreaterThan(before.instance!.startedAt!);
    expect(new Set(codes).size).toBeGreaterThan(0);
    expect(codes.every((code) => code === 200 || code === 503)).toBe(true);
    expect(codes.at(-1)).toBe(200);
    expect((await project.json('/pub/health')).status).toBe(200);
  }, 90_000);

  it('restarts a killed instance, and after repeated crashes stays crashed with health still answering', async () => {
    const before = await project.status();
    process.kill(before.instance!.pid!, 'SIGKILL');
    // Offline window: forwarded routes answer 503 with Retry-After, health stays 200.
    const offline = await waitFor('503 while the instance is down', async () => {
      const response = await project.fetch('/api/system/status', { token: ownerToken });
      await response.body?.cancel();
      return response.status === 503 ? response : undefined;
    }, 10_000, 50);
    expect(Number(offline.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await project.json('/pub/health')).status).toBe(200);
    const recovered = await runningInstance('supervisor restart after SIGKILL', before.instance!.pid);
    expect(recovered.gateway.pid).toBe(gatewayPid);
    expect(recovered.instance!.recentRestarts).toBeGreaterThanOrEqual(1);
    expect((await project.json('/api/system/status', { token: ownerToken })).status).toBe(200);

    // Crash storm: keep killing every new instance until the supervisor gives up.
    const crashed = await waitFor('crashed state', async () => {
      const status = await project.status();
      if (status.instance?.state === 'crashed') return status;
      if (status.instance?.state === 'running' && status.instance.pid) {
        try { process.kill(status.instance.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      return undefined;
    }, 120_000, 200);
    expect(crashed.gateway.pid).toBe(gatewayPid);
    expect(crashed.instance!.lastFailure?.message).toContain('too many restarts');
    expect(isProcessAlive(gatewayPid)).toBe(true);
    const health = await project.json('/pub/health');
    expect(health.status).toBe(200);
    expect(health.body.instance.state).toBe('crashed');
    const forwarded = await project.fetch('/api/system/status', { token: ownerToken });
    expect(forwarded.status).toBe(503);
    await forwarded.body?.cancel();
    // gateway.* still answers while the instance is down.
    expect((await project.rpc(ownerToken, 'gateway.instance.status')).body.data.state).toBe('crashed');

    const restarted = await project.zhin(['restart']);
    expect(restarted.code, restarted.stderr).toBe(0);
    await runningInstance('instance after restart from crashed');
  }, 180_000);

  it('rolls back a dependency install whose plugin breaks the instance', async () => {
    const files = ['package.json', 'pnpm-lock.yaml', 'zhin.config.yml'] as const;
    const before = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await project.read(file)] as const)));
    const instanceBefore = (await project.status()).instance!;

    const install = await project.zhin(['install', `${BROKEN_PLUGIN}@1.0.0`], { timeoutMs: 180_000 });
    expect(install.code).toBe(1);
    expect(install.stderr).toContain('已回滚');
    expect(install.stderr).toContain('start-instance');
    expect(`${install.stdout}\n${install.stderr}`).toContain('e2e broken plugin');
    // Through the gateway the CLI prints the transaction phases, not a local pnpm command line.
    expect(install.stdout).not.toContain('执行命令');
    expect(install.stdout).toContain('执行包管理器');

    // The fake package manager ran the install, then the rollback reinstall.
    const calls = (await project.read('.fake-pnpm.log')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
    expect(calls).toEqual([['add', `${BROKEN_PLUGIN}@1.0.0`], ['install', '--frozen-lockfile']]);
    for (const file of files) expect(await project.read(file), file).toBe(before[file]);
    expect(existsSync(project.path(`node_modules/${BROKEN_PLUGIN}`))).toBe(false);

    const after = await runningInstance('old instance running again after rollback', instanceBefore.pid);
    expect(after.gateway.pid).toBe(gatewayPid);
    expect((await project.json('/api/system/status', { token: ownerToken })).status).toBe(200);
  }, 200_000);

  it('disabling a user through iam.* answers 401 for their session and closes their event stream', async () => {
    const created = await project.rpc(ownerToken, 'iam.users.create', {
      username: OPERATOR.username,
      password: OPERATOR.password,
      bindings: [{ role: 'viewer' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const operator = await project.login(OPERATOR.username, OPERATOR.password);
    expect((await project.json('/api/system/status', { token: operator.token })).status).toBe(200);

    const controller = new AbortController();
    const stream = await project.fetch('/api/events', { token: operator.token, signal: controller.signal });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const closed = readUntilClosed(stream);
    await sleep(500);

    const disabled = await project.rpc(ownerToken, 'iam.users.disable', { id: operator.userId });
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);

    try {
      await withTimeout(closed, 10_000, 'event stream close after disable');
    } finally {
      controller.abort();
    }
    expect((await project.json('/api/system/status', { token: operator.token })).status).toBe(401);
    expect((await project.rpc(operator.token, 'gateway.instance.status')).status).toBe(401);
    expect((await project.json('/api/auth/me', { token: operator.token })).body.data.kind).toBe('anonymous');
    // The owner is unaffected.
    expect((await project.json('/api/system/status', { token: ownerToken })).status).toBe(200);
  }, 60_000);

  it('zhin logs -n reads the instance log; zhin stop removes the socket and state file and closes the port', async () => {
    const logs = await project.zhin(['logs', '-n', '20']);
    expect(logs.code, logs.stderr).toBe(0);
    const lines = `${logs.stdout}${logs.stderr}`.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(20);

    const instancePid = (await project.status()).instance!.pid!;
    const stopped = await project.zhin(['stop']);
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.stdout).toContain('已停止');
    expect(existsSync(project.path('.zhin/gateway.sock'))).toBe(false);
    expect(existsSync(project.path('.zhin/gateway.json'))).toBe(false);
    expect(await portClosed(project.port)).toBe(true);
    await waitFor('gateway and instance processes to exit', async () => (
      !isProcessAlive(gatewayPid) && !isProcessAlive(instancePid) ? true : undefined
    ), 15_000);

    const status = await project.zhin(['status', '--json']);
    expect(status.code).toBe(3);
    expect(JSON.parse(status.stdout)).toEqual({ gateway: { running: false }, instance: null });
    // Without a gateway, logs fall back to the log file.
    const offlineLogs = await project.zhin(['logs', '-n', '5']);
    expect(offlineLogs.code).toBe(0);
    expect(offlineLogs.stderr).toContain('网关未运行');
  }, 90_000);
});
