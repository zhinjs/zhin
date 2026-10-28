import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SelfChangePluginTestResult,
  SelfChangePluginTestRunner,
  SelfChangeSandboxLoadRequest,
} from '@zhin.js/agent';
import {
  copyPluginRootWithDraft,
  CopyLimitError,
  isWithin,
  nearestNodeModules,
  runTrialExclusive,
  SELF_CHANGE_TRIAL_DIR_PREFIX,
  SKIPPED_DIRS,
  sweepStaleTrialDirs,
} from './self-change-sandbox.js';

/**
 * ADR 0040 §3.2 plugin self-tests. The draft's plugin root is copied into the system temp dir with
 * the draft applied (same copy as the §3.3 sandbox load), then the plugin's own tests run in an
 * isolated container like the P0-c shell: the copy is the only writable mount, the installed
 * dependencies are mounted read-only, there is no network, all capabilities are dropped, and the
 * container is removed when it exits (or is killed by name on timeout). Draft code never runs in
 * the Host process or on the host outside a container — without Docker the stage is `skipped`.
 *
 * Runner: vitest when it is installed for the plugin root, otherwise `node --test`.
 * A root whose tests fail even without the draft (or cannot run in the container at all, e.g.
 * host-built native binaries) is `skipped`, not blamed on the draft.
 *
 * Disk: shares the one-trial-at-a-time queue and the `zhin-change-trial-*` prefix with the sandbox
 * loader; the copy is removed when the run ends, and stale copies are swept on creation.
 */
export interface SelfChangePluginTestOptions {
  readonly projectRoot: string;
  /** Container image; never pulled by the trial (no network), so it must be present locally. */
  readonly image?: string;
  readonly tmpRoot?: string;
  readonly timeoutMs?: number;
  readonly maxCopyBytes?: number;
  readonly maxCopyFiles?: number;
  /** Runs `docker <args>`; injectable for tests. */
  readonly docker?: DockerExec;
  readonly now?: () => number;
}

export interface DockerExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type DockerExec = (args: readonly string[], timeoutMs: number) => Promise<DockerExecResult>;

export const DEFAULT_PLUGIN_TEST_IMAGE = 'node:22-bookworm-slim';
const DEFAULT_TIMEOUT_MS = 120_000;
const DOCKER_PROBE_TIMEOUT_MS = 10_000;
const CONTAINER_WORKSPACE = '/workspace';
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/iu;
const MAX_TEST_FILES = 200;
const MAX_OUTPUT = 256 * 1024;
const MAX_MESSAGE_CHARS = 1_000;

export function createSelfChangePluginTestRunner(options: SelfChangePluginTestOptions): SelfChangePluginTestRunner {
  const projectRoot = resolve(options.projectRoot);
  const tmpRoot = options.tmpRoot ?? tmpdir();
  const now = options.now ?? Date.now;
  const image = options.image ?? DEFAULT_PLUGIN_TEST_IMAGE;
  const docker = options.docker ?? spawnDocker;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const swept = sweepStaleTrialDirs(tmpRoot, now()).catch(() => undefined);
  return request => runTrialExclusive(async () => {
    await swept;
    return testOnce(request);
  });

  async function testOnce(request: SelfChangeSandboxLoadRequest): Promise<SelfChangePluginTestResult> {
    const source = resolve(projectRoot, request.pluginRoot);
    if (!isWithin(projectRoot, source)) return { status: 'failed', message: `plugin root ${request.pluginRoot} is outside the project` };
    const modules = await nearestNodeModules(source);
    if (!modules) return { status: 'skipped', message: 'no installed node_modules for this plugin root' };

    const withDraft = await runTests(source, modules, request);
    if (withDraft.status !== 'failed') return withDraft;
    // Tests that fail even without the draft are not the draft's fault.
    const baseline = await runTests(source, modules, { ...request, writes: [], deletes: [] });
    if (baseline.status === 'failed') {
      return { status: 'skipped', message: `the plugin tests do not pass in the trial container even without this change: ${baseline.message ?? ''}` };
    }
    return withDraft;
  }

  async function runTests(source: string, modules: string, request: SelfChangeSandboxLoadRequest): Promise<SelfChangePluginTestResult> {
    const dir = await fs.mkdtemp(join(tmpRoot, SELF_CHANGE_TRIAL_DIR_PREFIX));
    try {
      try {
        await copyPluginRootWithDraft(source, dir, request, options);
      } catch (error) {
        if (error instanceof CopyLimitError) return { status: 'skipped', message: error.message };
        throw error;
      }
      const tests = await findPluginTests(dir);
      if (!tests.length) return { status: 'skipped', message: 'the plugin has no tests' };
      const probe = await docker(['image', 'inspect', '--format', '{{.Id}}', image], DOCKER_PROBE_TIMEOUT_MS).catch(() => null);
      if (!probe || probe.code !== 0) {
        return { status: 'skipped', message: `no isolated container on this host (Docker with image ${image}); plugin tests were not run` };
      }
      const name = `zhin-change-test-${randomUUID()}`;
      const args = buildPluginTestDockerArgs({ name, image, copy: dir, modules, command: testCommand(modules, tests), ...currentUser() });
      const result = await docker(args, timeoutMs);
      if (result.timedOut) {
        await docker(['rm', '-f', name], DOCKER_PROBE_TIMEOUT_MS).catch(() => undefined);
        return { status: 'failed', message: `plugin tests did not finish within ${Math.round(timeoutMs / 1000)}s` };
      }
      if (result.code === 0) return { status: 'passed' };
      return { status: 'failed', message: outputTail(result.stdout, result.stderr) || `plugin tests exited with code ${result.code}` };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Test files in the copy (posix paths relative to it), sorted; skips dependency / build dirs and symlinks. */
export async function findPluginTests(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(rel: string): Promise<void> {
    for (const entry of await fs.readdir(join(root, rel), { withFileTypes: true })) {
      if (found.length >= MAX_TEST_FILES) return;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(child);
      } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        found.push(child);
      }
    }
  }
  await walk('');
  return found.sort();
}

/** vitest when installed for the plugin root, otherwise Node's built-in runner on the found files. */
export function testCommand(modules: string, tests: readonly string[]): string[] {
  if (existsSync(join(modules, 'vitest', 'vitest.mjs'))) return ['node', 'node_modules/vitest/vitest.mjs', 'run'];
  return ['node', '--test', ...tests];
}

export interface PluginTestDockerArgs {
  readonly name: string;
  readonly image: string;
  /** Host path of the draft copy (mounted read-write). */
  readonly copy: string;
  /** Host path of the installed dependencies (mounted read-only). */
  readonly modules: string;
  readonly command: readonly string[];
  readonly uid?: number;
  readonly gid?: number;
}

/** `docker run` arguments (pure). Mirrors the P0-c isolated shell: read-only rootfs, no network, no capabilities. */
export function buildPluginTestDockerArgs(input: PluginTestDockerArgs): string[] {
  return [
    'run',
    '--rm',
    '--name', input.name,
    '--read-only',
    '--tmpfs', '/tmp:size=128m',
    '--network', 'none',
    '--memory', '1024m',
    '--cpus', '1',
    '--pids-limit', '256',
    '--security-opt', 'no-new-privileges',
    '--cap-drop', 'ALL',
    ...(input.uid !== undefined && input.gid !== undefined ? ['--user', `${input.uid}:${input.gid}`] : []),
    '--workdir', CONTAINER_WORKSPACE,
    '--mount', mountArg(['type=bind', `source=${input.copy}`, `target=${CONTAINER_WORKSPACE}`]),
    '--mount', mountArg(['type=bind', `source=${input.modules}`, `target=${CONTAINER_WORKSPACE}/node_modules`, 'readonly']),
    // Only what the test runner needs; no Host env (tokens) is passed into the container.
    '-e', 'NODE_ENV=test',
    '-e', 'CI=1',
    '-e', 'HOME=/tmp',
    input.image,
    ...input.command,
  ];
}

/** One `--mount` value, CSV-quoted per field when a path carries a comma or a quote. */
function mountArg(fields: readonly string[]): string {
  return fields.map(field => (/[,"]/u.test(field) ? `"${field.replace(/"/g, '""')}"` : field)).join(',');
}

function currentUser(): { uid?: number; gid?: number } {
  // Docker Desktop (macOS / Windows) maps ownership itself; on Linux run as the Host user so the copy stays writable.
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return {};
  return { uid: process.getuid(), gid: process.getgid() };
}

/** Last lines of the run output: the failing test summary is at the end. */
function outputTail(stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/gu, '').trim();
  return text.length > MAX_MESSAGE_CHARS ? `…${text.slice(-(MAX_MESSAGE_CHARS - 1))}` : text;
}

const spawnDocker: DockerExec = (args, timeoutMs) => new Promise(resolvePromise => {
  const child = spawn('docker', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const take = (current: string, chunk: Buffer) => current.length >= MAX_OUTPUT ? current : current + chunk.toString('utf8');
  child.stdout.on('data', (chunk: Buffer) => { stdout = take(stdout, chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = take(stderr, chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', error => {
    clearTimeout(timer);
    resolvePromise({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut: false });
  });
  child.on('close', code => {
    clearTimeout(timer);
    resolvePromise({ code, stdout, stderr, timedOut });
  });
});
