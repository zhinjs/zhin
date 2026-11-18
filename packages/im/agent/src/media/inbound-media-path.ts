/**
 * Inbound `MediaRef kind: 'path'` authority (#1250).
 *
 * An inbound message is remote input: a local path in it may come from a platform field, a parsed
 * text code or a forwarded node, and reading it would hand any host file to the model. A path is
 * read only when the Endpoint that produced the message declared the directory it downloads inbound
 * media into (`EndpointInboundMediaPort`) and the file's real path — symbolic links resolved, `..`
 * collapsed — lies inside one of them. Even there, the FilePolicy secret checks (`.zhin/`, `.env*`,
 * keys, databases) still apply. Nothing here throws: a refusal is a reason code.
 */
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSensitiveFileAccess, isBlockedDevicePath } from '../security/file-policy.js';

export type InboundMediaPathRefusal = 'inbound_path_not_owned' | 'inbound_path_sensitive';

export type InboundMediaPathDecision =
  | Readonly<{ allowed: true; path: string; root: string }>
  | Readonly<{ allowed: false; reason: InboundMediaPathRefusal }>;

const NOT_OWNED: InboundMediaPathDecision = Object.freeze({ allowed: false, reason: 'inbound_path_not_owned' });
const SENSITIVE: InboundMediaPathDecision = Object.freeze({ allowed: false, reason: 'inbound_path_sensitive' });

function localPathOf(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (/^file:/iu.test(value)) {
    try { return fileURLToPath(value); } catch { return undefined; }
  }
  // No home expansion and no other scheme: `~/…` and `x://…` are never a declared download.
  if (value.startsWith('~') || /^[a-z][a-z0-9+.-]+:/iu.test(value)) return undefined;
  return value;
}

async function realpathOrUndefined(target: string): Promise<string | undefined> {
  try { return await fs.realpath(target); } catch { return undefined; }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

/**
 * The canonical path to read for an inbound `path` media source, or why it must not be read.
 * `roots` are the producing Endpoint's declared inbound media directories (none: nothing is read).
 */
export async function authorizeInboundMediaPath(
  rawPath: string,
  roots: readonly string[] | undefined,
): Promise<InboundMediaPathDecision> {
  if (!roots?.length) return NOT_OWNED;
  const local = localPathOf(rawPath);
  if (!local) return NOT_OWNED;
  const lexical = path.resolve(local);
  const real = await realpathOrUndefined(lexical);
  if (!real) return NOT_OWNED;
  let owner: string | undefined;
  for (const root of roots) {
    const realRoot = await realpathOrUndefined(path.resolve(root));
    if (realRoot && isInside(realRoot, real)) {
      owner = realRoot;
      break;
    }
  }
  if (!owner) return NOT_OWNED;
  if (isSensitive(lexical) || isSensitive(real)) return SENSITIVE;
  return Object.freeze({ allowed: true, path: real, root: owner });
}

function isSensitive(candidate: string): boolean {
  return isBlockedDevicePath(candidate) || !checkSensitiveFileAccess(candidate).allowed;
}

/** Where an open descriptor really is: `/proc/self/fd` on Linux, otherwise the path re-resolved. */
async function openedLocation(handle: fs.FileHandle, opened: string): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try { return await fs.readlink(`/proc/self/fd/${handle.fd}`); } catch { /* no procfs: fall back */ }
  }
  return realpathOrUndefined(opened);
}

/**
 * Read an authorized inbound file once, through one descriptor (#1250 review: TOCTOU). The file is
 * opened without following a final symbolic link, and the descriptor itself — not the path, which
 * may have been swapped since {@link authorizeInboundMediaPath} — must be a regular file inside the
 * declared root (and the same inode the re-resolved path names). Returns `undefined` when any check
 * fails, the file is larger than `maxBytes`, or it cannot be read.
 */
export async function readInboundMediaFile(
  decision: Readonly<{ path: string; root: string }>,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(decision.path, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    const location = await openedLocation(handle, decision.path);
    if (!location || !isInside(decision.root, location) || isSensitive(location)) return undefined;
    const named = await fs.stat(location).catch(() => undefined);
    if (!named || named.dev !== stat.dev || named.ino !== stat.ino) return undefined;
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return undefined;
    return buffer.subarray(0, length);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
