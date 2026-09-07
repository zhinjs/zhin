#!/usr/bin/env node
/** Published-consumer acceptance: tarballs -> creator CLI -> empty project -> real IM IO. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
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

async function requestHello(origin, token, expected) {
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `
    import { WebSocket } from 'ws';
    const socket = new WebSocket(process.env.ACCEPTANCE_WS_URL, {
      headers: { Authorization: 'Bearer ' + process.env.ACCEPTANCE_TOKEN },
    });
    const timer = setTimeout(() => { socket.terminate(); process.exitCode = 1; }, 10000);
    socket.on('error', () => { clearTimeout(timer); process.exitCode = 1; });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'private', id: 'sandbox-user', text: '/hello' })));
    socket.on('message', (data) => {
      const body = JSON.parse(data.toString());
      if (!Array.isArray(body.content)) return;
      const text = body.content.map(segment => segment.data?.text ?? '').join('');
      if (!text.includes(process.env.ACCEPTANCE_EXPECTED)) return;
      console.log('reply accepted');
      clearTimeout(timer);
      socket.close();
    });
  `], project, {
    ACCEPTANCE_WS_URL: origin.replace('http:', 'ws:') + '/sandbox',
    ACCEPTANCE_TOKEN: token, ACCEPTANCE_EXPECTED: expected,
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
  const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  await packRoots(names.filter((name) => workspace.some((entry) => entry.name === name)));
  // ws is only a test client dependency; the generated application itself is unchanged.
  await writeFile(manifestFile, JSON.stringify(candidateManifest({
    ...manifest, devDependencies: { ...manifest.devDependencies, ws: '^8.21.1' },
  }), null, 2));
  console.log('Installing the generated project exclusively against candidate workspace tarballs…');
  await run('pnpm', ['install', '--no-frozen-lockfile'], project);
  const configFile = path.join(project, 'zhin.config.yml');
  const config = parse(await readFile(configFile, 'utf8'));
  const token = 'local-acceptance-token';
  config.http = { ...config.http, host: '127.0.0.1', port: 0, token,
    readiness: { endpoints: [{ owner: 'root/sandbox', name: 'sandbox~sandbox-bot' }] } };
  await writeFile(configFile, stringify(config));
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
  const command = path.join(project, 'commands', 'hello.ts');
  await writeFile(command, (await readFile(command, 'utf8')).replace('你好！欢迎使用 Zhin.js！', 'candidate HMR accepted'));
  await waitFor(async () => (await details()).generation > previous.generation, 'command generation replacement');
  await requestHello(origin, token, 'candidate HMR accepted');
  await stopBot();
  console.log('Checking production restart and persisted command…');
  const production = await startBot('production');
  await requestHello(production, token, 'candidate HMR accepted');
  await run(process.execPath, [path.join(project, 'node_modules/@zhin.js/cli/bin/zhin.js'),
    'doctor', '--live', production, '--json'], project, { ZHIN_HTTP_TOKEN: token });
  passed = true;
  console.log('PASS: packed creator -> clean install -> readiness -> /hello -> HMR -> production restart.');
} finally {
  await stopBot();
  if (passed || process.env.ZHIN_KEEP_ACCEPTANCE_TEMP !== '1') await rm(temp, { recursive: true, force: true });
  else console.error(`Acceptance fixture retained: ${temp}`);
}
