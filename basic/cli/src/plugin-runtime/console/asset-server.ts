import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import {
  ALLOWED_ESM_CANONICAL,
  decodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
} from '@zhin.js/pagemanager/node';

/**
 * Serve Host-proxied React/router ESM modules (legacy `consoleApiRouter` `/esm/:enc.mjs` parity).
 * Path: `/esm/<encodeURIComponent(canonical).replace(/%2F/g,'~')>.mjs`
 */
export async function serveCanonicalEsm(
  resolveDir: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const match = pathname.match(/^\/esm\/(.+)\.mjs$/u);
  if (!match) {
    response.writeHead(404);
    response.end();
    return;
  }
  let canonical: string;
  try {
    canonical = decodeSpecifierSegment(match[1]!);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Invalid esm enc' }));
    return;
  }
  if (!ALLOWED_ESM_CANONICAL.has(canonical)) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'ESM canonical not allowed' }));
    return;
  }
  try {
    const code = await getOrBuildCanonicalEsmBundle(canonical, resolveDir, '/');
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    response.end(code);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      message: error instanceof Error ? error.message : 'Failed to build ESM',
    }));
  }
}

export async function serveClientAsset(
  outDir: string,
  publicBase: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const relativePath = pathname.slice(publicBase.length).replace(/^\/+/u, '');
  if (!relativePath || relativePath.includes('\0')) {
    response.writeHead(400);
    response.end();
    return;
  }
  const file = resolve(outDir, relativePath);
  const root = resolve(outDir);
  const rel = relative(root, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') {
    response.writeHead(403);
    response.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(response);
}
