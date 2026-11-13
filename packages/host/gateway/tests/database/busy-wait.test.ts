import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_ROUTE_TABLE } from '@zhin.js/host-http/bridge';
import { startGateway, type GatewayInstanceTransport, type RunningGateway } from '../../src/http/start-gateway.js';
import { GATEWAY_SQLITE_BUSY_RETRY_MS } from '../../src/database/index.js';

// ADR 0054 §7 / ADR 0059: another connection to `.zhin/gateway.db` (the CLI's import or rescue
// path, a standalone instance) may hold its write lock with BEGIN IMMEDIATE. Meanwhile the
// gateway retries asynchronously (no busy_timeout): its event loop keeps running, and `/auth/*`
// writes succeed once the lock is released.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const fixture = fileURLToPath(new URL('../supervisor/fixtures/fake-instance.mjs', import.meta.url));
const PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];
const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const offline: GatewayInstanceTransport = {
  ready: false,
  routes: () => EMPTY_ROUTE_TABLE,
  onRoutes: () => () => undefined,
  fetch: async () => new Response(null, { status: 503 }),
  openWebSocket: async () => false,
};

async function gatewayWithOwner(store?: { busyRetryMs?: number }): Promise<{ gateway: RunningGateway; filename: string }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-gateway-busy-'));
  dirs.push(root);
  await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  const filename = join(root, '.zhin', 'gateway.db');
  const gateway = await startGateway({
    projectRoot: root,
    http: { host: '127.0.0.1', port: 0 },
    supervisor: { spawn: { command: process.execPath, args: [fixture], cwd: root } },
    transport: () => offline,
    startInstance: false,
    packages: false,
    console: { ...(store ? { store } : {}), retryMs: 60_000 },
  });
  closers.push(() => gateway.close());
  await gateway.console!.setup.createOwner({ username: 'owner', password: PASSWORD });
  return { gateway, filename };
}

/** A second connection to gateway.db: no busy_timeout, a write transaction held for `ms`. */
function holdInstanceWriteLock(filename: string, ms: number): Promise<void> {
  const instance = new DatabaseSync(filename);
  closers.push(() => instance.close());
  instance.exec('CREATE TABLE IF NOT EXISTS bot_state (id INTEGER PRIMARY KEY, value TEXT)');
  instance.exec('BEGIN IMMEDIATE');
  instance.prepare('INSERT INTO bot_state (value) VALUES (?)').run('long transaction');
  return new Promise((resolve) => setTimeout(() => { instance.exec('COMMIT'); resolve(); }, ms));
}

function login(gateway: RunningGateway): Promise<Response> {
  return gateway.http.handle(new Request('http://127.0.0.1/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: PASSWORD }),
  }), { remoteAddress: '127.0.0.1' });
}

describe('gateway SQLite connection beside a long instance transaction', () => {
  it('uses the async retry budget, not a synchronous busy_timeout', () => {
    expect(GATEWAY_SQLITE_BUSY_RETRY_MS).toBeGreaterThan(2_000);
  });

  it('keeps the event loop responsive and logs in once the lock is released', async () => {
    const { gateway, filename } = await gatewayWithOwner();
    const released = holdInstanceWriteLock(filename, 2_500);
    let releasedAt = 0;
    void released.then(() => { releasedAt = Date.now(); });
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 20);
    const startedAt = Date.now();
    try {
      // The health probe answers while the login waits for the write lock.
      const pending = login(gateway);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const health = await gateway.http.handle(new Request('http://127.0.0.1/pub/health'));
      expect(health.status).toBe(200);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      const response = await pending;
      const body = await response.json() as { success: boolean; data?: { token?: string } };
      expect(response.status).toBe(200);
      expect(body.data?.token).toMatch(/\S+/u);
      // The session insert could only land after the instance committed.
      expect(releasedAt).toBeGreaterThan(0);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2_400);
      // A synchronous 2 s wait would have frozen the timer for most of the hold.
      expect(ticks).toBeGreaterThan(60);
      // The new session authenticates.
      const me = await gateway.http.handle(new Request('http://127.0.0.1/api/auth/me', {
        headers: { authorization: `Bearer ${body.data!.token!}` },
      }));
      expect((await me.json() as { data: { kind: string } }).data.kind).toBe('user');
    } finally {
      clearInterval(ticker);
    }
    await released;
  }, 15_000);

  it('answers 503 database_busy with Retry-After when the budget runs out', async () => {
    const { gateway, filename } = await gatewayWithOwner({ busyRetryMs: 150 });
    const released = holdInstanceWriteLock(filename, 1_000);
    const response = await login(gateway);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/u);
    expect(await response.json()).toMatchObject({ success: false, code: 'database_busy' });
    await released;
    // The same request succeeds once the lock is gone.
    expect((await login(gateway)).status).toBe(200);
  });
});
