import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
import { EMPTY_ROUTE_TABLE } from '@zhin.js/host-http/bridge';
import { startGateway, type RunningGateway } from '../../src/http/start-gateway.js';

const fixture = fileURLToPath(new URL('../supervisor/fixtures/fake-instance.mjs', import.meta.url));
const PASSWORD = 'correct-horse-battery';
const gateways: RunningGateway[] = [];
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(gateways.splice(0).map(gateway => gateway.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('ai.personalPrincipals key hints (#1250, review of #1288)', () => {
  it('go to the gateway\'s own log, never into the instance log the Console can read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-gateway-keys-'));
    dirs.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\nai:\n  personalPrincipals:\n    workroom-admin: []\n');
    const warn = vi.spyOn(getLogger('gateway'), 'warn');
    const gateway = await startGateway({
      projectRoot: root,
      http: { host: '127.0.0.1', port: 0, token: 'setup-token' },
      supervisor: { spawn: { command: process.execPath, args: [fixture], cwd: root }, restart: { onCrash: false } },
      transport: ({ supervisor }) => ({
        get ready() { return supervisor.state === 'running'; },
        routes: () => EMPTY_ROUTE_TABLE,
        onRoutes: () => () => undefined,
        fetch: async () => new Response('never'),
        openWebSocket: async () => false,
      }),
      startInstance: false,
      packages: false,
    });
    gateways.push(gateway);
    const created = await fetch(`${gateway.http.address!.origin}/api/auth/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer setup-token' },
      body: JSON.stringify({ username: 'class', password: PASSWORD }),
    });
    expect(created.status).toBe(201);
    const [owner] = await gateway.console!.iam()!.listUsers();

    await gateway.supervisor.start();
    const hint = () => warn.mock.calls.map(call => String(call[0])).find(line => line.includes('ai.personalPrincipals.workroom-admin'));
    await until(() => hint() !== undefined);
    expect(hint()).toContain(`当前唯一的所有者是 class，可改为 user:${owner!.id}`);
    const instanceLog = gateway.supervisor.logs.tail().map(line => line.line).join('\n');
    expect(instanceLog).not.toContain(owner!.id);
    expect(instanceLog).not.toContain('ai.personalPrincipals');
  });
});
