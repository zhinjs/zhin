import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalImageAssetStore, type LocalImageScope } from '../../src/media/local-image-assets.js';
import { captureMcpImages } from '../../src/media/mcp-image-results.js';
import { authorizeTurnFileInput } from '../../src/security/turn-file-authority.js';

const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const scope: LocalImageScope = { origin: { kind: 'im', platform: 'icqq', endpoint: 'bot1', scope: 'group', sceneId: 'group1' },
  principal: { subjectId: 'alice', roles: [] }, sessionKey: 'group1' };
let root: string;
let directory: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zhin-private-images-')); directory = join(root, 'data', 'agent-assets'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('keeps original bytes private, survives restart and permits only the originating principal/conversation', async () => {
  const store = new LocalImageAssetStore(directory);
  const reference = await store.capture(image, scope, 'mcp:screenshot');
  expect(JSON.stringify(reference)).not.toContain(image);
  expect(JSON.stringify(reference)).not.toContain(root);
  expect(await readFile(join(directory, reference.asset_id, 'image'))).toEqual(Buffer.from(image, 'base64'));
  if (process.platform !== 'win32') expect((await stat(join(directory, reference.asset_id, 'image'))).mode & 0o777).toBe(0o600);
  const restarted = new LocalImageAssetStore(directory);
  expect((await restarted.read(reference.asset_id, scope)).bytes).toEqual(Buffer.from(image, 'base64'));
  expect(await restarted.inspect(reference.asset_id, { ...scope, sessionKey: 'group1#subagent:1' })).toEqual(reference);
  for (const other of [
    { ...scope, principal: { subjectId: 'bob', roles: ['master'] } },
    { ...scope, origin: { ...scope.origin, kind: 'im' as const, platform: 'icqq', endpoint: 'bot2', scope: 'group' as const, sceneId: 'group1' } },
    { ...scope, origin: { kind: 'im' as const, platform: 'icqq', endpoint: 'bot1', scope: 'group' as const, sceneId: 'group2' } },
  ]) await expect(restarted.read(reference.asset_id, other)).rejects.toThrow('unavailable');
  for (const tool of ['read_file', 'upload_image']) {
    expect(await authorizeTurnFileInput(tool, { file_path: join(directory, reference.asset_id, 'image') }, root)).toMatchObject({ allowed: false });
  }
  await expect(restarted.read('../other', scope)).rejects.toThrow('unavailable');
  await rm(join(directory, reference.asset_id, 'image'));
  await writeFile(join(root, 'outside.gif'), Buffer.from(image, 'base64'));
  await symlink(join(root, 'outside.gif'), join(directory, reference.asset_id, 'image'));
  await expect(restarted.read(reference.asset_id, scope)).rejects.toThrow();
});

it('serializes capacity admission, rejects new images at capacity, and reclaims only expired managed files', async () => {
  let now = 1_000;
  const store = new LocalImageAssetStore(directory, undefined, () => now, { maxCount: 2, maxBytes: 200, retentionMs: 100 });
  const results = await Promise.allSettled([1, 2, 3].map(() => store.capture(image, scope, 'screenshot')));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const first = results[0];
  if (first.status !== 'fulfilled') throw new Error('First capture failed');
  await writeFile(join(directory, 'operator-notes.txt'), 'KEEP');
  now = 1_099;
  await store.read(first.value.asset_id, scope);
  now = 1_100;
  await expect(store.read(first.value.asset_id, scope)).rejects.toThrow('unavailable');
  const newImage = await store.capture(image, scope, 'after-expiry');
  expect(await readdir(directory)).toEqual(expect.arrayContaining(['operator-notes.txt', newImage.asset_id]));
  expect(await readFile(join(directory, 'operator-notes.txt'), 'utf8')).toBe('KEEP');
  expect(await readdir(directory)).not.toContain(first.value.asset_id);
});

it('cleans interrupted writes on startup and shares one timer across overlapping generations', async () => {
  await mkdir(directory, { recursive: true });
  const stale = '.tmp-12345678-1234-4123-8123-123456789abc';
  await mkdir(join(directory, stale));
  await writeFile(join(directory, stale, 'image'), 'interrupted');
  const interval = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const store = new LocalImageAssetStore(directory);
  const first = await store.acquire();
  const second = await store.acquire();
  try {
    expect(await readdir(directory)).not.toContain(stale);
    expect(interval).toHaveBeenCalledTimes(1);
    first();
    expect(clear).not.toHaveBeenCalled();
    second();
    expect(clear).toHaveBeenCalledTimes(1);
  } finally { first(); second(); interval.mockRestore(); clear.mockRestore(); }
});

it('does not publish references on cancellation or storage failure, and leaves no temporary file', async () => {
  const store = new LocalImageAssetStore(directory);
  const controller = new AbortController(); controller.abort();
  await expect(store.capture(image, scope, 'cancelled', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(directory, 'not a directory');
  await expect(store.capture(image, scope, 'disk failure')).rejects.toThrow();
  expect(await readFile(directory, 'utf8')).toBe('not a directory');
});

it('captures protocol images, image resources and mirrored binary copies without publishing or losing tool text', async () => {
  const store = new LocalImageAssetStore(directory);
  const result = { content: [
    { type: 'text', text: 'The operation completed.' },
    { type: 'image', data: image, mimeType: 'image/gif' },
    { type: 'resource', resource: { uri: 'private:screenshot', mimeType: 'image/gif', blob: image } },
    { type: 'text', text: JSON.stringify({ copiedImage: image }) },
  ], structuredContent: { original: image }, isError: false };
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const output = await captureMcpImages(result, store, scope, 'mcp:test');
    expect(JSON.stringify(output)).not.toContain(image);
    expect(JSON.stringify(output)).toContain('The operation completed.');
    expect(JSON.stringify(output)).toContain('asset_id');
    expect(output).toMatchObject({ isError: false });
    expect(await readdir(directory)).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.content[1]).toHaveProperty('data', image);
    const unavailable = await captureMcpImages(result, undefined, undefined, 'unconfigured');
    expect(JSON.stringify(unavailable)).not.toContain(image);
    expect(JSON.stringify(unavailable)).toContain('unavailable');
  } finally { fetchSpy.mockRestore(); }
});
