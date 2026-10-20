// Smoke loop: install a v1 project → migrate its config to v2 → boot the migrated project →
// talk to it → read what happened through the real `GET /api/messages/diagnostics` route.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PluginTestKit, FakeClock, FakeScheduleRootHost } from '../../../packages/toolkit/testing/src/index.ts';
import { PluginScheduleHost, rootPluginId, scheduleHostToken, scheduleRootHostToken } from '../../../packages/im/plugin-runtime/src/index.ts';
import { createConfigDocument } from '../../../packages/im/config-file/src/index.ts';
import { createHttpHost } from '../../../packages/host/http/src/index.ts';
import { applyInstanceDeclarationMigration, planInstanceDeclarationMigration } from '../../../basic/cli/src/plugin-runtime/migrate/instance-declarations.ts';
import { registerMessageDiagnosticRoutes } from '../../../basic/cli/src/plugin-runtime/console/message-diagnostic-routes.ts';
import { createSmokeProject } from '../harness/smoke-project.mjs';
import { lastDeliveryText, smokeStep } from '../harness/smoke-checks.mjs';

const legacyConfiguration = [
  '# Smoke bot configuration written before configVersion 2.',
  'plugins:',
  '  suite: # group operations',
  '    commandNamespace: suite',
  '    welcomeMessage: "欢迎 {name}"',
  '',
].join('\n');

const rootPluginSource = [
  "import { definePlugin, Schema } from 'zhin.js';",
  '',
  'export default definePlugin({',
  "  name: 'smoke-bot',",
  "  config: Schema.object({ pingReply: Schema.string().default('pong') }),",
  '});',
  '',
].join('\n');

const pingCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  '  execute: ({ config }) => config.pingReply,',
  '});',
  '',
].join('\n');

const adminCommandSource = [
  "import { defineCommand } from 'zhin.js/command';",
  '',
  'export default defineCommand({',
  "  permit: ['role(admin)'],",
  "  execute: () => 'admin ok',",
  '});',
  '',
].join('\n');

const project = await createSmokeProject('migrate');
const operatorToken = randomUUID();
const demoToken = randomUUID();
let kit;
let httpHost;
try {
  await smokeStep('install: v1 project with a plugin instance declared in package.json', async () => {
    const suitePackage = await project.copyRepositoryPlugin('plugins/utils/group-suite', 'group-suite');
    await project.writeJson('package.json', {
      name: '@smoke/bot',
      type: 'module',
      dependencies: { 'zhin.js': '*', '@zhin.js/tool': '*', '@zhin.js/skill': '*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [{ package: suitePackage, instanceKey: 'suite' }] },
    });
    await project.write('plugin.ts', rootPluginSource);
    await project.write('commands/ping/index.ts', pingCommandSource);
    await project.write('commands/admin-only/index.ts', adminCommandSource);
    await project.write('zhin.config.yml', legacyConfiguration);
  });

  await smokeStep('migrate: unversioned config becomes configVersion 2 without losing values or comments', async () => {
    const plan = await planInstanceDeclarationMigration(project.root);
    assert.deepEqual(plan.instances.map(instance => instance.instanceKey), ['suite']);
    await applyInstanceDeclarationMigration(plan);
    const migratedSource = await project.read('zhin.config.yml');
    assert.match(migratedSource, /# group operations/u);
    const migrated = await createConfigDocument(project.path('zhin.config.yml')).read();
    assert.equal(migrated.document.configVersion, 2);
    assert.deepEqual(migrated.document.plugins, { suite: './plugins/group-suite' });
    assert.deepEqual(migrated.document.suite, { commandNamespace: 'suite', welcomeMessage: '欢迎 {name}' });
    const migratedPackage = JSON.parse(await project.read('package.json'));
    assert.deepEqual(migratedPackage.zhin.plugins, []);
  });

  await smokeStep('boot: the migrated configuration starts a real runtime generation', async () => {
    const migrated = await createConfigDocument(project.path('zhin.config.yml')).read();
    const schedules = new FakeScheduleRootHost(new FakeClock());
    kit = await PluginTestKit.create({
      projectRoot: project.root,
      config: migrated.document,
      installResources: ({ resources }) => {
        resources.provide(scheduleRootHostToken, schedules);
        resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedules));
      },
    });
    assert.equal(await kit.start(), 1);
  });

  const conversation = { kind: 'group', id: 'smoke-group' };
  const member = { id: 'smoke-member', name: 'Alice', roles: [] };

  await smokeStep('conversation: root command replies with its configured default', async () => {
    const result = await kit.receive({ conversation, sender: member, content: 'ping', message: { id: 'message-ping' } });
    assert.equal(result?.status, 'executed');
    assert.equal(lastDeliveryText(kit.deliveries), 'pong');
  });

  await smokeStep('conversation: migrated plugin instance still welcomes new members', async () => {
    kit.clearDeliveries();
    const joined = {
      id: 'joined-1',
      type: 'notice',
      name: 'notice.group.member_increase',
      timestamp: Date.now(),
      metadata: {},
      conversation,
      target: { id: 'new-member', name: 'Bob' },
    };
    await kit.emit('notice.receive', joined);
    assert.equal(kit.deliveries.length, 1);
    assert.equal(lastDeliveryText(kit.deliveries), '欢迎 Bob');
  });

  await smokeStep('conversation: permission denial and unmatched text are recorded, not silently dropped', async () => {
    const denied = await kit.receive({ conversation, sender: member, content: 'admin-only', message: { id: 'message-denied' } });
    assert.equal(denied?.status, 'denied');
    const unmatched = await kit.receive({ conversation, sender: member, content: 'secret-body-marker', message: { id: 'message-unmatched' } });
    assert.notEqual(unmatched?.matched, true);
  });

  let diagnosticsUrl;
  await smokeStep('verify: diagnostics API needs a full-scope token', async () => {
    httpHost = createHttpHost({ host: '127.0.0.1', port: 0, token: operatorToken, tokens: [{ token: demoToken, scope: 'demo' }] });
    registerMessageDiagnosticRoutes({ http: httpHost, base: '/api', diagnostics: kit.messageDiagnostics });
    const { port } = await httpHost.listen();
    diagnosticsUrl = `http://127.0.0.1:${port}/api/messages/diagnostics`;
    const anonymous = await fetch(diagnosticsUrl);
    assert.equal(anonymous.status, 401);
    const demoScope = await fetch(diagnosticsUrl, { headers: { authorization: `Bearer ${demoToken}` } });
    assert.equal(demoScope.status, 403);
  });

  await smokeStep('verify: GET /api/messages/diagnostics explains each message without message bodies', async () => {
    const response = await fetch(diagnosticsUrl, { headers: { authorization: `Bearer ${operatorToken}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    const byMessageId = new Map(body.data.map(record => [record.messageId, record]));
    const executed = byMessageId.get('message-ping');
    assert.equal(executed?.route, 'command');
    assert.equal(executed?.dispatchStatus, 'executed');
    assert.deepEqual(executed?.deliveries.map(delivery => delivery.status), ['sent']);
    assert.equal(byMessageId.get('message-denied')?.dispatchStatus, 'denied');
    const unmatched = byMessageId.get('message-unmatched');
    assert.ok(unmatched, 'the unmatched message has a diagnostic record');
    assert.equal(unmatched.route, 'unmatched');
    assert.equal(JSON.stringify(body).includes('secret-body-marker'), false);
  });

  await smokeStep('verify: one diagnostic can be read back by id and by exact conversation + messageId', async () => {
    const listed = kit.messageDiagnostics.list();
    const pingRecord = listed.find(record => record.messageId === 'message-ping');
    assert.ok(pingRecord);
    const headers = { authorization: `Bearer ${operatorToken}` };
    const single = await fetch(`${diagnosticsUrl}?id=${encodeURIComponent(pingRecord.id)}`, { headers });
    assert.equal(single.status, 200);
    assert.equal((await single.json()).data.id, pingRecord.id);
    const query = new URLSearchParams({ conversation: JSON.stringify(pingRecord.conversation), messageId: 'message-ping' });
    const scoped = await fetch(`${diagnosticsUrl}?${query}`, { headers });
    const scopedBody = await scoped.json();
    assert.deepEqual(scopedBody.data.map(record => record.id), [pingRecord.id]);
  });

  console.log('E2E_SMOKE_INSTALL_MIGRATE_BOOT_DIAGNOSE_OK');
} finally {
  await httpHost?.close();
  await kit?.close();
  await project.dispose();
}
