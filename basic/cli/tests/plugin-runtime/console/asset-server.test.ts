import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { clientAssetContentType, serveClientAsset } from '../../../src/plugin-runtime/console/asset-server.js';

let dir: string;
let server: Server;
let origin: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zhin-asset-'));
  await writeFile(join(dir, 'app.js'), 'export default 1;');
  await writeFile(join(dir, 'app.css'), 'body{}');
  await mkdir(join(dir, 'folder.js'));
  server = createServer((request, response) => {
    void serveClientAsset(dir, '/assets', new URL(request.url!, 'http://x').pathname, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

it('serves each asset with a content type derived from its extension', async () => {
  const js = await fetch(`${origin}/assets/app.js`);
  expect(js.status).toBe(200);
  expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  expect(await js.text()).toBe('export default 1;');
  const css = await fetch(`${origin}/assets/app.css`);
  expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
  expect(clientAssetContentType('logo.SVG')).toBe('image/svg+xml');
  expect(clientAssetContentType('blob.bin')).toBe('application/octet-stream');
});

it('rejects traversal, directories and missing files', async () => {
  expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
  expect((await fetch(`${origin}/assets/folder.js`)).status).toBe(404);
  expect((await fetch(`${origin}/assets/%2e%2e%2fsecret`)).status).toBe(403);
});

it('answers 500 instead of crashing when the file cannot be read', async () => {
  // A stream 'error' without a listener would be an uncaught exception.
  const response = {
    headersSent: false,
    status: 0,
    ended: false,
    writeHead(code: number) { this.status = code; this.headersSent = true; },
    end() { this.ended = true; },
    destroy() { this.ended = true; },
  };
  const unreadable = join(dir, 'gone.js');
  await writeFile(unreadable, 'x');
  const serving = serveClientAsset(dir, '/assets', '/assets/gone.js', response as never);
  // existsSync/statSync passed synchronously; remove the file before the stream opens it.
  await rm(unreadable);
  await serving;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(response.status).toBe(500);
  expect(response.ended).toBe(true);
});
