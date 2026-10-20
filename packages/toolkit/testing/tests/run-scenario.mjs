import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = await mkdtemp(join(tmpdir(), 'zhin-scenario-regression-'));
const fixture = new URL('./fixtures/console-scenario/', import.meta.url);
const execute = promisify(execFile);
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
  // No parent environment credentials are copied into the trusted fixture process.
  const env = { ZHIN_SCENARIO_FIXTURE_ROOT: temporary, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive } : {}) };
  const run = (childEnv = env) => execute(process.execPath, ['--conditions=development', '--import', 'tsx', '--test', '--test-reporter=tap', join(temporary, 'scenario.test.mjs')], { cwd: temporary, env: childEnv, timeout: 25_000 });
  await assert.rejects(run({}), error => { assert.match(error.stdout + error.stderr, /Set ZHIN_SCENARIO_FIXTURE_ROOT/u); return true; });
  const result = await run(); assert.match(result.stdout, /# pass 1/u);
  const scene = JSON.parse(await readFile(join(temporary, 'scenario.json'), 'utf8'));
  assert.equal(scene.sourceTarget.parent.id, 'test-workspace'); assert.equal(scene.sourceTarget.threadId, 'test-thread');
  scene.assertions.deliveries = [[{ type: 'text', data: { text: 'deliberately-wrong-expected-output' } }]];
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  await assert.rejects(run(), error => { assert.match(error.stdout, /exact target and final payloads/u); return true; });
  scene.assertions.dispatchStatus = 'denied'; scene.assertions.deliveries = ['没有权限执行此指令。']; scene.sender.roles = [];
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  assert.match((await run()).stdout, /# pass 1/u);
  delete scene.sender.roles;
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  assert.match((await run()).stdout, /# pass 1/u);
  scene.input = 'not-a-command'; scene.assertions = { dispatchStatus: 'unmatched', deliveries: [] };
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  assert.match((await run()).stdout, /# pass 1/u);
  scene.fixture.config.plugin = { commandPrefix: '/' }; scene.input = 'hello'; scene.sender.roles = ['admin'];
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  assert.match((await run()).stdout, /# pass 1/u);
  scene.input = '/hello'; scene.assertions = { dispatchStatus: 'executed', deliveries: [[{ type: 'text', data: { text: '你好，测试成员' } }]] };
  await writeFile(join(temporary, 'scenario.json'), JSON.stringify(scene));
  assert.match((await run()).stdout, /# pass 1/u);
  console.log('CONSOLE_SCENARIO_EXPORT_RUNTIME_OK');
} finally { await rm(temporary, { recursive: true, force: true }); }
