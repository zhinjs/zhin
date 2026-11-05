// Smoke loop for the scenario lab (#843): a Console-exported scenario runs against the smoke bot,
// passes when the bot behaves as the author expected and fails when the expectation is wrong.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createSmokeProject, repositoryRoot } from '../harness/smoke-project.mjs';
import { smokeStep } from '../harness/smoke-checks.mjs';

const runFile = promisify(execFile);
const exportedFixtureDirectory = join(repositoryRoot, 'packages/toolkit/testing/tests/fixtures/console-scenario');

const rootPluginSource = [
  "import { definePlugin, Schema } from 'zhin.js';",
  '',
  'export default definePlugin({',
  "  name: 'smoke-bot',",
  "  config: Schema.object({ pingReply: Schema.string().default('pong') }),",
  '});',
  '',
].join('\n');

const statusCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  "  permit: ['role(admin)'],",
  '  execute: ({ config }) => [',
  "    { type: 'text', data: { text: `状态：${config.pingReply}` } },",
  '  ],',
  '});',
  '',
].join('\n');

/** The shape the scenario lab exports: full source identity, explicit fixture config and assertions. */
function authoredScenario(overrides) {
  return {
    schemaVersion: 1,
    name: 'smoke bot status in a threaded channel',
    sourceTarget: {
      endpoint: { id: 'root/production\u0000zhin.adapter\u0000example', adapter: 'example' },
      kind: 'channel',
      id: 'ops-room',
      parent: { kind: 'channel', id: 'ops-workspace' },
      threadId: 'ops-thread',
    },
    sender: { id: 'operator', name: '值班', roles: ['admin'] },
    input: 'status',
    preview: [{ type: 'text', data: { text: '状态：ready' } }],
    profile: 'text',
    fixture: { syntheticEndpoint: 'scenario', config: { configVersion: 2, plugin: { pingReply: 'ready' } } },
    assertions: { dispatchStatus: 'executed', deliveries: [[{ type: 'text', data: { text: '状态：ready' } }]] },
    ...overrides,
  };
}

const project = await createSmokeProject('scenario-lab');
try {
  await project.writeJson('package.json', {
    name: '@smoke/scenario-bot',
    type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await project.write('plugin.ts', rootPluginSource);
  await project.write('commands/status/index.ts', statusCommandSource);
  const exportedScenarioTemplate = join(exportedFixtureDirectory, 'scenario.test.mjs');
  const writeScenarioCase = async (caseName, scenario) => {
    const relativeDir = `cases/${caseName}`;
    await project.writeJson(`${relativeDir}/scenario.json`, scenario);
    await copyFile(exportedScenarioTemplate, project.path(`${relativeDir}/scenario.test.mjs`));
    return project.path(`${relativeDir}/scenario.test.mjs`);
  };

  const files = [
    await writeScenarioCase('executed', authoredScenario({ name: 'smoke bot status in a threaded channel' })),
    await writeScenarioCase('denied', authoredScenario({
      name: 'smoke bot denial in a threaded channel',
      sender: { id: 'visitor', name: '访客', roles: [] },
      assertions: { dispatchStatus: 'denied', deliveries: ['没有权限执行此指令。'] },
    })),
    await writeScenarioCase('wrong', authoredScenario({
      name: 'smoke bot wrong expectation',
      assertions: { dispatchStatus: 'executed', deliveries: [[{ type: 'text', data: { text: '状态：wrong' } }]] },
    })),
  ];

  // The trusted fixture process receives no credentials from the parent environment.
  const windowsSystemVariables = process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive }
    : {};
  const environment = { ZHIN_SCENARIO_FIXTURE_ROOT: project.root, ...windowsSystemVariables };
  const nodeArguments = ['--conditions=development', '--import', 'tsx', '--test', '--test-isolation=none', '--test-reporter=tap', ...files];

  let batchOutput = '';
  let batchRejected = false;
  try {
    await runFile(process.execPath, nodeArguments, { cwd: project.root, env: environment, timeout: 45_000 });
  } catch (error) {
    batchRejected = true;
    batchOutput = String(error.stdout ?? '') + String(error.stderr ?? '');
  }

  await smokeStep('scenario lab: exported executed scenario passes with the configured reply', async () => {
    assert.match(batchOutput, /^ok \d+ - smoke bot status in a threaded channel$/mu);
  });

  await smokeStep('scenario lab: exported denial scenario passes with the real permission reply', async () => {
    assert.match(batchOutput, /^ok \d+ - smoke bot denial in a threaded channel$/mu);
  });

  await smokeStep('scenario lab: a wrong author expectation makes the exported test fail', async () => {
    assert.equal(batchRejected, true);
    assert.match(batchOutput, /^not ok \d+ - smoke bot wrong expectation$/mu);
    assert.match(batchOutput, /exact target and final payloads/u);
    assert.match(batchOutput, /# pass 2/u);
    assert.match(batchOutput, /# fail 1/u);
  });

  console.log('E2E_SMOKE_SCENARIO_LAB_OK');
} finally {
  await project.dispose();
}
