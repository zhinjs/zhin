// M7 acceptance walk over the Console's own HTTP / RPC / WebSocket calls (plan M7): a fresh
// project with a bootstrap token → wizard (SQLite) → owner → onboarding installs the sandbox
// adapter and a message reaches a command over its WebSocket → an adapter-level feature switch
// takes effect over the global one → a terminal command runs → a failing install rolls back.
// The Console UI itself lives in another repository; this walk drives the same endpoints it
// uses. Slow: see gateway-lifecycle.slow.test.ts.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createGatewayProject,
  repositoryRoot,
  waitFor,
  type GatewayProject,
} from './harness/gateway-project.js';

const enabled = process.env.ZHIN_TEST_GATEWAY_E2E === '1' && process.platform !== 'win32';
const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-0123456789abcdef';
const OWNER = { username: 'owner', password: 'e2e-owner-password-1' };
const SANDBOX = '@zhin.js/adapter-sandbox';
const SANDBOX_ENDPOINT = 'e2e-sandbox';
const REPEATER = '@zhin.js/plugin-repeater';

interface SandboxChat {
  send(message: Readonly<Record<string, unknown>>): void;
  /** Resolves with the first frame whose text contains `text` (optionally only outbound frames). */
  waitForText(text: string, direction?: 'outbound', timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

function frameText(frame: Record<string, unknown>): string {
  const content = frame.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((segment: { data?: { text?: unknown } }) => (typeof segment?.data?.text === 'string' ? segment.data.text : '')).join('');
}

/** The sandbox adapter's WebSocket, reached through the gateway with a Console session. */
async function openSandbox(project: GatewayProject, token: string): Promise<SandboxChat> {
  const socket = new WebSocket(`${project.origin.replace('http', 'ws')}/sandbox`, { headers: { authorization: `Bearer ${token}` } } as never);
  const frames: Record<string, unknown>[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener('message', (event) => {
    try { frames.push(JSON.parse(String(event.data)) as Record<string, unknown>); } catch { return; }
    for (const wake of waiters) wake();
  });
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('close', (event) => reject(new Error(`sandbox socket closed ${event.code} ${event.reason}`)), { once: true });
  });
  return {
    send: (message) => socket.send(JSON.stringify(message)),
    waitForText: (text, direction, timeoutMs = 15_000) => new Promise((resolveFrame, reject) => {
      const match = () => frames.find((frame) => frameText(frame).includes(text) && (direction !== 'outbound' || frame.direction !== 'inbound'));
      const check = () => {
        const found = match();
        if (!found) return;
        cleanup();
        resolveFrame(found);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`no sandbox frame with ${JSON.stringify(text)}: ${JSON.stringify(frames).slice(0, 2000)}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); waiters.delete(check); };
      waiters.add(check);
      check();
    }),
    close: () => socket.close(),
  };
}

describe.skipIf(!enabled)('Console acceptance walk through the gateway (M7)', () => {
  let project: GatewayProject;
  let token: string;

  const running = (label: string, previousPid?: number) => waitFor(label, async () => {
    const status = await project.status();
    return status.instance?.state === 'running' && status.instance.pid !== previousPid ? status : undefined;
  }, 60_000);

  beforeAll(async () => {
    project = await createGatewayProject('console', {
      linkPackages: {
        [SANDBOX]: join(repositoryRoot, 'plugins/adapters/sandbox'),
        [REPEATER]: join(repositoryRoot, 'plugins/utils/repeater'),
      },
      // As create-zhin writes it: the bootstrap token comes from .env.
      extraConfig: '  token: ${HTTP_TOKEN}\nconsole:\n  terminal:\n    enabled: true\n',
    });
    await writeFile(project.path('.env'), `HTTP_TOKEN=${BOOTSTRAP_TOKEN}\n`);
    const started = await project.zhin(['start']);
    expect(started.code, started.stderr).toBe(0);
    await running('instance after zhin start');
  }, 90_000);

  afterAll(async () => {
    await project?.dispose();
  }, 60_000);

  it('wizard: bootstrap token → SQLite database → owner', async () => {
    expect((await project.json('/api/auth/me')).body.data).toMatchObject({ kind: 'anonymous', setupRequired: true });
    expect((await project.json('/api/auth/setup')).status).toBe(401);
    const setup = await project.json('/api/auth/setup', { token: BOOTSTRAP_TOKEN });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    expect(setup.body.data).toMatchObject({ setupRequired: true, onboarding: { steps: { database: 'pending', owner: 'pending' } } });

    const choices = await project.json('/api/auth/setup/database', { token: BOOTSTRAP_TOKEN });
    expect(choices.status).toBe(200);
    expect(choices.body.data.drivers.find((driver: { dialect: string }) => driver.dialect === 'sqlite')).toMatchObject({ available: true });
    const database = { dialect: 'sqlite', connection: { filename: 'data/console.sqlite' } };
    const tested = await project.json('/api/auth/setup/database/test', {
      method: 'POST', token: BOOTSTRAP_TOKEN, headers: { 'content-type': 'application/json' }, body: JSON.stringify(database),
    });
    expect(tested.body.data, JSON.stringify(tested.body)).toMatchObject({ ok: true });
    const before = await project.status();
    const applied = await project.json('/api/auth/setup/database', {
      method: 'POST', token: BOOTSTRAP_TOKEN, headers: { 'content-type': 'application/json' }, body: JSON.stringify(database),
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.data.restarting).toBe(true);
    // The gateway reopens the database and restarts the instance on it.
    const after = await running('instance on the new database', before.instance!.pid);
    expect(after.gateway.pid).toBe(before.gateway.pid);
    expect(await project.read('zhin.config.yml')).toContain('console.sqlite');
    await waitFor('new database file', async () => (existsSync(project.path('data/console.sqlite')) ? true : undefined), 15_000);

    const owner = await project.json('/api/auth/setup', {
      method: 'POST', token: BOOTSTRAP_TOKEN, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...OWNER, displayName: 'E2E Owner' }),
    });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    token = owner.body.data.token;
    // The bootstrap token is refused from now on.
    expect((await project.json('/api/auth/setup', { token: BOOTSTRAP_TOKEN })).status).not.toBe(200);
    expect((await project.json('/api/auth/me', { token: BOOTSTRAP_TOKEN })).body.data.kind).toBe('anonymous');
    expect((await project.json('/api/system/status', { token: BOOTSTRAP_TOKEN })).status).toBe(401);
    const me = await project.json('/api/auth/me', { token });
    expect(me.body.data).toMatchObject({ kind: 'user', user: { username: OWNER.username }, setupRequired: false });
    expect(me.body.data.onboarding.steps).toMatchObject({ database: 'done', owner: 'done' });
    // The account lives in the new database: a fresh login works.
    expect((await project.login(OWNER.username, OWNER.password)).token).toBeTruthy();
  }, 120_000);

  it('onboarding installs the sandbox adapter through the gateway and the instance loads it', async () => {
    const before = await project.status();
    // Installing with the default (enable) keeps the adapter undeclared: its schema requires an
    // account (`endpoints`) without a default, so the instance must not load it yet.
    const install = await project.rpc(token, 'gateway.packages.install', { packages: [SANDBOX] });
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body.data, JSON.stringify(install.body.data)).toMatchObject({
      ok: true, status: 'succeeded', packages: [{ name: SANDBOX, source: 'adapter' }],
      needsConfiguration: [{ name: SANDBOX, instanceKey: 'sandbox', missing: ['endpoints'], missingEnv: [] }],
    });
    expect(JSON.parse(await project.read('package.json')).dependencies[SANDBOX]).toBeTruthy();
    expect(await project.read('zhin.config.yml')).not.toContain(SANDBOX);
    const afterInstall = await running('instance after the package install', before.instance!.pid);

    // …then declare it with its first account: schema-validated, written atomically, instance restarted.
    const invalid = await project.rpc(token, 'gateway.plugins.declare', { package: SANDBOX, config: { endpoints: [{}] } });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
    expect(invalid.body, JSON.stringify(invalid.body)).toMatchObject({ success: false, code: 'invalid_input' });
    const declared = await project.rpc(token, 'gateway.plugins.declare', { package: SANDBOX, config: { endpoints: [{ id: SANDBOX_ENDPOINT }] } });
    expect(declared.status, JSON.stringify(declared.body)).toBe(200);
    expect(declared.body.data, JSON.stringify(declared.body.data)).toMatchObject({ ok: true, status: 'succeeded', operation: 'declare' });
    expect(await project.read('zhin.config.yml')).toContain(SANDBOX_ENDPOINT);
    await running('instance with the sandbox adapter', afterInstall.instance!.pid);

    const endpoints = await project.rpc(token, 'endpoint.list');
    expect(endpoints.status).toBe(200);
    const names = endpoints.body.data.endpoints.map((item: { name: string }) => item.name);
    expect(names, names.join(', ')).toContain(SANDBOX_ENDPOINT);

    // A message through the sandbox WebSocket (forwarded by the gateway) reaches a command.
    const chat = await openSandbox(project, token);
    try {
      await chat.waitForText('Sandbox');
      // minimal-bot keeps the `/` prefix for its terminal only; other adapters use the core default (none).
      chat.send({ type: 'group', id: 'e2e-group', senderId: 'alice', text: 'hello' });
      await chat.waitForText('Hello from minimal-bot.', 'outbound').catch(async (error) => {
        process.stderr.write(`diagnostics: ${JSON.stringify((await project.json('/api/messages/diagnostics', { token })).body).slice(0, 4000)}\n`);
        throw error;
      });
    } finally { chat.close(); }

    const marked = await project.rpc(token, 'onboarding.update', { step: 'adapters', status: 'done' });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body.data.steps.adapters).toBe('done');
  }, 120_000);

  it('a layered (adapter-level) feature switch takes effect over the global one', async () => {
    const before = await project.status();
    const install = await project.rpc(token, 'gateway.packages.install', { packages: [REPEATER] });
    expect(install.body.data, JSON.stringify(install.body)).toMatchObject({ ok: true, status: 'succeeded' });
    await running('instance with the repeater plugin', before.instance!.pid);

    const list = await project.rpcMessage(token, { type: 'feature.list' });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const feature = list.body.data.features.find((item: { plugin: string }) => item.plugin === 'repeater');
    expect(feature, JSON.stringify(list.body.data)).toMatchObject({ globalEnabled: true, hasSchema: true });
    const matrix = await project.rpcMessage(token, { type: 'feature.matrix' });
    expect(matrix.body.data.adapters, JSON.stringify(matrix.body.data)).toContain('sandbox');

    const chat = await openSandbox(project, token);
    const echo = async (group: string, expectRepeat: boolean) => {
      const text = `echo-${group}`;
      for (const sender of ['alice', 'bob', 'carol']) chat.send({ type: 'group', id: group, senderId: sender, text });
      const repeated = await chat.waitForText(text, 'outbound', expectRepeat ? 15_000 : 3_000).then(() => true, () => false);
      expect(repeated, `${group}: repeat expected ${expectRepeat}`).toBe(expectRepeat);
    };
    try {
      await chat.waitForText('Sandbox');
      await echo('g-global', true);

      // Off for the sandbox adapter only: the global switch stays on.
      const off = await project.rpcMessage(token, { type: 'feature.set-enabled', plugin: 'repeater', level: 'adapter', key: 'sandbox', enabled: false });
      expect(off.body.data, JSON.stringify(off.body)).toMatchObject({ status: 'saved', restartRequired: false });
      const cell = (await project.rpcMessage(token, { type: 'feature.matrix' })).body.data.rows
        .find((row: { plugin: string }) => row.plugin === 'repeater');
      expect(cell).toMatchObject({ global: { enabled: true }, adapters: { sandbox: { enabled: false, overridden: true } } });
      await waitFor('the adapter switch to apply', async () => {
        const status = await project.rpcMessage(token, { type: 'feature.get', plugin: 'repeater', level: 'adapter', key: 'sandbox' });
        return status.body.data?.enabled === false ? true : undefined;
      }, 15_000);
      await echo('g-adapter-off', false);

      const removed = await project.rpcMessage(token, { type: 'feature.remove-override', plugin: 'repeater', level: 'adapter', key: 'sandbox' });
      expect(removed.body.data, JSON.stringify(removed.body)).toMatchObject({ status: 'saved' });
      await echo('g-restored', true);

      // ADR 0055: off for one sandbox conversation only, stored in the project database, in place.
      const conversationKey = `sandbox/${SANDBOX_ENDPOINT}/group:g-conv-off`;
      const conversationOff = await project.rpcMessage(token, { type: 'feature.set-enabled', plugin: 'repeater', level: 'conversation', key: conversationKey, enabled: false });
      expect(conversationOff.body.data, JSON.stringify(conversationOff.body)).toMatchObject({ status: 'saved', restartRequired: false });
      const listed = await project.rpcMessage(token, { type: 'feature.conversations', plugin: 'repeater' });
      expect(listed.body.data.conversations, JSON.stringify(listed.body)).toMatchObject([{ key: conversationKey, hasOverrides: true,
        overrides: [{ plugin: 'repeater', enabled: false }] }]);
      await echo('g-conv-off', false);
      await echo('g-conv-on', true);
    } finally { chat.close(); }
  }, 180_000);

  it('the Console terminal runs a command on the host', async () => {
    const targets = await project.json('/api/console/terminal/targets', { token });
    expect(targets.status, JSON.stringify(targets.body)).toBe(200);
    const local = targets.body.data.find((target: { id: string }) => target.id === 'local');
    expect(local, JSON.stringify(targets.body)).toMatchObject({ available: true });
    const ticket = await project.json('/api/console/terminal/tickets', {
      method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'local', cols: 80, rows: 24 }),
    });
    expect(ticket.status, JSON.stringify(ticket.body)).toBe(200);
    const socket = new WebSocket(`${project.origin.replace('http', 'ws')}/api/console/terminal?ticket=${encodeURIComponent(ticket.body.data.ticket)}`);
    socket.binaryType = 'arraybuffer';
    let output = '';
    socket.addEventListener('message', (event) => {
      output += typeof event.data === 'string' ? '' : new TextDecoder().decode(event.data as ArrayBuffer);
    });
    try {
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener('open', () => resolveOpen(), { once: true });
        socket.addEventListener('close', (event) => reject(new Error(`terminal closed ${event.code} ${event.reason}`)), { once: true });
      });
      socket.send(new TextEncoder().encode('echo "e2e-terminal-$((40+2))"\r'));
      await waitFor('terminal output', async () => (output.includes('e2e-terminal-42') ? true : undefined), 15_000);
    } finally { socket.close(); }
  }, 60_000);

  it('a failing install from the Console is rolled back and the instance keeps running', async () => {
    const files = ['package.json', 'pnpm-lock.yaml', 'zhin.config.yml'] as const;
    const before = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await project.read(file)] as const)));
    const instanceBefore = (await project.status()).instance!;
    const install = await project.rpc(token, 'gateway.packages.install', { packages: ['zhin-plugin-e2e-broken@1.0.0'] });
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body.data).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance' });
    expect(install.body.data.logTail.join('\n')).toContain('e2e broken plugin');
    for (const file of files) expect(await project.read(file), file).toBe(before[file]);
    const after = await running('instance after the rollback', instanceBefore.pid);
    expect(after.gateway.pid).toBe((await project.status()).gateway.pid);
    const endpoints = await project.rpc(token, 'endpoint.list');
    expect(endpoints.body.data.endpoints.map((item: { name: string }) => item.name)).toContain(SANDBOX_ENDPOINT);
  }, 180_000);
});
