import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PLUGIN_TEST_IMAGE,
  buildPluginTestDockerArgs,
  createSelfChangePluginTestRunner,
  findPluginTests,
  testCommand,
  type DockerExec,
  type DockerExecResult,
} from '../../../src/plugin-runtime/agent/self-change-plugin-tests.js';
import { SELF_CHANGE_TRIAL_DIR_PREFIX } from '../../../src/plugin-runtime/agent/self-change-sandbox.js';

let base: string;
let project: string;
let tmpRoot: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'zhin-plugin-tests-'));
  project = join(base, 'project');
  tmpRoot = join(base, 'tmp');
  mkdirSync(join(project, 'commands', 'hello'), { recursive: true });
  mkdirSync(join(project, 'tests'), { recursive: true });
  mkdirSync(join(project, 'node_modules', 'dep'), { recursive: true });
  mkdirSync(tmpRoot);
  writeFileSync(join(project, 'package.json'), '{"name":"p"}');
  writeFileSync(join(project, 'commands', 'hello', 'index.ts'), 'export default 1;');
  writeFileSync(join(project, 'tests', 'hello.test.ts'), 'test');
  writeFileSync(join(project, 'node_modules', 'dep', 'x.test.js'), 'not a plugin test');
  writeFileSync(join(project, '.env'), 'TOKEN=secret');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const request = { pluginRoot: '', writes: [{ path: 'commands/ping/index.ts', content: 'export default 2;' }], deletes: ['commands/hello/index.ts'] };

interface Call {
  readonly args: readonly string[];
  /** Files in the mounted copy at the time of `docker run`. */
  readonly files?: readonly string[];
  readonly draft?: string;
}

/** Fake docker: `image inspect` succeeds when `image` is set; `run` answers with `run(copy)`. */
function fakeDocker(opts: { image?: boolean; run?: (copy: string) => Partial<DockerExecResult> } = {}): { docker: DockerExec; calls: Call[] } {
  const calls: Call[] = [];
  const docker: DockerExec = async args => {
    if (args[0] === 'image') {
      calls.push({ args });
      return { code: opts.image === false ? 1 : 0, stdout: '', stderr: '', timedOut: false };
    }
    if (args[0] === 'run') {
      const mount = args[args.indexOf('--mount') + 1]!;
      const copy = /source=([^,]+)/u.exec(mount)![1]!;
      const ping = join(copy, 'commands', 'ping', 'index.ts');
      calls.push({ args, files: listFiles(copy), draft: existsSync(ping) ? readFileSync(ping, 'utf8') : undefined });
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...opts.run?.(copy) };
    }
    calls.push({ args });
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
  return { docker, calls };
}

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]).sort();
}

function trialDirs(): string[] {
  return readdirSync(tmpRoot).filter(name => name.startsWith(SELF_CHANGE_TRIAL_DIR_PREFIX));
}

describe('createSelfChangePluginTestRunner', () => {
  it('runs the tests on a copy with the draft applied, in an offline container, and removes the copy', async () => {
    const { docker, calls } = fakeDocker();
    const run = createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker });
    await expect(run(request)).resolves.toEqual({ status: 'passed' });

    const dockerRun = calls.find(call => call.args[0] === 'run')!;
    expect(dockerRun.draft).toBe('export default 2;');
    // Draft applied, deleted file gone, secrets and node_modules not copied (dependencies are a read-only mount).
    expect(dockerRun.files).toEqual(['commands/ping/index.ts', 'package.json', 'tests/hello.test.ts']);
    expect(dockerRun.args).toEqual(expect.arrayContaining(['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--rm', DEFAULT_PLUGIN_TEST_IMAGE]));
    const mounts = dockerRun.args.flatMap((arg, i) => (dockerRun.args[i - 1] === '--mount' ? [arg] : []));
    expect(mounts[1]).toMatch(/target=\/workspace\/node_modules,readonly$/u);
    expect(dockerRun.args.slice(-3)).toEqual(['node', '--test', 'tests/hello.test.ts']);
    expect(dockerRun.args.join(' ')).not.toContain('TOKEN');
    expect(trialDirs()).toEqual([]);
    expect(readFileSync(join(project, 'commands', 'hello', 'index.ts'), 'utf8')).toBe('export default 1;');
  });

  it('fails with the output tail when the tests fail with the draft but pass without it', async () => {
    const { docker } = fakeDocker({
      run: copy => existsSync(join(copy, 'commands', 'ping'))
        ? { code: 1, stdout: `${'x'.repeat(5_000)}\n\u001b[31mFAIL tests/hello.test.ts > hello\u001b[0m` }
        : { code: 0 },
    });
    const result = await createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker })(request);
    expect(result.status).toBe('failed');
    expect(result.message!.length).toBeLessThanOrEqual(1_000);
    expect(result.message).toMatch(/FAIL tests\/hello\.test\.ts > hello$/u);
    expect(trialDirs()).toEqual([]);
  });

  it('skips when the tests fail even without the draft', async () => {
    const { docker, calls } = fakeDocker({ run: () => ({ code: 1, stderr: 'Error: Cannot find module @rollup/rollup-linux-arm64-gnu' }) });
    const result = await createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker })(request);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('even without this change');
    expect(calls.filter(call => call.args[0] === 'run')).toHaveLength(2);
  });

  it('skips when the plugin has no tests, or there is no Docker / image (never runs tests outside a container)', async () => {
    rmSync(join(project, 'tests'), { recursive: true });
    const none = fakeDocker();
    await expect(createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker: none.docker })(request))
      .resolves.toEqual({ status: 'skipped', message: 'the plugin has no tests' });
    expect(none.calls).toEqual([]);

    writeFileSync(join(project, 'commands', 'hello', 'hello.spec.ts'), 'test');
    const noImage = fakeDocker({ image: false });
    const result = await createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker: noImage.docker })(request);
    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.message).toContain('no isolated container');
    expect(noImage.calls.some(call => call.args[0] === 'run')).toBe(false);

    const broken: DockerExec = async () => { throw new Error('spawn docker ENOENT'); };
    await expect(createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker: broken })(request))
      .resolves.toMatchObject({ status: 'skipped' });
    expect(trialDirs()).toEqual([]);
  });

  it('removes the container by name on timeout and fails', async () => {
    const { docker, calls } = fakeDocker({ run: () => ({ code: null, timedOut: true }) });
    const result = await createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker, timeoutMs: 5_000 })(request);
    // Timeout with the draft, timeout again without it: the root is skipped, and each container is removed.
    expect(result.status).toBe('skipped');
    const names = calls.filter(call => call.args[0] === 'run').map(call => call.args[call.args.indexOf('--name') + 1]);
    expect(calls.filter(call => call.args[0] === 'rm').map(call => call.args[2])).toEqual(names);
  });

  it('refuses a plugin root outside the project and skips without node_modules', async () => {
    const { docker } = fakeDocker();
    await expect(createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker })({ ...request, pluginRoot: '../x' }))
      .resolves.toMatchObject({ status: 'failed' });
    rmSync(join(project, 'node_modules'), { recursive: true });
    await expect(createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker })(request))
      .resolves.toEqual({ status: 'skipped', message: 'no installed node_modules for this plugin root' });
  });

  it('skips a root larger than the copy limit', async () => {
    const { docker } = fakeDocker();
    const result = await createSelfChangePluginTestRunner({ projectRoot: project, tmpRoot, docker, maxCopyFiles: 1 })(request);
    expect(result).toMatchObject({ status: 'skipped' });
    expect(result.message).toContain('copy limit');
    expect(trialDirs()).toEqual([]);
  });
});

describe('plugin test helpers', () => {
  it('finds test files outside dependency and build dirs', async () => {
    mkdirSync(join(project, 'lib'), { recursive: true });
    writeFileSync(join(project, 'lib', 'old.test.js'), '');
    writeFileSync(join(project, 'commands', 'hello', 'a.spec.mts'), '');
    await expect(findPluginTests(project)).resolves.toEqual(['commands/hello/a.spec.mts', 'tests/hello.test.ts']);
  });

  it('uses vitest when installed, otherwise node --test', () => {
    const modules = join(project, 'node_modules');
    expect(testCommand(modules, ['tests/a.test.ts'])).toEqual(['node', '--test', 'tests/a.test.ts']);
    mkdirSync(join(modules, 'vitest'));
    writeFileSync(join(modules, 'vitest', 'vitest.mjs'), '');
    expect(testCommand(modules, ['tests/a.test.ts'])).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run']);
  });

  it('builds docker args with quoted mount paths and an optional user', () => {
    const args = buildPluginTestDockerArgs({ name: 'n', image: 'img', copy: '/tmp/a,b', modules: '/m', command: ['node', '--test'], uid: 1000, gid: 1000 });
    expect(args).toContain('type=bind,"source=/tmp/a,b",target=/workspace');
    expect(args.slice(args.indexOf('--user'), args.indexOf('--user') + 2)).toEqual(['--user', '1000:1000']);
    expect(args.slice(-3)).toEqual(['img', 'node', '--test']);
    expect(buildPluginTestDockerArgs({ name: 'n', image: 'img', copy: '/c', modules: '/m', command: [] })).not.toContain('--user');
  });
});
