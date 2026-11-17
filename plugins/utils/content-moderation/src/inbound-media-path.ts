/**
 * Inbound image paths the moderation provider may read (#1250).
 *
 * An inbound `MediaRef kind: 'path'` names a file on this host, and the HTTP provider uploads the
 * bytes of every image path it receives. A path is kept only when the producing Endpoint declared
 * the directory it downloads inbound media into (`AdapterIndex.inboundMediaRoots`) and the file's
 * real path — symbolic links resolved, `..` collapsed — lies inside one of them; the image is then
 * read from that canonical path. Any other path is dropped from the image (it stays an unreadable
 * entry, like an opaque platform file reference), so remote input never makes this plugin read a
 * host file.
 */
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractedImage } from './types.js';

function localPathOf(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.includes('\u0000')) return undefined;
  if (/^file:/iu.test(value)) {
    try { return fileURLToPath(value); } catch { return undefined; }
  }
  if (value.startsWith('~') || /^[a-z][a-z0-9+.-]+:/iu.test(value)) return undefined;
  return value;
}

async function realpathOrUndefined(target: string): Promise<string | undefined> {
  try { return await realpath(target); } catch { return undefined; }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** The canonical path to read, or `undefined` when the path lies outside every declared root. */
export async function authorizeInboundImagePath(rawPath: string, roots: readonly string[]): Promise<string | undefined> {
  if (roots.length === 0) return undefined;
  const local = localPathOf(rawPath);
  if (!local) return undefined;
  const real = await realpathOrUndefined(path.resolve(local));
  if (!real) return undefined;
  for (const root of roots) {
    const realRoot = await realpathOrUndefined(path.resolve(root));
    if (realRoot && isInside(realRoot, real)) return real;
  }
  return undefined;
}

/** Images with every path outside the declared roots removed (the rest point at their canonical path). */
export async function confineInboundImagePaths(
  images: readonly ExtractedImage[],
  roots: readonly string[],
): Promise<readonly ExtractedImage[]> {
  if (!images.some(image => image.path !== undefined)) return images;
  const out: ExtractedImage[] = [];
  for (const image of images) {
    if (image.path === undefined) {
      out.push(image);
      continue;
    }
    const { path: rawPath, ...rest } = image;
    const canonical = await authorizeInboundImagePath(rawPath, roots);
    out.push(Object.freeze(canonical ? { ...rest, path: canonical } : rest));
  }
  return Object.freeze(out);
}
