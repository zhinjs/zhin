import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SELF_CHANGE_TRIAL_DIR_PREFIX,
  createSelfChangeSandboxLoader,
  parseRunnerOutput,
  sweepStaleTrialDirs,
} from '../../../src/plugin-runtime/agent/self-change-sandbox.js';

const repoRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));

/**
 * Fake runner: reports what the trial copy looks like, so the test sees exactly what the child got.
 * `hang` blocks forever; `crash` exits with an error line.
 */
const FAKE_RUNNER = `
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
if (existsSync(join(root, 'hang'))) setInterval(() => {}, 1000);
else if (existsSync(join(root, 'crash'))) { console.log(JSON.stringify({ ok: false, error: 'Error: crash at load\\n    at x' })); process.exit(1); }
else {
  const walk = (dir, prefix = '') => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (name === 'node_modules') return [prefix + name];
    return statSync(full).isDirectory() ? walk(full, prefix + name + '/') : [prefix + name];
  });
  const tsconfig = existsSync(join(root, 'tsconfig.json')) ? readFileSync(join(root, 'tsconfig.json'), 'utf8') : '';
  console.log(JSON.stringify({ ok: true, capabilities: [
    { feature: 'probe', localName: 'files', source: JSON.stringify(walk(root)) },
    { feature: 'probe', localName: 'env', source: JSON.stringify(Object.keys(process.env).sort()) },
    { feature: 'probe', localName: 'tsconfig', source: tsconfig },
  ] }));
}
`;

let base: string;
let project: string;
let tmpRoot: string;
let runner: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'zhin-sandbox-test-'));
  project = join(base, 'project');
  tmpRoot = join(base, 'tmp');
  mkdirSync(join(project, 'commands', 'hello'), { recursive: true });
  mkdirSync(join(project, 'node_modules', 'dep'), { recursive: true });
  mkdirSync(join(project, '.zhin', 'changes'), { recursive: true });
  mkdirSync(join(project, 'data'), { recursive: true });
  mkdirSync(tmpRoot);
  writeFileSync(join(project, 'package.json'), '{"name":"p"}');
  writeFileSync(join(project, 'plugin.ts'), 'export default {};');
  writeFileSync(join(project, 'commands', 'hello', 'index.ts'), 'export default 1;');
  writeFileSync(join(project, '.env'), 'TOKEN=secret');
  writeFileSync(join(project, '.env.production'), 'TOKEN=secret');
  writeFileSync(join(project, 'data', 'bot.db'), 'db');
  writeFileSync(join(project, 'tsconfig.json'), '{ "extends": "../tsconfig.base.json" }');
  runner = join(base, 'runner.mjs');
  writeFileSync(runner, FAKE_RUNNER);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function probe(result: Awaited<ReturnType<ReturnType<typeof createSelfChangeSandboxLoader>>>, name: string): string {
  return result.capabilities!.find(item => item.localName === name)!.source;
}

describe('self-change sandbox loader (ADR 0040 §3.3)', () => {
  it('loads a temp copy with the draft applied, without secrets, Host state or the original project', async () => {
    process.env.ZHIN_SANDBOX_TEST_SECRET = 'leak';
    try {
      const load = createSelfChangeSandboxLoader({ projectRoot: project, runner, tmpRoot });
      const result = await load({
        pluginRoot: '',
        writes: [{ path: 'commands/ping/index.ts', content: 'export default 2;' }],
        deletes: ['commands/hello/index.ts'],
      });
      expect(result.status).toBe('passed');
      const files = JSON.parse(probe(result, 'files')) as string[];
      expect(files).toEqual(expect.arrayContaining(['commands/ping/index.ts', 'node_modules', 'package.json', 'plugin.ts', 'tsconfig.json']));
      expect(files).not.toContain('commands/hello/index.ts');
      expect(files.some(file => file.startsWith('.env') || file.startsWith('.zhin') || file.startsWith('data/'))).toBe(false);
      const env = JSON.parse(probe(result, 'env')) as string[];
      expect(env).not.toContain('ZHIN_SANDBOX_TEST_SECRET');
      expect(env).toContain('NODE_ENV');
      expect(probe(result, 'tsconfig')).toContain(JSON.stringify(resolve(project, '../tsconfig.base.json')));
      // The project itself is untouched and the temp copy is gone.
      expect(existsSync(join(project, 'commands', 'ping'))).toBe(false);
      expect(existsSync(join(project, 'commands', 'hello', 'index.ts'))).toBe(true);
      expect(readdirSync(tmpRoot)).toEqual([]);
    } finally {
      delete process.env.ZHIN_SANDBOX_TEST_SECRET;
    }
  });

  it('reports a load failure caused by the draft, and skips when the root fails even without it', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: project, runner, tmpRoot });
    const failed = await load({ pluginRoot: '', writes: [{ path: 'crash', content: '' }], deletes: [] });
    expect(failed).toEqual({ status: 'failed', message: 'Error: crash at load\n    at x' });
    writeFileSync(join(project, 'crash'), '');
    const skipped = await load({ pluginRoot: '', writes: [{ path: 'commands/x/index.ts', content: '' }], deletes: [] });
    expect(skipped.status).toBe('skipped');
    expect(skipped.message).toMatch(/even without this change/u);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('kills a hanging load at the timeout and cleans up', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: project, runner, tmpRoot, timeoutMs: 300 });
    const result = await load({ pluginRoot: '', writes: [{ path: 'hang', content: '' }], deletes: [] });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/did not finish within/u);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('skips instead of copying a plugin root over the limit', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: project, runner, tmpRoot, maxCopyFiles: 2 });
    const result = await load({ pluginRoot: '', writes: [], deletes: [] });
    expect(result.status).toBe('skipped');
    expect(result.message).toMatch(/trial copy limit/u);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('refuses draft paths that escape the copy and plugin roots outside the project', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: project, runner, tmpRoot });
    await expect(load({ pluginRoot: '', writes: [{ path: '../evil.ts', content: '' }], deletes: [] })).rejects.toThrow(/escapes the trial copy/u);
    expect(await load({ pluginRoot: '../other', writes: [], deletes: [] })).toMatchObject({ status: 'failed' });
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('skips when the runner is not built', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: project, runner: join(base, 'missing.js'), tmpRoot });
    expect(await load({ pluginRoot: '', writes: [], deletes: [] })).toMatchObject({ status: 'skipped' });
  });

  it('sweeps stale trial dirs left by a crashed Host, keeping fresh ones and unrelated dirs', async () => {
    const stale = join(tmpRoot, `${SELF_CHANGE_TRIAL_DIR_PREFIX}old`);
    const fresh = join(tmpRoot, `${SELF_CHANGE_TRIAL_DIR_PREFIX}new`);
    const other = join(tmpRoot, 'other-old');
    for (const dir of [stale, fresh, other]) mkdirSync(dir);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    utimesSync(other, old, old);
    expect(await sweepStaleTrialDirs(tmpRoot, Date.now())).toBe(1);
    expect(readdirSync(tmpRoot).sort()).toEqual(['other-old', `${SELF_CHANGE_TRIAL_DIR_PREFIX}new`].sort());
  });

  it('parses runner output defensively', () => {
    expect(parseRunnerOutput('noise\n{"ok":true,"capabilities":[{"feature":"f","localName":"l","source":"s"}]}\n', '')).toEqual({
      status: 'passed', capabilities: [{ feature: 'f', localName: 'l', source: 's' }],
    });
    expect(parseRunnerOutput('', 'segfault')).toEqual({ status: 'failed', message: 'segfault' });
    expect(parseRunnerOutput('{broken', '')).toEqual({ status: 'failed', message: 'trial runtime exited without a result' });
  });
});

const builtRunner = join(repoRoot, 'basic/cli/lib/plugin-runtime/agent/self-change-sandbox-runner.js');
const example = join(repoRoot, 'examples/minimal-bot');
const canRunReal = existsSync(builtRunner) && existsSync(join(example, 'node_modules', 'zhin.js'));

describe.skipIf(!canRunReal)('self-change trial runtime (built runner, minimal-bot)', () => {
  it('discovers a drafted command and rejects one that throws while loading', async () => {
    const load = createSelfChangeSandboxLoader({ projectRoot: example, runner: builtRunner, tmpRoot });
    const ok = await load({
      pluginRoot: '',
      writes: [{ path: 'commands/ping/index.ts', content: "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ description: 'ping', execute: () => 'pong' });\n" }],
      deletes: [],
    });
    expect(ok.status, JSON.stringify(ok)).toBe('passed');
    expect(ok.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ localName: 'ping', source: 'commands/ping/index.ts' })]));

    const broken = await load({
      pluginRoot: '',
      writes: [{ path: 'commands/ping/index.ts', content: "export default { notACommand: true };\n" }],
      deletes: [],
    });
    expect(broken.status).toBe('failed');
    expect(broken.message).toMatch(/defineCommand/u);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(existsSync(join(example, 'commands', 'ping'))).toBe(false);
  }, 60_000);
});
