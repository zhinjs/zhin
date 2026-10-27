// Native loop of the group-suite welcome suite (see welcome.test.ts): multi-instance isolation, HMR and config rollback.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginTestKit, FakeScheduleRootHost, FakeClock } from '../../../../packages/toolkit/testing/src/index.ts';
import { scheduleRootHostToken, scheduleHostToken, PluginScheduleHost, rootPluginId } from '../../../../packages/im/plugin-runtime/src/index.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = await mkdtemp(join(tmpdir(), 'zhin-group-suite-welcome-'));
let kit;
const put = async (path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };
try {
  for (const name of ['adapter', 'command', 'component', 'middleware', 'handler', 'schedule-feature', 'plugin-runtime', 'core', 'permission', 'im-contract', 'runtime', 'tool', 'skill']) {
    const target = join(temporary, 'node_modules', '@zhin.js', name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(join(repo, 'packages/im', name), target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  await symlink(join(repo, 'packages/im/zhin'), join(temporary, 'node_modules/zhin.js'), process.platform === 'win32' ? 'junction' : 'dir');
  const fixture = join(temporary, 'plugins/group-suite');
  await cp(join(repo, 'plugins/utils/group-suite'), fixture, { recursive: true,
    filter: source => !['node_modules', 'lib', '.zhin', 'tests'].includes(source.split(/[\\/]/u).at(-1)) });
  await symlink(await realpath(join(repo, 'plugins/utils/group-suite/node_modules')), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await put(join(temporary, 'package.json'), JSON.stringify({ name: '@test/welcome-scope', type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/tool': '*', '@zhin.js/skill': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await put(join(temporary, 'plugin.ts'), "import {definePlugin} from 'zhin.js';export default definePlugin({name:'welcome-scope'});");
  const schedules = new FakeScheduleRootHost(new FakeClock());
  kit = await PluginTestKit.create({ projectRoot: temporary, endpoints: ['first', 'second'],
    config: { configVersion: 2, plugins: { alpha: './plugins/group-suite', beta: './plugins/group-suite' },
      alpha: { commandNamespace: 'alpha', welcomeMessage: 'alpha {name} ({id})' },
      beta: { commandNamespace: 'beta', welcomeMessage: 'beta {name}' } },
    installResources: ({ resources }) => {
      resources.provide(scheduleRootHostToken, schedules);
      resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), schedules));
    } });
  await kit.start();
  await kit.send({ endpoint: 'first', conversation: { kind: 'group', id: 'g1' }, content: 'identity' });
  const conversation = kit.deliveries.at(-1).conversation;
  const notice = { id: 'joined', type: 'notice', name: 'notice.group.member_increase', timestamp: Date.now(), metadata: {},
    conversation: { kind: 'group', id: 'g1' }, target: { id: 'new', name: 'Bob' } };
  const emit = async (payload = notice, endpoint = 'first') => { kit.clearDeliveries(); await kit.emit('notice.receive', payload, endpoint); return kit.deliveries; };
  assert.equal((await emit()).length, 2); // Both omitted scopes preserve the existing behavior.
  await kit.patchConfig([{ op: 'set', path: ['alpha', 'welcomeConversations'], value: [] }]);
  assert.equal((await emit()).length, 1); assert.equal(kit.deliveries[0].payload[0].data.text, 'beta Bob');
  await kit.patchConfig([{ op: 'set', path: ['beta', 'welcomeConversations'], value: [] },
    { op: 'set', path: ['alpha', 'welcomeConversations'], value: [conversation, conversation] }]);
  assert.equal((await emit()).length, 1); assert.deepEqual(kit.deliveries[0].conversation, conversation);
  assert.equal((await emit(notice, 'second')).length, 0); // Same group id on another account is a different conversation.
  // Parent/thread mismatch matrix lives once in welcome.test.ts (delivery layer); not repeated here.
  const nested = { ...conversation, parent: { kind: 'channel', id: 'parent' }, threadId: 'topic' };
  await kit.patchConfig([{ op: 'set', path: ['alpha', 'welcomeConversations'], value: [nested] }]);
  const nestedNotice = { ...notice, conversation: { ...notice.conversation, parent: nested.parent, threadId: nested.threadId } };
  assert.equal((await emit(nestedNotice)).length, 1); assert.deepEqual(kit.deliveries[0].conversation, nested);
  assert.equal((await emit()).length, 0);
  await kit.patchConfig([{ op: 'set', path: ['alpha', 'welcomeMessage'], value: '' }]);
  assert.equal((await emit(nestedNotice)).length, 0);
  await kit.patchConfig([{ op: 'set', path: ['alpha', 'welcomeMessage'], value: 'alpha {name} ({id})' }]);
  // Address-level invalid values are unit-tested in welcome.test.ts; here keep one of them plus the schema-only extra-field cases.
  for (const invalid of [null, [{ ...nested, extra: true }],
    [{ ...nested, parent: { ...nested.parent, extra: true } }], [{ ...nested, endpoint: { ...nested.endpoint, extra: true } }]]) {
    const generation = kit.generation;
    await assert.rejects(kit.patchConfig([{ op: 'set', path: ['alpha', 'welcomeConversations'], value: invalid }]));
    assert.equal(kit.generation, generation); assert.equal((await emit(nestedNotice)).length, 1);
  }
  const source = join(fixture, 'handlers/welcome/index.ts');
  await put(source, (await readFile(source, 'utf8')).replace("const content = text.replaceAll", "const content = ('HMR ' + text).replaceAll"));
  assert.equal((await kit.reloadSource(source)).status, 'reloaded');
  assert.equal((await emit(nestedNotice)).length, 1); assert.match(kit.deliveries[0].payload[0].data.text, /^HMR alpha/);
  assert.equal((await emit()).length, 0);
  console.log('WELCOME_SCOPE_NATIVE_OK');
} finally { await kit?.close(); await rm(temporary, { recursive: true, force: true }); }
