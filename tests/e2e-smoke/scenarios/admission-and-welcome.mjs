// Smoke loop: configure command admission (`execution`) and the group welcome scope, apply each
// change as a new runtime generation, then check what members actually see in the conversation.
import assert from 'node:assert/strict';
import { PluginTestKit, FakeClock, FakeScheduleRootHost } from '../../../packages/toolkit/testing/src/index.ts';
import { PluginScheduleHost, rootPluginId, scheduleHostToken, scheduleRootHostToken } from '../../../packages/im/plugin-runtime/src/index.ts';
import { createSmokeProject } from '../harness/smoke-project.mjs';
import { deliveryText, lastDeliveryText, smokeStep } from '../harness/smoke-checks.mjs';

const rootPluginSource = [
  "import { definePlugin } from 'zhin.js';",
  '',
  "export default definePlugin({ name: 'smoke-bot' });",
  '',
].join('\n');

// One report per member per minute, whatever happens to the first one.
const reportCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  '  execution: { cooldownMs: 60_000 },',
  "  execute: () => 'report ready',",
  '});',
  '',
].join('\n');

// One export at a time per member. The scenario holds the export open through a global gate.
const exportCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  '  execution: { maxConcurrent: 1 },',
  '  execute: async () => {',
  '    await globalThis.smokeExportGate.wait();',
  "    return 'export finished';",
  '  },',
  '});',
  '',
].join('\n');

class ExportGate {
  constructor() {
    this.entered = 0;
    this.#reset();
  }

  #reset() {
    this.released = new Promise(resolve => {
      this.release = resolve;
    });
  }

  async wait() {
    this.entered += 1;
    await this.released;
  }
}

async function waitUntil(condition) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}

const project = await createSmokeProject('admission');
const exportGate = new ExportGate();
globalThis.smokeExportGate = exportGate;
let kit;
try {
  const suitePackage = await project.copyRepositoryPlugin('plugins/utils/group-suite', 'group-suite');
  await project.writeJson('package.json', {
    name: '@smoke/admission-bot',
    type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/command': '*', '@zhin.js/tool': '*', '@zhin.js/skill': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await project.write('plugin.ts', rootPluginSource);
  await project.write('commands/report/index.ts', reportCommandSource);
  await project.write('commands/export/index.ts', exportCommandSource);

  const schedules = new FakeScheduleRootHost(new FakeClock());
  kit = await PluginTestKit.create({
    projectRoot: project.root,
    config: {
      configVersion: 2,
      plugins: { suite: suitePackage },
      suite: { commandNamespace: 'suite', welcomeMessage: '欢迎 {name}' },
    },
    installResources: ({ resources }) => {
      resources.provide(scheduleRootHostToken, schedules);
      resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedules));
    },
  });
  await kit.start();

  const group = { kind: 'group', id: 'smoke-group' };
  const alice = { id: 'alice', name: 'Alice', roles: [] };
  const bob = { id: 'bob', name: 'Bob', roles: [] };
  const say = (sender, content, messageId) => kit.receive({ conversation: group, sender, content, message: { id: messageId } });

  await smokeStep('cooldown: the first report runs, a repeat inside the window is limited with a wait time', async () => {
    const first = await say(alice, 'report', 'report-1');
    assert.equal(first?.status, 'executed');
    assert.equal(lastDeliveryText(kit.deliveries), 'report ready');
    const repeat = await say(alice, 'report', 'report-2');
    assert.equal(repeat?.status, 'limited');
    assert.equal(repeat?.limit?.reason, 'cooldown');
    assert.ok(repeat.limit.retryAfterMs > 0 && repeat.limit.retryAfterMs <= 60_000);
    assert.match(lastDeliveryText(kit.deliveries), /此指令仍在冷却，约 \d+ 秒后再试。/u);
  });

  await smokeStep('cooldown: another member is not limited by Alice\'s cooldown', async () => {
    const other = await say(bob, 'report', 'report-3');
    assert.equal(other?.status, 'executed');
  });

  await smokeStep('concurrency: a second export while the first is running is rejected as busy', async () => {
    const firstExport = say(alice, 'export', 'export-1');
    await waitUntil(() => exportGate.entered === 1);
    const duplicate = await say(alice, 'export', 'export-2');
    assert.equal(duplicate?.status, 'limited');
    assert.equal(duplicate?.limit?.reason, 'busy');
    assert.equal(duplicate.limit.retryAfterMs, undefined);
    assert.match(lastDeliveryText(kit.deliveries), /仍在处理中/u);
    exportGate.release();
    const finished = await firstExport;
    assert.equal(finished?.status, 'executed');
    assert.equal(lastDeliveryText(kit.deliveries), 'export finished');
  });

  await smokeStep('concurrency: once the first export has finished, the member can export again', async () => {
    const again = await say(alice, 'export', 'export-3');
    assert.equal(again?.status, 'executed');
  });

  await smokeStep('verify: diagnostics record the limit reason for limited messages', async () => {
    const records = kit.messageDiagnostics.list();
    const cooldownRecord = records.find(record => record.messageId === 'report-2');
    assert.equal(cooldownRecord?.dispatchStatus, 'limited');
    assert.equal(cooldownRecord?.limit?.reason, 'cooldown');
    const busyRecord = records.find(record => record.messageId === 'export-2');
    assert.equal(busyRecord?.limit?.reason, 'busy');
  });

  const welcomeNotice = conversation => ({
    id: `joined-${conversation.id}`,
    type: 'notice',
    name: 'notice.group.member_increase',
    timestamp: Date.now(),
    metadata: {},
    conversation,
    target: { id: 'new-member', name: 'Carol' },
  });
  const welcomesIn = async conversation => {
    kit.clearDeliveries();
    await kit.emit('notice.receive', welcomeNotice(conversation));
    return kit.deliveries;
  };
  const otherGroup = { kind: 'group', id: 'other-group' };

  // Welcome acceptance lives in the group-suite welcome suite (plugins/utils/group-suite/tests/welcome.test.ts,
  // #1012 A9). This smoke keeps one user-visible loop only: welcome once, then narrow / turn off via applied config.
  await smokeStep('welcome: a joined member is welcomed once in the original group; leaving sends nothing', async () => {
    const deliveries = await welcomesIn(group);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].conversation.id, group.id);
    assert.equal(deliveryText(deliveries[0].payload), '欢迎 Carol');
    kit.clearDeliveries();
    await kit.emit('notice.receive', { ...welcomeNotice(group), id: 'left-smoke-group', name: 'notice.group.member_decrease' });
    assert.equal(kit.deliveries.length, 0);
  });

  await smokeStep('welcome: an applied exact welcomeConversations entry limits welcomes to that group; [] turns them off', async () => {
    const exactGroup = (await welcomesIn(group))[0].conversation;
    const generationBefore = kit.generation;
    const generationAfter = await kit.patchConfig([{ op: 'set', path: ['suite', 'welcomeConversations'], value: [exactGroup] }]);
    assert.equal(generationAfter, generationBefore + 1);
    const inScope = await welcomesIn(group);
    assert.equal(inScope.length, 1);
    assert.deepEqual(inScope[0].conversation, exactGroup);
    assert.equal((await welcomesIn(otherGroup)).length, 0);
    await kit.patchConfig([{ op: 'set', path: ['suite', 'welcomeConversations'], value: [] }]);
    assert.equal((await welcomesIn(group)).length, 0);
  });

  console.log('E2E_SMOKE_ADMISSION_WELCOME_OK');
} finally {
  exportGate.release();
  await kit?.close();
  await project.dispose();
}
