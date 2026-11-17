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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSensitiveFileAccess, isBlockedDevicePath } from '../security/file-policy.js';

export type InboundMediaPathRefusal = 'inbound_path_not_owned' | 'inbound_path_sensitive';

export type InboundMediaPathDecision =
  | Readonly<{ allowed: true; path: string }>
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
  let owned = false;
  for (const root of roots) {
    const realRoot = await realpathOrUndefined(path.resolve(root));
    if (realRoot && isInside(realRoot, real)) {
      owned = true;
      break;
    }
  }
  if (!owned) return NOT_OWNED;
  for (const candidate of new Set([lexical, real])) {
    if (isBlockedDevicePath(candidate) || !checkSensitiveFileAccess(candidate).allowed) return SENSITIVE;
  }
  return Object.freeze({ allowed: true, path: real });
}
