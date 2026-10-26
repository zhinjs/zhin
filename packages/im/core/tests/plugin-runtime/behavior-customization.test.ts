import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

// Use a native child process so discovery and public imports share one Feature realm.
it.each(['root', 'unselected-child'] as const)('runs the documentation behavior example with %s selection through PluginTestKit', async selection => {
  const project = await mkdtemp(join(tmpdir(), 'zhin-behavior-example-'));
  const put = async (path: string, content: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  const manifest = (name: string) => JSON.stringify({ name, version: '1.0.0', type: 'module',
    dependencies: { 'zhin.js': '*', '@zhin.js/command': '*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
  try {
    for (const name of ['adapter', 'command', 'component', 'middleware', 'handler', 'schedule-feature',
      'plugin-runtime', 'core', 'permission', 'im-contract', 'runtime', 'tool', 'skill', 'zhin']) {
      const destination = join(project, 'node_modules', name === 'zhin' ? 'zhin.js' : `@zhin.js/${name}`);
      await mkdir(dirname(destination), { recursive: true });
      await symlink(join(repo, 'packages/im', name), destination, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await put(join(project, 'package.json'), manifest('@test/behavior-example'));
    if (selection === 'root') {
      await cp(join(repo, 'docs/snippets/behavior-customization.ts'), join(project, 'plugin.ts'));
    } else {
      await put(join(project, 'plugin.ts'), "import { definePlugin } from 'zhin.js'; export default definePlugin({ name: 'baseline' });\n");
      await put(join(project, 'plugins/provider/package.json'), manifest('@test/unselected-provider'));
      await cp(join(repo, 'docs/snippets/behavior-customization.ts'), join(project, 'plugins/provider/plugin.ts'));
    }
    await put(join(project, 'commands/restricted/index.ts'), `import { defineCommand } from 'zhin.js/command';
export default defineCommand({ permit: ['role(admin)'], execute: () => 'admitted' });`);
    for (let index = 0; index < 31; index++) {
      await put(join(project, `commands/item-${String(index).padStart(2, '0')}/index.ts`),
        "import { defineCommand } from 'zhin.js/command'; export default defineCommand({ execute: () => 'item' });");
    }
    const scenario = join(project, 'acceptance.mjs');
    await put(scenario, `
import assert from 'node:assert/strict';
import { PluginTestKit } from ${JSON.stringify(pathToFileURL(resolve(repo, 'packages/toolkit/testing/src/index.ts')).href)};
import { htmlRendererToken, childPluginId } from 'zhin.js';
import { commandFeedbackToken, commandMenuPresentationToken } from 'zhin.js/command';
import { outboundPresentationToken } from 'zhin.js/middleware';
import { Html, jsx } from 'zhin.js/jsx';
const selected = ${JSON.stringify(selection === 'root')};
let renderCalls = 0;
const kit = await PluginTestKit.create({ projectRoot: ${JSON.stringify(project)},
  config: { configVersion: 2, ...(selected ? {} : { plugins: { provider: './plugins/provider' } }) },
  endpoints: ['test', 'other'], segments: { html: 'image', markdown: 'native', interactive: 'native',
    outboundMedia: ['base64'], supported: ['text', 'image', 'markdown', 'keyboard'] },
  installResources({ resources }) { resources.provide(htmlRendererToken, { async render() {
    renderCalls++; return { data: Buffer.from('synthetic-image'), format: 'png', mimeType: 'image/png', width: 1, height: 1 };
  } }); },
});
const receive = (content, kind = 'private', roles = []) => kit.receive({
  content, conversation: { kind, id: 'room' }, sender: { id: 'member', roles },
});
try {
  await kit.start();
  const lease = kit.snapshots.acquire();
  const tokens = [commandFeedbackToken, commandMenuPresentationToken, outboundPresentationToken];
  try {
    const snapshot = lease.value;
    for (const token of tokens) {
      assert.equal(typeof snapshot.resources.get(selected ? snapshot.root : childPluginId(snapshot.root, 'provider'))?.get(token.id), 'function');
      assert.equal(snapshot.resources.get(snapshot.root)?.has(token.id), selected);
    }
  } finally { lease.release(); }
  assert.equal((await receive('restricted')).status, 'denied');
  assert.equal(kit.deliveries.at(-1).payload, selected ? '此指令需要管理员权限，请联系管理员。' : '没有权限执行此指令。');
  assert.equal((await receive('restricted', 'group')).status, 'denied');
  assert.equal(kit.deliveries.at(-1).payload, '没有权限执行此指令。');
  assert.equal((await receive('restricted', 'private', ['admin'])).status, 'executed');
  assert.equal(kit.deliveries.at(-1).payload, 'admitted');
  assert.equal(kit.deliveries.length, 3);

  const menu = await receive('菜单');
  assert.equal(menu.status, 'executed');
  assert.equal(menu.menu.page, 1);
  assert.equal(menu.menu.pages, 2);
  const menuPayload = kit.deliveries.at(-1).payload;
  if (selected) assert.equal(menuPayload[0].data.text, menu.menu.text);
  else assert.equal(menuPayload[0].type, 'image');
  const buttons = menuPayload.filter(item => item.type === 'keyboard').flatMap(item => item.data.rows.flat());
  assert.deepEqual(buttons.map(button => button.disabled), [true, false]);
  await kit.receive({ content: '', conversation: { kind: 'private', id: 'room' }, sender: { id: 'member', roles: [] },
    segments: [{ type: 'action', data: { id: 'next', payload: buttons[1].payload } }],
  });
  if (selected) assert.match(kit.deliveries.at(-1).payload[0].data.text, /第 2\\/2 页/);
  const nextButtons = kit.deliveries.at(-1).payload.filter(item => item.type === 'keyboard').flatMap(item => item.data.rows.flat());
  assert.deepEqual(nextButtons.map(button => button.disabled), [false, true]);

  const target = { kind: 'channel', id: 'support', parent: { kind: 'group', id: 'team' }, threadId: 'daily' };
  const content = [jsx(Html, { children: 'Report' }), { type: 'markdown', data: { content: '**ready**' } },
    jsx('button', { label: 'Continue', onClick: () => 'continued' })];
  const before = renderCalls;
  assert.equal((await kit.send({ conversation: target, content })).status, 'sent');
  const compact = kit.deliveries.at(-1);
  assert.deepEqual(compact.conversation, { ...target, endpoint: { id: 'root\\0zhin.adapter\\0test', adapter: 'test' } });
  assert.deepEqual(compact.payload.map(item => item.type), selected ? ['text', 'text', 'text'] : ['image', 'markdown', 'keyboard']);
  assert.equal(renderCalls - before, selected ? 0 : 1);
  for (const [endpoint, conversation] of [
    ['other', target], ['test', { ...target, threadId: 'elsewhere' }],
    ['test', { ...target, parent: { kind: 'group', id: 'other-team' } }],
  ]) {
    await kit.send({ endpoint, conversation, content });
    assert.deepEqual(kit.deliveries.at(-1).payload.map(item => item.type), ['image', 'markdown', 'keyboard']);
  }
  console.log('BEHAVIOR_EXAMPLE_ACCEPTANCE_OK');
} finally { await kit.close(); }
`);
    const result = await promisify(execFile)(process.execPath, ['--conditions=development', '--import', loader, scenario],
      { cwd: project, timeout: 30000 });
    expect(result.stdout).toContain('BEHAVIOR_EXAMPLE_ACCEPTANCE_OK');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}, 35000);
