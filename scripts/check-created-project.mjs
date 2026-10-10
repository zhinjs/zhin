#!/usr/bin/env node
/** Published-consumer acceptance: tarballs -> creator CLI -> empty project -> real IM IO. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';
import { resolveWorkspacePackClosure, withWorkspaceTarballOverrides } from './workspace-pack-closure.mjs';

const runFile = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'zhin-created-project-'));
const packs = path.join(temp, 'packs');
const creator = path.join(temp, 'creator');
const project = path.join(creator, 'acceptance-bot');
const env = { ...process.env, NODE_OPTIONS: '', NPM_TOKEN: process.env.NPM_TOKEN ?? '' };
delete env.ZHIN_RUNTIME_CHILD;
const packed = new Map();
const workspace = [...readWorkspaceGraph().values()].map((entry) => ({
  ...entry, dir: path.join(repo, entry.dir),
}));
for (const entry of workspace) entry.manifest = JSON.parse(await readFile(path.join(entry.dir, 'package.json'), 'utf8'));
let child;
let output = '';
let passed = false;
const selectedPlatforms = ['onebot11', 'napcat', 'telegram', 'qq'].filter(name => process.argv.includes(`--${name}`));
if (selectedPlatforms.length > 1 || process.argv.slice(2).some(arg => !['--onebot11', '--napcat', '--telegram', '--qq'].includes(arg))) throw new Error('Choose one platform flag: --onebot11, --napcat, --telegram or --qq (default Sandbox)');
const platform = selectedPlatforms[0] ?? 'sandbox';
let gateway;
let gatewaySocket;
let replyWaiter;
let api;
let pendingUpdate;
let updateId = 1;
let gatewayReady = false;
if (platform === 'telegram' || platform === 'qq') {
  api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const method = req.url.split('/').at(-1);
    let result = {};
    if (method === 'getUpdates') {
      await new Promise(resolve => setTimeout(resolve, 200));
      result = pendingUpdate ? [pendingUpdate] : []; pendingUpdate = undefined;
    } else if (method === 'getMe') result = { id: 10001, is_bot: true, first_name: 'fixture', username: 'fixture_bot' };
    else if (method === 'getChatMember') result = { status: 'member', user: { id: body.user_id, is_bot: false, first_name: 'fixture' } };
    else if (method === 'getAppAccessToken') result = { access_token: 'fixture-token', expires_in: 7200 };
    else if (method === 'gateway') result = { url: `ws://127.0.0.1:${gateway.address().port}`, shards: 1, session_start_limit: { total: 1000, remaining: 1000, reset_after: 86400000, max_concurrency: 1 } };
    else if (method === 'sendMessage' || req.url.endsWith('/messages')) {
      result = { message_id: 1001, id: '1001', timestamp: new Date().toISOString(), chat: { id: 20001, type: 'private' }, date: Math.floor(Date.now() / 1000), text: body.text ?? body.content };
      replyWaiter?.({ user_id: body.chat_id ?? '20001', message: body.text ?? body.content });
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(platform === 'telegram' ? { ok: true, result } : result));
  });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  if (platform === 'qq') {
    env.ZHIN_FAKE_QQ_ORIGIN = `http://127.0.0.1:${api.address().port}`;
    env.NODE_OPTIONS = `--import=${path.join(repo, 'scripts/platform-acceptance/qq-network-fixture.mjs')}`;
  }
}
if (['onebot11', 'napcat', 'qq'].includes(platform)) {
  gateway = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => { gateway.once('listening', resolve); gateway.once('error', reject); });
  gateway.on('connection', socket => {
    gatewaySocket = socket; gatewayReady = platform !== 'qq';
    if (platform === 'qq') socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }));
    socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString());
      if (platform === 'qq') {
        if (request.op === 2 || request.op === 6) { gatewayReady = true; socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { version: 1, session_id: 'fixture-session', user: { id: '10001', username: 'fixture', bot: true }, shard: [0, 1] } })); }
        if (request.op === 1) socket.send(JSON.stringify({ op: 11 }));
        return;
      }
      const data = request.action.startsWith('send_') ? { message_id: 1001 } : {};
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: request.echo }));
      if (request.action === 'send_private_msg') replyWaiter?.(request.params);
    });
  });
}

async function run(command, args, cwd, extraEnv = {}) {
  try {
    return await runFile(command, args, { cwd, env: { ...env, ...extraEnv }, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${String(error.stderr ?? '').slice(-6000)}\n${String(error.stdout ?? '').slice(-6000)}`);
  }
}

async function packRoots(roots) {
  const closure = resolveWorkspacePackClosure(workspace, roots);
  const missing = closure.filter((entry) => !packed.has(entry.name));
  if (missing.length === 0) return;
  console.log(`Building and packing ${missing.length} candidate packages…`);
  // Build-time dependencies (including optional Agent types used by CLI) may be
  // wider than the published install closure. Build them without installing them into the fixture.
  await run('pnpm', [...missing.flatMap((entry) => ['--filter', `${entry.name}...`]), 'build'], repo);
  for (const entry of missing) {
    const before = new Set(await readdir(packs));
    await run('pnpm', ['pack', '--pack-destination', packs], entry.dir);
    const files = (await readdir(packs)).filter((file) => file.endsWith('.tgz') && !before.has(file));
    if (files.length !== 1) throw new Error(`Expected one tarball for ${entry.name}`);
    packed.set(entry.name, { tarball: path.join(packs, files[0]) });
  }
}

function candidateManifest(manifest) {
  return withWorkspaceTarballOverrides(manifest, [...packed.keys()].map((name) => ({ name })), packed);
}

async function waitFor(probe, description, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Bot exited before ${description}:\n${output}`);
    }
    const result = await probe();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}:\n${output}`);
}

async function stopBot() {
  if (!child) return;
  const current = child;
  child = undefined;
  if (current.exitCode !== null || current.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => current.kill('SIGKILL'), 15_000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
    current.kill('SIGTERM');
  });
}

async function startBot(mode) {
  output = '';
  const bin = path.join(project, 'node_modules', '@zhin.js', 'cli', 'bin', 'zhin.js');
  child = spawn(process.execPath, ['--experimental-strip-types', bin, 'runtime', 'start', '--mode', mode,
    ...(mode === 'production' ? ['--no-watch'] : [])], {
    cwd: project,
    // Avoid a supervisor subprocess so cleanup always owns the actual Host process.
    env: { ...env, ZHIN_RUNTIME_CHILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (error) => { output += error.message; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => { output = (output + data.toString()).slice(-12_000); });
  }
  // Port 0 delegates allocation to the actual listener, avoiding a reserve/release race.
  return waitFor(async () => {
    const match = /listening http:\/\/127\.0\.0\.1:(\d+)/u.exec(output);
    if (!match) return false;
    const origin = `http://127.0.0.1:${match[1]}`;
    try {
      const response = await fetch(`${origin}/pub/ready`, { signal: AbortSignal.timeout(1_000) });
      return response.ok ? origin : false;
    } catch { return false; }
  }, `${mode} readiness`);
}

async function requestHello(origin, token, expected, probeText = '/hello', expectedSegment) {
  if (platform !== 'sandbox') {
    if (platform !== 'telegram') await waitFor(() => gatewaySocket?.readyState === 1 && gatewayReady, 'fake OneBot gateway connection');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { replyWaiter = undefined; reject(new Error(`${platform} reply timed out:\n${output}`)); }, 10000);
      replyWaiter = params => {
        const text = typeof params.message === 'string' ? params.message : params.message.map(s => s.data?.text ?? '').join('');
        if (String(params.user_id) !== '20001' || !text.includes(expected)) return;
        clearTimeout(timer); replyWaiter = undefined; resolve();
      };
      if (platform === 'telegram') {
        pendingUpdate = { update_id: updateId++, message: { message_id: Date.now(), date: Math.floor(Date.now() / 1000), chat: { id: 20001, type: 'private' }, from: { id: 20001, is_bot: false, first_name: 'fixture' }, text: probeText } };
      } else if (platform === 'qq') {
        gatewaySocket.send(JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', s: updateId++, d: { id: String(Date.now()), author: { user_openid: '20001' }, content: probeText, timestamp: new Date().toISOString() } }));
      } else gatewaySocket.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), self_id: 10001, post_type: 'message', message_type: 'private', sub_type: 'friend', message_id: Date.now(), user_id: 20001, message: [{ type: 'text', data: { text: probeText } }], raw_message: probeText, sender: { user_id: 20001, nickname: 'fixture' } }));
    });
    return;
  }
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `
    import { WebSocket } from 'ws';
    const socket = new WebSocket(process.env.ACCEPTANCE_WS_URL, {
      headers: { Authorization: 'Bearer ' + process.env.ACCEPTANCE_TOKEN },
    });
    const timer = setTimeout(() => { socket.terminate(); process.exitCode = 1; }, 10000);
    socket.on('error', () => { clearTimeout(timer); process.exitCode = 1; });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'private', id: 'sandbox-user', text: process.env.ACCEPTANCE_INPUT })));
    socket.on('message', (data) => {
      const body = JSON.parse(data.toString());
      if (!Array.isArray(body.content)) return;
      if (process.env.ACCEPTANCE_SEGMENT && !body.content.some(segment => segment.type === process.env.ACCEPTANCE_SEGMENT)) return;
      const text = body.content.map(segment => segment.data?.text ?? segment.data?.html ?? '').join('');
      if (!text.includes(process.env.ACCEPTANCE_EXPECTED)) return;
      console.log('reply accepted');
      clearTimeout(timer);
      socket.close();
    });
  `], project, {
    ACCEPTANCE_WS_URL: origin.replace('http:', 'ws:') + '/sandbox',
    ACCEPTANCE_TOKEN: token, ACCEPTANCE_EXPECTED: expected,
    ACCEPTANCE_INPUT: probeText, ACCEPTANCE_SEGMENT: expectedSegment ?? '',
  });
  if (!stdout.includes('reply accepted')) throw new Error(`Sandbox did not reply with ${expected}`);
}

try {
  await mkdir(packs);
  await mkdir(creator);
  await packRoots(['create-zhin-app']);
  await writeFile(path.join(creator, 'package.json'), JSON.stringify(candidateManifest({
    private: true, type: 'module', dependencies: { 'create-zhin-app': `file:${packed.get('create-zhin-app').tarball}` },
    packageManager: 'pnpm@9.0.2',
    pnpm: { overrides: {} },
  }), null, 2));
  await run('pnpm', ['install', '--no-frozen-lockfile'], creator);
  console.log('Creating an empty project with the packed creator CLI…');
  await run(process.execPath, [path.join(creator, 'node_modules/create-zhin-app/lib/index.js'), 'acceptance-bot', '-y', '--skip-install'], creator);
  const manifestFile = path.join(project, 'package.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (platform !== 'sandbox') {
    manifest.dependencies[`@zhin.js/adapter-${platform}`] = '*';
    manifest.zhin.plugins = manifest.zhin.plugins.filter(entry => (typeof entry === 'string' ? entry : entry.package) !== '@zhin.js/adapter-sandbox');
    manifest.zhin.plugins.push({ package: `@zhin.js/adapter-${platform}`, instanceKey: platform });
  }
  const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  await packRoots(names.filter((name) => workspace.some((entry) => entry.name === name)));
  // ws is only a test client dependency; the generated application itself is unchanged.
  await writeFile(manifestFile, JSON.stringify(candidateManifest({
    ...manifest, devDependencies: { ...manifest.devDependencies, ws: '^8.21.1' },
  }), null, 2));
  // Modern generated projects keep pnpm settings in the workspace file. The
  // candidate overrides must apply there as well, including unpublished names.
  const workspaceFile = path.join(project, 'pnpm-workspace.yaml');
  const workspaceConfig = parse(await readFile(workspaceFile, 'utf8'));
  workspaceConfig.overrides = {
    ...workspaceConfig.overrides,
    ...candidateManifest({}).pnpm.overrides,
  };
  await writeFile(workspaceFile, stringify(workspaceConfig));
  console.log('Installing the generated project exclusively against candidate workspace tarballs…');
  await run('pnpm', ['install', '--no-frozen-lockfile'], project);
  const configFile = path.join(project, 'zhin.config.yml');
  const config = parse(await readFile(configFile, 'utf8'));
  const token = 'local-acceptance-token';
  if (platform !== 'sandbox') {
    delete config.plugins.sandbox;
    config.plugins[platform] = platform === 'telegram'
      ? { polling: true, apiBaseUrl: `http://127.0.0.1:${api.address().port}`, endpoints: [{ id: 'fixture-bot', token: 'fixture-token' }] }
      : platform === 'qq'
      ? { mode: 'websocket', endpoints: [{ id: 'fixture-bot', appid: '10001', secret: 'fixture-secret', accessTokenUrl: `${env.ZHIN_FAKE_QQ_ORIGIN}/getAppAccessToken`, gatewayUrl: `${env.ZHIN_FAKE_QQ_ORIGIN}/gateway` }] }
      : { connection: 'ws', endpoints: [{ id: 'fixture-bot', url: `ws://127.0.0.1:${gateway.address().port}`, access_token: 'fixture-token' }] };
  }
  if (platform !== 'sandbox') config.plugins[platform].commandPrefix = '/';
  config.http = { ...config.http, host: '127.0.0.1', port: 0, token,
    readiness: { endpoints: [{ owner: `root/${platform}`, name: platform === 'sandbox' ? 'sandbox~sandbox-bot' : `${platform}~fixture-bot` }] } };
  await writeFile(configFile, stringify(config));
  if (platform !== 'sandbox') {
    const probeDirectory = path.join(project, 'commands/acceptance');
    await mkdir(probeDirectory, { recursive: true });
    await writeFile(path.join(probeDirectory, 'index.ts'), await readFile(path.join(repo, 'scripts/platform-acceptance/probe-command.ts'), 'utf8'));
    env.ZHIN_ACCEPTANCE_POLICY = path.join(temp, 'policy.json');
    await writeFile(env.ZHIN_ACCEPTANCE_POLICY, JSON.stringify({ version: 1, platform, mode: platform === 'telegram' ? 'polling' : 'websocket', targets: [{ alias: 'fixture-private', adapter: `root/${platform}`, endpoint: 'fixture-bot', kind: 'private', id: '20001' }], actions: ['reply-text'], minIntervalMs: 1000, maxSends: 10, eventsPath: path.join(temp, 'probe-events.jsonl') }));
  }
  console.log('Checking development startup, /hello and command HMR…');
  const origin = await startBot('development');
  await requestHello(origin, token, '你好！欢迎使用 Zhin.js！');
  const details = async () => {
    const response = await fetch(`${origin}/api/system/readiness`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000),
    });
    return (await response.json()).data;
  };
  const previous = await details();
  if (platform === 'sandbox') {
    const previewResponse = await fetch(`${origin}/api/introspection/components/render`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: { title: 'candidate Console JSX accepted', lines: [] } }),
      signal: AbortSignal.timeout(10_000),
    });
    const preview = await previewResponse.json();
    if (!previewResponse.ok || preview.data?.output?.type !== 'html'
      || !preview.data.output.data?.html?.includes('candidate Console JSX accepted')) {
      throw new Error(`Console JSX preview failed: ${JSON.stringify(preview)}`);
    }
    await requestHello(origin, token, 'acceptance-bot', '/card', 'html');
    const componentFile = path.join(project, 'components/status-card/index.tsx');
    await writeFile(componentFile, (await readFile(componentFile, 'utf8')).replace('<CardHeader title={title}', '<CardHeader title="candidate JSX HMR accepted"'));
    await waitFor(async () => (await details()).generation > previous.generation, 'TSX component generation replacement');
    await requestHello(origin, token, 'candidate JSX HMR accepted', '/card', 'html');
  }
  const beforeCommand = await details();
  const command = path.join(project, 'commands', 'hello', 'index.ts');
  await writeFile(command, (await readFile(command, 'utf8')).replace('你好！欢迎使用 Zhin.js！', 'candidate HMR accepted'));
  await waitFor(async () => (await details()).generation > beforeCommand.generation, 'command generation replacement');
  await requestHello(origin, token, 'candidate HMR accepted');
  await stopBot();
  console.log('Checking production restart and persisted command…');
  const production = await startBot('production');
  await requestHello(production, token, 'candidate HMR accepted');
  if (platform === 'sandbox') await requestHello(production, token, 'candidate JSX HMR accepted', '/card', 'html');
  await run(process.execPath, [path.join(project, 'node_modules/@zhin.js/cli/bin/zhin.js'),
    'doctor', '--live', production, '--json'], project, { ZHIN_HTTP_TOKEN: token });
  if (platform !== 'sandbox') {
    await requestHello(production, token, 'acceptance:fixture-private:sample0001', '/acceptance probe:sample0001');
    await waitFor(async () => {
      try { const probeEvents = (await readFile(path.join(temp, 'probe-events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); return probeEvents.at(-1)?.result === 'confirmed'; } catch { return false; }
    }, 'installed acceptance probe confirmed delivery');
  }
  passed = true;
  console.log(`PASS [${platform}]: packed creator -> clean install -> readiness -> /hello${platform === 'sandbox' ? ' -> Console JSX preview -> JSX /card + TSX HMR' : ''} -> command HMR -> production restart${platform !== 'sandbox' ? ' -> acceptance probe receipt' : ''}.`);
} finally {
  await stopBot();
  if (gateway) { for (const socket of gateway.clients) socket.terminate(); await new Promise(resolve => gateway.close(resolve)); }
  if (api) await new Promise(resolve => api.close(resolve));
  if (passed || process.env.ZHIN_KEEP_ACCEPTANCE_TEMP !== '1') await rm(temp, { recursive: true, force: true });
  else console.error(`Acceptance fixture retained: ${temp}`);
}
