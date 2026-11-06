import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = await mkdtemp(join(tmpdir(), 'zhin-scenario-regression-'));
const fixture = new URL('./fixtures/console-scenario/', import.meta.url);
const link = async (name, source) => {
  const destination = join(temporary, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
};
try {
  for (const name of ['adapter', 'command', 'component', 'middleware', 'handler', 'schedule-feature', 'plugin-runtime', 'core', 'permission', 'im-contract', 'runtime', 'tool', 'skill']) {
    await link(`@zhin.js/${name}`, join(repo, 'packages/im', name));
  }
  await link('@zhin.js/testing', join(repo, 'packages/toolkit/testing'));
  await link('zhin.js', join(repo, 'packages/im/zhin'));
  await link('tsx', join(repo, 'node_modules/tsx'));
  await writeFile(join(temporary, 'package.json'), JSON.stringify({
    name: '@test/console-scenario-fixture', type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  }));
  await writeFile(join(temporary, 'plugin.ts'), "import {definePlugin,Schema} from 'zhin.js';export default definePlugin({name:'scenario-fixture',config:Schema.object({commandPrefix:Schema.string().default('')})});");
  await mkdir(join(temporary, 'commands/hello'), { recursive: true });
  await writeFile(join(temporary, 'commands/hello/index.ts'), "import{defineCommand}from'zhin.js/command';export default defineCommand({permit:['role(admin)'],execute:({input})=>[{type:'text',data:{text:'你好，'+(input.sender?.name??input.sender?.id??'访客')}}]});");
  for (const file of ['scenario.json', 'scenario.test.mjs', 'README.md']) await cp(new URL(file, fixture), join(temporary, file));
  const baseScene = JSON.parse(await readFile(join(temporary, 'scenario.json'), 'utf8'));
  assert.equal(baseScene.sourceTarget.parent.id, 'test-workspace'); assert.equal(baseScene.sourceTarget.threadId, 'test-thread');
  // Prepare all scenario test files so a single tsx subprocess validates every case.
  await mkdir(join(temporary, 'cases/missing-env'), { recursive: true });
  await cp(join(temporary, 'scenario.json'), join(temporary, 'cases/missing-env/scenario.json'));
  await cp(join(temporary, 'scenario.test.mjs'), join(temporary, 'cases/missing-env/scenario.test.mjs'));
  const missingEnvFile = join(temporary, 'cases/00-missing-env.test.mjs');
  await writeFile(missingEnvFile, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('case-0-missing-env', async () => {",
    "  const saved = process.env.ZHIN_SCENARIO_FIXTURE_ROOT;",
    "  delete process.env.ZHIN_SCENARIO_FIXTURE_ROOT;",
    "  try {",
    "    await assert.rejects(import('./missing-env/scenario.test.mjs'), /Set ZHIN_SCENARIO_FIXTURE_ROOT/u);",
    "  } finally {",
    "    process.env.ZHIN_SCENARIO_FIXTURE_ROOT = saved;",
    "  }",
    "});",
  ].join('\n'));
  const variants = [
    ['case-1-default', structuredClone(baseScene)],
    ['case-2-wrong-output', (() => {
      const s = structuredClone(baseScene);
      s.assertions.deliveries = [[{ type: 'text', data: { text: 'deliberately-wrong-expected-output' } }]];
      return s;
    })()],
    ['case-3-denied-empty-roles', (() => {
      const s = structuredClone(baseScene);
      s.assertions = { dispatchStatus: 'denied', deliveries: ['没有权限执行此指令。'] };
      s.sender.roles = [];
      return s;
    })()],
    ['case-4-denied-omitted-roles', (() => {
      const s = structuredClone(baseScene);
      s.assertions = { dispatchStatus: 'denied', deliveries: ['没有权限执行此指令。'] };
      delete s.sender.roles;
      return s;
    })()],
    ['case-5-unmatched', (() => {
      const s = structuredClone(baseScene);
      delete s.sender.roles;
      s.input = 'not-a-command';
      s.assertions = { dispatchStatus: 'unmatched', deliveries: [] };
      return s;
    })()],
    ['case-6-prefix-unmatched', (() => {
      const s = structuredClone(baseScene);
      s.fixture.config.plugin = { commandPrefix: '/' };
      s.input = 'hello';
      s.sender.roles = ['admin'];
      s.assertions = { dispatchStatus: 'unmatched', deliveries: [] };
      return s;
    })()],
    ['case-7-prefix-executed', (() => {
      const s = structuredClone(baseScene);
      s.fixture.config.plugin = { commandPrefix: '/' };
      s.input = '/hello';
      s.sender.roles = ['admin'];
      s.assertions = { dispatchStatus: 'executed', deliveries: [[{ type: 'text', data: { text: '你好，测试成员' } }]] };
      return s;
    })()],
  ];
  const files = [missingEnvFile];
  for (const [name, scene] of variants) {
    scene.name = name;
    const dir = join(temporary, 'cases', name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'scenario.json'), JSON.stringify(scene));
    await cp(join(temporary, 'scenario.test.mjs'), join(dir, 'scenario.test.mjs'));
    files.push(join(dir, 'scenario.test.mjs'));
  }
  // No parent environment credentials are copied into the trusted fixture process.
  const env = { ZHIN_SCENARIO_FIXTURE_ROOT: temporary, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive } : {}) };
  const isolationFlag = process.allowedNodeEnvironmentFlags.has('--test-isolation')
    ? '--test-isolation=none'
    : '--experimental-test-isolation=none';
  assert.throws(() => execFileSync(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', '--test', isolationFlag, '--test-reporter=tap', ...files],
    { cwd: temporary, env, timeout: 45_000, encoding: 'utf8' },
  ), error => {
    const out = String(error.stdout ?? '') + String(error.stderr ?? '');
    for (const passed of [
      'case-0-missing-env',
      'case-1-default',
      'case-3-denied-empty-roles',
      'case-4-denied-omitted-roles',
      'case-5-unmatched',
      'case-6-prefix-unmatched',
      'case-7-prefix-executed',
    ]) {
      assert.match(out, new RegExp(`^ok \\d+ - ${passed}$`, 'mu'));
    }
    assert.match(out, /^not ok \d+ - case-2-wrong-output$/mu);
    assert.match(out, /exact target and final payloads/u);
    assert.match(out, /# pass 7/u);
    assert.match(out, /# fail 1/u);
    return true;
  });
  console.log('CONSOLE_SCENARIO_EXPORT_RUNTIME_OK');
} finally { await rm(temporary, { recursive: true, force: true }); }
