// Smoke loop: install the reminder plugin → a member creates a personal reminder in natural language
// and confirms it → time passes on a fake clock → the reminder arrives in the same conversation.
// Then an administrator creates, pauses and resumes a reminder through the real task-center API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PluginTestKit, FakeClock, FakeScheduleRootHost } from '../../../packages/toolkit/testing/src/index.ts';
import { createHttpHost } from '../../../packages/host/http/src/index.ts';
import { registerPluginTaskRoutes } from '../../../basic/cli/src/plugin-runtime/console/plugin-task-routes.ts';
import { createSmokeProject } from '../harness/smoke-project.mjs';
import { createSmokeHosts } from '../harness/smoke-hosts.mjs';
import { useFakeWallClock } from '../harness/fake-wall-clock.mjs';
import { deliveryText, smokeStep } from '../harness/smoke-checks.mjs';

// 2026-10-20 09:00 in Asia/Shanghai.
const startOfScenario = Date.UTC(2026, 9, 20, 1, 0, 0);
const oneMinute = 60_000;

async function waitUntil(condition) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('condition was not reached');
}

const project = await createSmokeProject('reminders');
const clock = new FakeClock(startOfScenario);
const restoreWallClock = useFakeWallClock(clock);
const schedules = new FakeScheduleRootHost(clock);
const operatorToken = randomUUID();
let kit;
const hosts = createSmokeHosts({ projectRoot: project.root, schedules, currentKit: () => kit });
let httpHost;
try {
  await smokeStep('install: reminder plugin mounted with an explicit timezone', async () => {
    const reminderPackage = await project.copyRepositoryPlugin('plugins/utils/reminder', 'reminder');
    await project.writeJson('package.json', {
      name: '@smoke/reminder-bot',
      type: 'module',
      dependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });
    await project.write('plugin.ts', "import { definePlugin } from 'zhin.js';\n\nexport default definePlugin({ name: 'smoke-bot' });\n");
    kit = await PluginTestKit.create({
      projectRoot: project.root,
      config: { configVersion: 2, plugins: { reminder: reminderPackage }, reminder: { timezone: 'Asia/Shanghai' } },
      installResources: hosts.installResources,
    });
    await kit.start();
  });

  const group = { kind: 'group', id: 'smoke-group' };
  const alice = { id: 'alice', name: 'Alice', roles: [] };
  const say = content => kit.receive({ conversation: group, sender: alice, content });
  let reminderConversation;

  await smokeStep('natural time: "10分钟后" is previewed as an absolute time and timezone, saved only after "确认"', async () => {
    const creation = say('remind create 10分钟后 喝水');
    const confirmationPrompt = /确认创建这条提醒？/u;
    await waitUntil(() => kit.deliveries.some(delivery => confirmationPrompt.test(deliveryText(delivery.payload))));
    const [preview, prompt] = kit.deliveries.map(delivery => deliveryText(delivery.payload));
    assert.match(preview, /^时间：2026-10-20 09:10:00 UTC\+08:00 \(Asia\/Shanghai\)$/mu);
    assert.match(preview, /^原会话：group smoke-group$/mu);
    assert.match(preview, /^喝水$/mu);
    assert.match(prompt, confirmationPrompt);
    await say('确认');
    const created = await creation;
    assert.equal(created?.status, 'executed');
    const confirmation = deliveryText(kit.deliveries.at(-1).payload);
    assert.match(confirmation, /^已创建个人提醒$/mu);
    assert.match(confirmation, /待触发 \| 2026\/10\/20 09:10:00 \(Asia\/Shanghai\)/u);
    reminderConversation = kit.deliveries.at(-1).conversation;
  });

  await smokeStep('delivery: nothing is sent before the time, the reminder arrives once after it', async () => {
    kit.clearDeliveries();
    await clock.advance(9 * oneMinute);
    assert.equal(kit.deliveries.length, 0);
    await clock.advance(2 * oneMinute);
    assert.equal(kit.deliveries.length, 1);
    assert.equal(deliveryText(kit.deliveries[0].payload), '⏰ 提醒：喝水');
    assert.deepEqual(kit.deliveries[0].conversation, reminderConversation);
    await clock.advance(10 * oneMinute);
    assert.equal(kit.deliveries.length, 1);
  });

  let tasksUrl;
  const request = async (path, body) => {
    const init = body === undefined
      ? { headers: { authorization: `Bearer ${operatorToken}` } }
      : { method: 'POST', headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) };
    const response = await fetch(`${tasksUrl}${path}`, init);
    const envelope = await response.json();
    return { status: response.status, envelope };
  };
  const readReminderProvider = async () => {
    const { status, envelope } = await request('/providers');
    assert.equal(status, 200);
    const provider = envelope.data.providers.find(item => item.owner === 'root/reminder');
    assert.ok(provider, 'the reminder plugin publishes a task provider');
    return { generation: envelope.data.generation, provider };
  };

  const administratorTaskId = randomUUID();
  await smokeStep('task center: an administrator reminder is created through the real tasks API', async () => {
    httpHost = createHttpHost({ host: '127.0.0.1', port: 0, token: operatorToken });
    registerPluginTaskRoutes({ http: httpHost, base: '/api', snapshots: kit.snapshots });
    const { port } = await httpHost.listen();
    tasksUrl = `http://127.0.0.1:${port}/api/tasks`;
    const { generation, provider } = await readReminderProvider();
    const dueAt = new Date(clock.now() + 30 * oneMinute).toISOString();
    const created = await request('/create', {
      generation,
      owner: provider.owner,
      requestId: administratorTaskId,
      expectedRevision: provider.revision,
      target: reminderConversation,
      parameters: { text: '例会', at: dueAt },
    });
    assert.equal(created.status, 200);
    const task = created.envelope.data.provider.tasks.find(item => item.id === administratorTaskId);
    assert.equal(task?.ownership, 'administrator');
    assert.equal(task?.state, 'scheduled');
  });

  await smokeStep('task center: a paused task does not fire; resuming it before the due time delivers it', async () => {
    const before = await readReminderProvider();
    const paused = await request('/change', {
      generation: before.generation,
      owner: before.provider.owner,
      requestId: randomUUID(),
      expectedRevision: before.provider.revision,
      id: administratorTaskId,
      action: 'pause',
    });
    assert.equal(paused.status, 200);
    kit.clearDeliveries();
    await clock.advance(10 * oneMinute);
    assert.equal(kit.deliveries.length, 0);
    const pausedState = await readReminderProvider();
    const resumed = await request('/change', {
      generation: pausedState.generation,
      owner: pausedState.provider.owner,
      requestId: randomUUID(),
      expectedRevision: pausedState.provider.revision,
      id: administratorTaskId,
      action: 'resume',
    });
    assert.equal(resumed.status, 200);
    await clock.advance(25 * oneMinute);
    assert.equal(kit.deliveries.length, 1);
    assert.match(deliveryText(kit.deliveries[0].payload), /例会/u);
    assert.deepEqual(kit.deliveries[0].conversation, reminderConversation);
  });

  console.log('E2E_SMOKE_REMINDERS_TASK_CENTER_OK');
} finally {
  await httpHost?.close();
  await kit?.close();
  await hosts.stop();
  restoreWallClock();
  await project.dispose();
}
