import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clientAssetContentType, serveClientAsset } from '../../../src/instance/console/asset-server.js';

const failRead = vi.hoisted(() => ({ value: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      if (!failRead.value) return actual.createReadStream(...args);
      // Like a real ReadStream whose open() fails: the error arrives without any consumer.
      const stream = new Readable({ read() {} });
      setImmediate(() => stream.destroy(new Error('EIO')));
      return stream;
    },
  };
});

let dir: string;
const fetchAsset = (path: string) => serveClientAsset(dir, '/assets', decodeURIComponent(new URL(path, 'http://x').pathname));
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zhin-asset-'));
  await writeFile(join(dir, 'app.js'), 'export default 1;');
  await writeFile(join(dir, 'app.css'), 'body{}');
  await mkdir(join(dir, 'folder.js'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('serves each asset with a content type derived from its extension', async () => {
  const js = await fetchAsset(`/assets/app.js`);
  expect(js.status).toBe(200);
  expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  expect(await js.text()).toBe('export default 1;');
  const css = await fetchAsset(`/assets/app.css`);
  expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
  expect(clientAssetContentType('logo.SVG')).toBe('image/svg+xml');
  expect(clientAssetContentType('blob.bin')).toBe('application/octet-stream');
});

it('rejects traversal, directories and missing files', async () => {
  expect((await fetchAsset(`/assets/missing.js`)).status).toBe(404);
  expect((await fetchAsset(`/assets/folder.js`)).status).toBe(404);
  expect((await fetchAsset(`/assets/%2e%2e%2fsecret`)).status).toBe(403);
});

it('answers 500 instead of crashing when the file cannot be read', async () => {
  // A stream 'error' without a listener would be an uncaught exception.
  failRead.value = true;
  try {
    const response = await fetchAsset(`/assets/app.js`);
    expect(response.status).toBe(500);
  } finally {
    failRead.value = false;
  }
  expect((await fetchAsset(`/assets/app.js`)).status).toBe(200);
});
