import { createReadStream, existsSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { extname, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
  ALLOWED_ESM_CANONICAL,
  decodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
} from '@zhin.js/pagemanager/node';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

/**
 * Serve Host-proxied React/router ESM modules (legacy `consoleApiRouter` `/esm/:enc.mjs` parity).
 * Path: `/esm/<encodeURIComponent(canonical).replace(/%2F/g,'~')>.mjs`
 */
export async function serveCanonicalEsm(
  resolveDir: string,
  pathname: string,
): Promise<Response> {
  const match = pathname.match(/^\/esm\/(.+)\.mjs$/u);
  if (!match) return new Response(null, { status: 404 });
  let canonical: string;
  try {
    canonical = decodeSpecifierSegment(match[1]!);
  } catch {
    return json(400, { message: 'Invalid esm enc' });
  }
  if (!ALLOWED_ESM_CANONICAL.has(canonical)) {
    return json(403, { message: 'ESM canonical not allowed' });
  }
  try {
    const code = await getOrBuildCanonicalEsmBundle(canonical, resolveDir, '/');
    return new Response(code, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return json(500, {
      message: error instanceof Error ? error.message : 'Failed to build ESM',
    });
  }
}

export async function serveClientAsset(
  outDir: string,
  publicBase: string,
  pathname: string,
): Promise<Response> {
  const relativePath = pathname.slice(publicBase.length).replace(/^\/+/u, '');
  if (!relativePath || relativePath.includes('\0')) return new Response(null, { status: 400 });
  const file = resolve(outDir, relativePath);
  const root = resolve(outDir);
  const rel = relative(root, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') return new Response(null, { status: 403 });
  if (!existsSync(file) || !statSync(file).isFile()) return new Response(null, { status: 404 });
  const stream = createReadStream(file);
  // Headers go out only once the file is readable; a read error (unlinked or
  // unreadable file) becomes a 500 instead of an unhandled 'error' event.
  try {
    await once(stream, 'open');
  } catch {
    stream.destroy();
    return new Response(null, { status: 500 });
  }
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'content-type': clientAssetContentType(file),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

const CLIENT_ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export function clientAssetContentType(file: string): string {
  return CLIENT_ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
