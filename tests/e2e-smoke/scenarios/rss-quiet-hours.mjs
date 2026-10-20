// Smoke loop: an administrator subscribes two RSS feeds for a group through the task-center API,
// one with quiet hours. On a fake clock, the quiet subscription holds updates overnight and sends one
// digest in the morning, while the normal subscription keeps pushing immediately.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PluginTestKit, FakeClock, FakeScheduleRootHost } from '../../../packages/toolkit/testing/src/index.ts';
import { createHttpHost } from '../../../packages/host/http/src/index.ts';
import { registerPluginTaskRoutes } from '../../../basic/cli/src/plugin-runtime/console/plugin-task-routes.ts';
import { createSmokeProject } from '../harness/smoke-project.mjs';
import { createSmokeHosts } from '../harness/smoke-hosts.mjs';
import { useFakeWallClock } from '../harness/fake-wall-clock.mjs';
import { startLocalFeedServer } from '../harness/local-feed-server.mjs';
import { deliveryText, smokeStep } from '../harness/smoke-checks.mjs';

const fiveMinutes = 5 * 60_000;
// 21:00 in Asia/Shanghai; quiet hours are 22:00–08:00 there.
const eveningBeforeQuietHours = Date.parse('2026-10-20T13:00:00Z');
const lateEveningInQuietHours = Date.parse('2026-10-20T14:00:00Z');
const morningAfterQuietHours = Date.parse('2026-10-21T00:00:00Z');

const project = await createSmokeProject('rss');
const clock = new FakeClock(eveningBeforeQuietHours);
const restoreWallClock = useFakeWallClock(clock);
const schedules = new FakeScheduleRootHost(clock);
const feedServer = await startLocalFeedServer();
const operatorToken = randomUUID();
let kit;
const hosts = createSmokeHosts({ projectRoot: project.root, schedules, currentKit: () => kit });
let httpHost;
let tasksUrl;
let target;

/** Jump to a wall-clock time without firing jobs, then let one poll interval elapse. */
async function pollAt(time) {
  clock.set(time);
  await clock.advance(fiveMinutes);
}

try {
  await smokeStep('install: RSS plugin mounted and a group conversation identity is known', async () => {
    const rssPackage = await project.copyRepositoryPlugin('plugins/utils/rss', 'rss');
    await project.writeJson('package.json', {
      name: '@smoke/rss-bot',
      type: 'module',
      dependencies: { 'zhin.js': '*', '@zhin.js/command': '*', '@zhin.js/tool': '*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });
    await project.write('plugin.ts', "import { definePlugin } from 'zhin.js';\n\nexport default definePlugin({ name: 'smoke-bot' });\n");
    kit = await PluginTestKit.create({
      projectRoot: project.root,
      config: { configVersion: 2, plugins: { rss: rssPackage } },
      installResources: hosts.installResources,
    });
    await kit.start();
    httpHost = createHttpHost({ host: '127.0.0.1', port: 0, token: operatorToken });
    registerPluginTaskRoutes({ http: httpHost, base: '/api', snapshots: kit.snapshots });
    const { port } = await httpHost.listen();
    tasksUrl = `http://127.0.0.1:${port}/api/tasks`;
    const identityProbe = await kit.send({ conversation: { kind: 'group', id: 'smoke-group' }, content: 'identity probe' });
    assert.equal(identityProbe.status, 'sent');
    target = kit.deliveries.at(-1).conversation;
  });

  const request = async (path, body) => {
    const headers = { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' };
    const init = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) };
    const response = await fetch(`${tasksUrl}${path}`, init);
    return { status: response.status, envelope: await response.json() };
  };
  const createSubscription = async parameters => {
    const listing = await request('/providers');
    assert.equal(listing.status, 200);
    const provider = listing.envelope.data.providers.find(item => item.owner === 'root/rss');
    assert.ok(provider, 'the RSS plugin publishes a task provider');
    const created = await request('/create', {
      generation: listing.envelope.data.generation,
      owner: provider.owner,
      requestId: randomUUID(),
      expectedRevision: provider.revision,
      target,
      parameters,
    });
    assert.equal(created.status, 200, JSON.stringify(created.envelope));
  };

  await smokeStep('configure: one quiet-hours subscription and one normal subscription; the first poll only records a baseline', async () => {
    feedServer.publish('/quiet.xml', 'Quiet Source', [{ guid: 'q-baseline', title: 'Quiet baseline' }]);
    feedServer.publish('/normal.xml', 'Normal Source', [{ guid: 'n-baseline', title: 'Normal baseline' }]);
    await createSubscription({ url: feedServer.url('/quiet.xml'), quietTimezone: 'Asia/Shanghai', quietStart: '22:00', quietEnd: '08:00' });
    await createSubscription({ url: feedServer.url('/normal.xml') });
    kit.clearDeliveries();
    await pollAt(eveningBeforeQuietHours);
    assert.equal(kit.deliveries.length, 0);
    assert.ok(feedServer.requestCount >= 2);
  });

  await smokeStep('quiet hours: overnight updates are held for the quiet subscription and pushed for the normal one', async () => {
    feedServer.publish('/quiet.xml', 'Quiet Source', [
      { guid: 'q-two', title: 'Quiet article two' },
      { guid: 'q-one', title: 'Quiet article one' },
      { guid: 'q-baseline', title: 'Quiet baseline' },
    ]);
    feedServer.publish('/normal.xml', 'Normal Source', [
      { guid: 'n-one', title: 'Normal article one' },
      { guid: 'n-baseline', title: 'Normal baseline' },
    ]);
    kit.clearDeliveries();
    await pollAt(lateEveningInQuietHours);
    const texts = kit.deliveries.map(delivery => deliveryText(delivery.payload));
    assert.equal(texts.length, 1);
    assert.match(texts[0], /Normal article one/u);
    assert.doesNotMatch(texts.join('\n'), /Quiet article/u);
  });

  await smokeStep('quiet hours: the first poll after quiet hours sends one digest to the exact target', async () => {
    kit.clearDeliveries();
    await pollAt(morningAfterQuietHours);
    const digests = kit.deliveries.filter(delivery => /RSS 静默摘要/u.test(deliveryText(delivery.payload)));
    assert.equal(digests.length, 1);
    const digestText = deliveryText(digests[0].payload);
    assert.match(digestText, /累计检测到 2 条更新/u);
    assert.match(digestText, /Quiet article one/u);
    assert.match(digestText, /Quiet article two/u);
    assert.deepEqual(digests[0].conversation, target);
  });

  await smokeStep('quiet hours: the digest is not sent twice', async () => {
    kit.clearDeliveries();
    await pollAt(morningAfterQuietHours + fiveMinutes);
    const digests = kit.deliveries.filter(delivery => /RSS 静默摘要/u.test(deliveryText(delivery.payload)));
    assert.equal(digests.length, 0);
  });

  console.log('E2E_SMOKE_RSS_QUIET_HOURS_OK');
} finally {
  await httpHost?.close();
  await kit?.close();
  await hosts.stop();
  await feedServer.close();
  restoreWallClock();
  await project.dispose();
}
