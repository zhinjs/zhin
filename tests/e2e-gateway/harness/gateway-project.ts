// Disposable copy of examples/minimal-bot driven through the real built `zhin` binary.
// Framework packages are linked from this checkout (never installed); the package manager is a
// fake `pnpm` on PATH, so dependency transactions never reach the network or the real store.
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const zhinBin = join(repositoryRoot, 'basic/cli/bin/zhin.js');
const exampleRoot = join(repositoryRoot, 'examples/minimal-bot');
const copiedEntries = ['adapters', 'commands', 'components', 'middlewares', 'tools', 'plugin.ts', 'package.json', 'schema.json', 'zhin.config.yml', '.env.example'];

export interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GatewayProjectOptions {
  /** Packages the fake `pnpm add` links instead of writing a broken plugin (`name` → directory). */
  readonly linkPackages?: Readonly<Record<string, string>>;
  /** Extra YAML appended to zhin.config.yml. */
  readonly extraConfig?: string;
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('no port'))));
    });
  });
}

/** Child environment without the Vitest process state (NODE_ENV=test, VITEST_*, development condition). */
function childEnvironment(binDirectory: string, extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITEST') || key === 'NODE_ENV' || key === 'L4_SKIP_PLATFORM' || key === 'TEST' || key.startsWith('ZHIN_')) continue;
    env[key] = value;
  }
  if (env.NODE_OPTIONS) env.NODE_OPTIONS = env.NODE_OPTIONS.replace(/--conditions[= ]development/gu, '').trim();
  env.PATH = `${binDirectory}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
  env.NO_COLOR = '1';
  return { ...env, ...extra };
}

export class GatewayProject {
  readonly origin: string;
  readonly env: NodeJS.ProcessEnv;

  constructor(readonly root: string, readonly port: number, binDirectory: string, linkPackages: Readonly<Record<string, string>>) {
    this.origin = `http://127.0.0.1:${port}`;
    this.env = childEnvironment(binDirectory, {
      ZHIN_E2E_LINK_PACKAGES: Object.entries(linkPackages).map(([name, directory]) => `${name}=${directory}`).join(';'),
    });
  }

  path(relativePath: string): string { return join(this.root, relativePath); }
  read(relativePath: string): Promise<string> { return readFile(this.path(relativePath), 'utf8'); }

  /** Runs `zhin <args>` in the project; never throws on a non-zero exit. */
  zhin(args: readonly string[], options: { readonly input?: string; readonly timeoutMs?: number } = {}): Promise<CliResult> {
    return new Promise((resolveResult, reject) => {
      const child = execFile(process.execPath, [zhinBin, ...args], {
        cwd: this.root,
        env: this.env,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 16 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number' && !error.killed) { reject(error); return; }
        if (error?.killed) { reject(new Error(`zhin ${args.join(' ')} timed out\n${stdout}\n${stderr}`)); return; }
        resolveResult({ code: error ? Number(error.code) : 0, stdout, stderr });
      });
      if (options.input !== undefined) child.stdin?.end(options.input);
      else child.stdin?.end();
    });
  }

  async status(): Promise<StatusJson> {
    const result = await this.zhin(['status', '--json']);
    return JSON.parse(result.stdout) as StatusJson;
  }

  fetch(path: string, init: RequestInit & { readonly token?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    return fetch(`${this.origin}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
  }

  async json<T = any>(path: string, init: RequestInit & { readonly token?: string } = {}): Promise<{ status: number; headers: Headers; body: T }> {
    const response = await this.fetch(path, init);
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, headers: response.headers, body: body as T };
  }

  /** `POST /api/console/request` (Console RPC); gateway RPCs read `data`. */
  rpc<T = any>(token: string | undefined, type: string, data?: unknown): Promise<{ status: number; headers: Headers; body: T }> {
    return this.rpcMessage<T>(token, { type, ...(data === undefined ? {} : { data }) });
  }

  /** Console RPC with the fields at the top level of the message (instance `config:*` / `feature.*`). */
  rpcMessage<T = any>(token: string | undefined, message: Readonly<Record<string, unknown>>): Promise<{ status: number; headers: Headers; body: T }> {
    return this.json<T>('/api/console/request', {
      method: 'POST',
      ...(token ? { token } : {}),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: `e2e-${String(message.type)}`, ...message }),
    });
  }

  async login(username: string, password: string): Promise<{ token: string; userId: string }> {
    const response = await this.json('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.status !== 200) throw new Error(`login ${username} failed: ${response.status} ${JSON.stringify(response.body)}`);
    return { token: response.body.data.token, userId: response.body.data.user.id };
  }

  /** Stops a gateway left running by a failed test (best effort), then removes the copy. */
  async dispose(): Promise<void> {
    if (existsSync(this.path('.zhin/gateway.json'))) {
      await this.zhin(['stop', '--timeout', '30000'], { timeoutMs: 45_000 }).catch(() => undefined);
    }
    await rm(this.root, { recursive: true, force: true });
  }
}

export interface StatusJson {
  readonly gateway: { readonly running: boolean; readonly pid?: number; readonly ports?: readonly number[]; readonly socket?: string; readonly mode?: string };
  readonly instance: null | {
    readonly state: string;
    readonly pid?: number;
    readonly generation?: number;
    readonly startedAt?: number;
    readonly recentRestarts?: number;
    readonly lastFailure?: { readonly reason: string; readonly message: string };
  };
  readonly consoleInitialized?: boolean;
}

/** Links every installed dependency of examples/minimal-bot into a real node_modules directory. */
async function linkDependencies(root: string): Promise<void> {
  const source = join(exampleRoot, 'node_modules');
  const target = join(root, 'node_modules');
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      await mkdir(join(target, entry), { recursive: true });
      for (const scoped of await readdir(join(source, entry))) {
        await symlink(await realpath(join(source, entry, scoped)), join(target, entry, scoped), 'dir');
      }
      continue;
    }
    await symlink(await realpath(join(source, entry)), join(target, entry), 'dir');
  }
}

export async function createGatewayProject(label: string, options: GatewayProjectOptions = {}): Promise<GatewayProject> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `zhin-e2e-gateway-${label}-`)));
  for (const entry of copiedEntries) {
    await cp(join(exampleRoot, entry), join(root, entry), { recursive: true });
  }
  // The example's tsconfig extends the repository base by a relative path.
  const tsconfig = JSON.parse(await readFile(join(exampleRoot, 'tsconfig.json'), 'utf8')) as Record<string, unknown>;
  tsconfig.extends = join(repositoryRoot, 'tsconfig.base.json');
  await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  await linkDependencies(root);
  // A lockfile makes the gateway pick pnpm and lets the rollback reinstall with --frozen-lockfile.
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n");
  const port = await freePort();
  const config = await readFile(join(root, 'zhin.config.yml'), 'utf8');
  await writeFile(join(root, 'zhin.config.yml'), `${config.trimEnd()}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n${options.extraConfig ?? ''}`);
  const bin = join(root, '.e2e-bin');
  await mkdir(bin, { recursive: true });
  await cp(fileURLToPath(new URL('./fake-pnpm.mjs', import.meta.url)), join(bin, 'pnpm'));
  await chmod(join(bin, 'pnpm'), 0o755);
  return new GatewayProject(root, port, bin, options.linkPackages ?? {});
}

export const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Polls `probe` until it returns a value other than `undefined`. */
export async function waitFor<T>(label: string, probe: () => Promise<T | undefined>, timeoutMs = 60_000, intervalMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ''}`);
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** True when nothing accepts TCP connections on the port. */
export async function portClosed(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/pub/health`, { signal: AbortSignal.timeout(2_000) });
    return false;
  } catch { return true; }
}

