import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlRenderer } from '../../html-renderer/src/index.ts';

const requireRenderer = createRequire(new URL('../../html-renderer/package.json', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'zhin-component-shotium-'));
const renderer = createHtmlRenderer({ cacheDir });
process.on('message', async (request) => {
  if (request.stop) {
    try { await requireRenderer('@pixel.js/shotium').stop(); }
    finally { await rm(cacheDir, { recursive: true, force: true }); process.disconnect(); }
    return;
  }
  try {
    const result = await renderer.render(request.html, { width: request.width, format: 'png', scale: 1 });
    process.send({ id: request.id, result });
  } catch (error) {
    process.send({ id: request.id, error: error.stack ?? String(error) });
  }
});
