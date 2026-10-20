// Smoke loop: a plugin with a fixed-choice (string literal) field → the Console form offers exactly
// those choices → the user saves a new value → `config:explain` shows it is saved but not yet applied →
// apply → explain shows it is live and the bot behaves accordingly → an invalid choice is rejected.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PluginTestKit } from '../../../packages/toolkit/testing/src/index.ts';
import { createConfigDocument } from '../../../packages/im/config-file/src/index.ts';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../../../packages/host/http/src/index.ts';
import { CONFIG_RPC } from '../../../packages/console/protocol/src/index.ts';
import { PluginManagementWorkflow } from '../../../basic/cli/src/plugin-management/workflow.ts';
import { jsonSchemaToConsoleSchema } from '../../../basic/cli/src/plugin-runtime/console/console-schema.ts';
import { createSmokeProject } from '../harness/smoke-project.mjs';
import { lastDeliveryText, smokeStep } from '../harness/smoke-checks.mjs';

const greeterPluginSource = [
  "import { definePlugin, Schema } from 'zhin.js';",
  '',
  'export default definePlugin({',
  "  name: 'greeter',",
  '  config: Schema.object({',
  "    greeting: Schema.string().default('你好'),",
  "    tone: Schema.union([Schema.const('calm'), Schema.const('excited')]).default('calm'),",
  '  }),',
  '});',
  '',
].join('\n');

const greetCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  "  execute: ({ config }) => config.tone === 'excited' ? `${config.greeting}！！` : config.greeting,",
  '});',
  '',
].join('\n');

const configurationWith = greeterSection => [
  'configVersion: 2',
  'plugins:',
  '  greeter: ./plugins/greeter',
  `greeter: ${greeterSection}`,
  '',
].join('\n');

const project = await createSmokeProject('config');
let kit;
try {
  await project.writeJson('package.json', {
    name: '@smoke/config-bot',
    version: '1.0.0',
    type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await project.write('plugin.ts', "import { definePlugin } from 'zhin.js';\n\nexport default definePlugin({ name: 'smoke-bot' });\n");
  await project.writeJson('plugins/greeter/package.json', {
    name: '@smoke/greeter',
    version: '1.0.0',
    type: 'module',
    peerDependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@zhin.js/command', api: '^1.0.0' }] },
  });
  await project.write('plugins/greeter/plugin.ts', greeterPluginSource);
  await project.write('plugins/greeter/commands/greet/index.ts', greetCommandSource);
  const configurationPath = await project.write('zhin.config.yml', configurationWith('{}'));
  const configurationDocument = createConfigDocument(configurationPath);

  kit = await PluginTestKit.create({ projectRoot: project.root, config: configurationDocument });
  await kit.start();
  const workflow = new PluginManagementWorkflow(project.root, { snapshots: kit.snapshots });

  let nextRequestId = 1;
  const explainGreeter = async () => {
    const { revision } = await configurationDocument.read();
    const message = { type: CONFIG_RPC.EXPLAIN, instanceKey: 'greeter', expectedRevision: revision, requestId: nextRequestId };
    nextRequestId += 1;
    const replies = await dispatchRuntimeConsoleRpc(message, { authScope: 'full', listPages: async () => [], pluginManagement: workflow });
    const reply = pickRpcReply(message, replies);
    assert.ok(reply && !reply.error, `config:explain failed: ${reply?.error}`);
    return reply.data;
  };
  const fieldEvidence = (explanation, name) => {
    const evidence = explanation.fields.find(field => field.path.join('.') === name);
    assert.ok(evidence, `explanation lists ${name}`);
    return evidence;
  };
  const greet = async () => {
    const result = await kit.receive({ conversation: { kind: 'group', id: 'smoke-group' }, sender: { id: 'alice' }, content: 'greet' });
    assert.equal(result?.status, 'executed');
    return lastDeliveryText(kit.deliveries);
  };
  const saveAndApply = async greeterSection => {
    await writeFile(configurationPath, configurationWith(greeterSection));
    return kit.reloadSource(configurationPath);
  };

  await smokeStep('enum: the Console form for the literal field offers exactly the declared choices', async () => {
    const lease = kit.snapshots.acquire();
    let greeterSchema;
    try {
      const node = [...lease.value.tree.values()].find(item => item.instanceKey === 'greeter');
      greeterSchema = node?.configSchema;
    } finally {
      lease.release();
    }
    assert.ok(greeterSchema, 'the running generation publishes the greeter schema');
    const consoleSchema = jsonSchemaToConsoleSchema(greeterSchema);
    const toneField = consoleSchema.object.tone;
    assert.equal(toneField.type, 'string');
    assert.equal(toneField.default, 'calm');
    const options = toneField.options;
    assert.deepEqual(options.map(option => option.value), ['calm', 'excited']);
  });

  await smokeStep('explain: with nothing saved, both fields come from schema defaults and match the running generation', async () => {
    const explanation = await explainGreeter();
    assert.equal(explanation.projection, 'supported', JSON.stringify(explanation));
    assert.deepEqual(fieldEvidence(explanation, 'greeting'), { path: ['greeting'], candidateOrigin: 'schema-default', generationMatch: 'equal', generationOrigin: 'unknown' });
    assert.equal(fieldEvidence(explanation, 'tone').candidateOrigin, 'schema-default');
    assert.equal(await greet(), '你好');
  });

  await smokeStep('explain: a saved but not yet applied choice is reported as from file and different from the running generation', async () => {
    await writeFile(configurationPath, configurationWith('{ tone: excited }'));
    const explanation = await explainGreeter();
    const tone = fieldEvidence(explanation, 'tone');
    assert.equal(tone.candidateOrigin, 'file');
    assert.equal(tone.generationMatch, 'different');
    assert.equal(await greet(), '你好');
    assert.equal(JSON.stringify(explanation).includes('excited'), false);
  });

  await smokeStep('apply: reloading the saved file starts a new generation; explain and behaviour now agree', async () => {
    const generationBefore = kit.generation;
    const applied = await kit.reloadSource(configurationPath);
    assert.equal(applied.status, 'reloaded', JSON.stringify(applied));
    assert.ok(kit.generation > generationBefore);
    const explanation = await explainGreeter();
    assert.equal(fieldEvidence(explanation, 'tone').generationMatch, 'equal');
    assert.equal(await greet(), '你好！！');
  });

  await smokeStep('enum: a value outside the declared choices is rejected and the running generation keeps serving', async () => {
    const generationBefore = kit.generation;
    const rejected = await saveAndApply('{ tone: shouting }');
    assert.notEqual(rejected.status, 'reloaded');
    assert.equal(kit.generation, generationBefore);
    assert.equal(await greet(), '你好！！');
    const explanation = await explainGreeter();
    assert.equal(explanation.projection, 'unsupported');
    assert.equal(explanation.reason, 'candidate-invalid');
  });

  await smokeStep('explain: the response carries field metadata only, never configured values', async () => {
    const applied = await saveAndApply('{ tone: excited, greeting: "SECRET-GREETING-MARKER" }');
    assert.equal(applied.status, 'reloaded', JSON.stringify(applied));
    const explanation = await explainGreeter();
    assert.equal(fieldEvidence(explanation, 'greeting').candidateOrigin, 'file');
    assert.equal(JSON.stringify(explanation).includes('SECRET-GREETING-MARKER'), false);
    const source = await readFile(configurationPath, 'utf8');
    assert.match(source, /SECRET-GREETING-MARKER/u);
  });

  console.log('E2E_SMOKE_CONFIG_EXPLAIN_ENUM_OK');
} finally {
  await kit?.close();
  await project.dispose();
}
