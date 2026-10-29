import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SelfChangeSandboxCapability,
  SelfChangeSandboxLoader,
  SelfChangeSandboxLoadRequest,
  SelfChangeSandboxLoadResult,
} from '@zhin.js/agent';

/**
 * ADR 0040 §3.3 sandbox load. Each request copies one plugin root into a fresh directory under the
 * system temp dir, applies the draft there, and loads it with the trial runtime in a child process
 * (`self-change-sandbox-runner`). The draft never executes in the Host process and never touches
 * the project. The child gets a scrubbed environment (no tokens, no `.env*` files in the copy), no
 * configured plugin instances or endpoints, and a hard timeout.
 *
 * Disk: one trial at a time; the copy is capped; the temp dir is removed when the trial ends, and
 * leftovers of a crashed Host (`zhin-change-trial-*` older than an hour) are swept on creation.
 */
export interface SelfChangeSandboxOptions {
  readonly projectRoot: string;
  /** Runner script; defaults to the compiled runner next to this module. */
  readonly runner?: string;
  readonly tmpRoot?: string;
  readonly timeoutMs?: number;
  readonly maxCopyBytes?: number;
  readonly maxCopyFiles?: number;
  readonly now?: () => number;
}

export const SELF_CHANGE_TRIAL_DIR_PREFIX = 'zhin-change-trial-';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_COPY_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_COPY_FILES = 5_000;
const STALE_TRIAL_DIR_MS = 60 * 60 * 1000;
const MAX_CHILD_OUTPUT = 256 * 1024;
const MAX_MESSAGE_CHARS = 1_000;
/** Never copied: dependencies, build output, VCS, Host state and secrets. */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', '.zhin', 'data', 'lib', 'dist', 'logs', 'coverage', '.turbo', '.cache']);
const SKIPPED_FILE = /^\.env(?:\..*)?$/iu;
/** Only what module loading needs; tokens and Host settings stay out of the trial. */
const CHILD_ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT'] as const;

export class CopyLimitError extends Error {}

/**
 * One trial copy at a time across the sandbox loader and the plugin-test runner (§3.2 / §3.3), so at
 * most one `zhin-change-trial-*` copy exists per Host.
 */
let trialQueue: Promise<unknown> = Promise.resolve();
export function runTrialExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = trialQueue.then(task);
  trialQueue = run.catch(() => undefined);
  return run;
}

export function createSelfChangeSandboxLoader(options: SelfChangeSandboxOptions): SelfChangeSandboxLoader {
  const projectRoot = resolve(options.projectRoot);
  const tmpRoot = options.tmpRoot ?? tmpdir();
  const now = options.now ?? Date.now;
  const runner = options.runner ?? fileURLToPath(new URL('./self-change-sandbox-runner.js', import.meta.url));
  const swept = sweepStaleTrialDirs(tmpRoot, now()).catch(() => undefined);
  return request => runTrialExclusive(async () => {
    await swept;
    return loadOnce(request);
  });

  async function loadOnce(request: SelfChangeSandboxLoadRequest): Promise<SelfChangeSandboxLoadResult> {
    const source = resolve(projectRoot, request.pluginRoot);
    if (!isWithin(projectRoot, source)) return { status: 'failed', message: `plugin root ${request.pluginRoot} is outside the project` };
    if (!existsSync(runner)) return { status: 'skipped', message: 'trial runtime is not built on this host' };
    const modules = await nearestNodeModules(source);
    if (!modules) return { status: 'skipped', message: 'no installed node_modules for this plugin root' };

    const withDraft = await runTrial(source, modules, request);
    if (withDraft.status !== 'failed') return withDraft;
    // A root that does not load even without the draft is not the draft's fault.
    const baseline = await runTrial(source, modules, { ...request, writes: [], deletes: [] });
    if (baseline.status === 'failed') {
      return { status: 'skipped', message: `the plugin root does not load in the trial runtime even without this change: ${baseline.message ?? ''}` };
    }
    return withDraft;
  }

  async function runTrial(source: string, modules: string, request: SelfChangeSandboxLoadRequest): Promise<SelfChangeSandboxLoadResult> {
    const dir = await fs.mkdtemp(join(tmpRoot, SELF_CHANGE_TRIAL_DIR_PREFIX));
    try {
      try {
        await copyPluginRootWithDraft(source, dir, request, options);
      } catch (error) {
        if (error instanceof CopyLimitError) return { status: 'skipped', message: error.message };
        throw error;
      }
      await fs.symlink(modules, join(dir, 'node_modules'), 'junction');
      return await spawnRunner(runner, dir, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Copies `source` (a plugin root) into `dir` and applies the draft there. Throws
 * {@link CopyLimitError} when the root is larger than the copy limit. Never links `node_modules`.
 */
export async function copyPluginRootWithDraft(
  source: string,
  dir: string,
  request: SelfChangeSandboxLoadRequest,
  limits: { readonly maxCopyBytes?: number; readonly maxCopyFiles?: number } = {},
): Promise<void> {
  await copyTree(source, dir, { bytes: 0, files: 0, maxBytes: limits.maxCopyBytes ?? DEFAULT_MAX_COPY_BYTES, maxFiles: limits.maxCopyFiles ?? DEFAULT_MAX_COPY_FILES });
  await rewriteTsconfigExtends(source, dir);
  for (const target of request.deletes) await fs.rm(inside(dir, localPath(request.pluginRoot, target)), { recursive: true, force: true });
  for (const file of request.writes) {
    const destination = inside(dir, localPath(request.pluginRoot, file.path));
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, 'utf8');
  }
}

/** Removes `zhin-change-trial-*` dirs older than an hour (left behind by a crashed Host). */
export async function sweepStaleTrialDirs(tmpRoot: string, now: number, maxAgeMs = STALE_TRIAL_DIR_MS): Promise<number> {
  let removed = 0;
  for (const entry of await fs.readdir(tmpRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(SELF_CHANGE_TRIAL_DIR_PREFIX)) continue;
    const target = join(tmpRoot, entry.name);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat || now - stat.mtimeMs < maxAgeMs) continue;
    await fs.rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function spawnRunner(runner: string, cwd: string, timeoutMs: number): Promise<SelfChangeSandboxLoadResult> {
  const env: Record<string, string> = { NODE_ENV: 'test', TMPDIR: tmpdir() };
  for (const key of CHILD_ENV_KEYS) if (process.env[key]) env[key] = process.env[key]!;
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [runner, cwd], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const take = (current: string, chunk: Buffer) => current.length >= MAX_CHILD_OUTPUT ? current : current + chunk.toString('utf8');
    child.stdout.on('data', (chunk: Buffer) => { stdout = take(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = take(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      resolvePromise({ status: 'failed', message: `trial runtime could not start: ${error.message}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      killTree(child.pid);
      if (timedOut) {
        resolvePromise({ status: 'failed', message: `loading did not finish within ${Math.round(timeoutMs / 1000)}s (top-level code must not block)` });
        return;
      }
      resolvePromise(parseRunnerOutput(stdout, stderr));
    });
  });
}

export function parseRunnerOutput(stdout: string, stderr: string): SelfChangeSandboxLoadResult {
  const line = stdout.trim().split('\n').reverse().find(item => item.startsWith('{'));
  let parsed: { ok?: unknown; error?: unknown; capabilities?: unknown } | undefined;
  try {
    parsed = line ? JSON.parse(line) as typeof parsed : undefined;
  } catch {
    parsed = undefined;
  }
  if (parsed?.ok === true && Array.isArray(parsed.capabilities)) {
    const capabilities: SelfChangeSandboxCapability[] = parsed.capabilities
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(item => Object.freeze({ feature: String(item.feature ?? ''), localName: String(item.localName ?? ''), source: String(item.source ?? '') }));
    return { status: 'passed', capabilities: Object.freeze(capabilities) };
  }
  const reason = typeof parsed?.error === 'string' ? parsed.error : stderr.trim() || 'trial runtime exited without a result';
  return { status: 'failed', message: firstLines(reason) };
}

/** Keep the message and its first frames; drop the rest of the stack. */
function firstLines(message: string): string {
  return message.split('\n').slice(0, 4).join('\n').slice(0, MAX_MESSAGE_CHARS);
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGKILL');
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

async function copyTree(
  from: string,
  to: string,
  budget: { bytes: number; files: number; readonly maxBytes: number; readonly maxFiles: number },
): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await copyTree(source, target, budget);
      continue;
    }
    // Symlinks are not followed: the trial must not read outside the plugin root through the copy.
    if (!entry.isFile() || SKIPPED_FILE.test(entry.name)) continue;
    const { size } = await fs.stat(source);
    budget.bytes += size;
    budget.files += 1;
    if (budget.files > budget.maxFiles || budget.bytes > budget.maxBytes) {
      throw new CopyLimitError(`the plugin root is larger than the trial copy limit (${budget.maxFiles} files / ${Math.round(budget.maxBytes / 1024 / 1024)} MB)`);
    }
    await fs.copyFile(source, target);
  }
}

/** `extends: "../../tsconfig.base.json"` would dangle in the copy; point it back at the original. */
async function rewriteTsconfigExtends(source: string, dir: string): Promise<void> {
  for (const name of await fs.readdir(dir)) {
    if (!/^tsconfig.*\.json$/iu.test(name)) continue;
    const file = join(dir, name);
    const text = await fs.readFile(file, 'utf8');
    const next = text.replace(/("extends"\s*:\s*)"(\.{1,2}\/[^"]*)"/gu, (_match, key: string, target: string) =>
      `${key}${JSON.stringify(resolve(source, target))}`);
    if (next !== text) await fs.writeFile(file, next, 'utf8');
  }
}

export async function nearestNodeModules(start: string): Promise<string | undefined> {
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) return fs.realpath(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

function localPath(pluginRoot: string, target: string): string {
  const prefix = pluginRoot.replace(/\\/gu, '/').replace(/\/+$/u, '');
  return prefix && target.startsWith(`${prefix}/`) ? target.slice(prefix.length + 1) : target;
}

function inside(root: string, target: string): string {
  const resolved = resolve(root, target);
  if (!isWithin(root, resolved) || resolved === root) throw new Error(`draft path ${target} escapes the trial copy`);
  return resolved;
}

export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
