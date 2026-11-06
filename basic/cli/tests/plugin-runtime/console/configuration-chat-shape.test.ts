import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-chat-shape-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'shape-root', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await mkdir(join(root, 'demo'));
  await writeFile(join(root, 'demo/package.json'), JSON.stringify({ name: 'shape-demo', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await writeFile(join(root, 'demo/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false, properties: {
    safe: { type: 'object', additionalProperties: false, properties: { size: { type: 'number' } } },
    numbers: { type: 'array', items: { type: 'number' } },
    flexible: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] },
  } }));
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { demo: './demo' }, demo: value }));
  return new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(file) });
}

it.each([
  // An object parent is never a chat leaf; a scalar-array parent is, so its malformed element is `unknown`.
  { value: { safe: { size: { apiKey: 'synthetic-private-value' } } }, parent: ['demo', 'safe'], direct: ['demo', 'safe', 'size'], parentKind: 'leaf' },
  { value: { numbers: [1, { apiKey: 'synthetic-private-value' }] }, parent: ['demo', 'numbers'], direct: ['demo', 'numbers', '1'], parentKind: 'unknown' },
])('refuses malformed scalar descendants through direct, parent and root reads: $parent', async ({ value, parent, direct, parentKind }) => {
  const store = await fixture(value);
  await expect(store.readChat(direct, 'get')).rejects.toMatchObject({ kind: 'unknown' });
  await expect(store.readChat(parent, 'get')).rejects.toMatchObject({ kind: parentKind });
  for (const path of [['demo'], []]) await expect(store.readChat(path, 'get')).rejects.toMatchObject({ kind: 'leaf' });
});

it.each([1, 'public', null])('keeps scalar leaves, scalar arrays and scalar unions usable but never whole objects (%j)', async flexible => {
  const value = { safe: { size: 4 }, numbers: [1, 2, 3], flexible };
  const store = await fixture(value);
  await expect(store.readChat(['demo'], 'get')).rejects.toMatchObject({ kind: 'leaf' });
  await expect(store.readChat(['demo', 'safe'], 'get')).rejects.toMatchObject({ kind: 'leaf' });
  expect((await store.readChat(['demo', 'safe', 'size'], 'get')).value).toBe(4);
  expect((await store.readChat(['demo', 'numbers'], 'get')).value).toEqual([1, 2, 3]);
  expect((await store.readChat(['demo', 'flexible'], 'get')).value).toBe(flexible);
});
