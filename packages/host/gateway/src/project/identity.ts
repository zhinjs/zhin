/**
 * A stable, non-reversible identifier of a project checkout (#1250). The gateway reports it on
 * `GET /pub/health`; the CLI compares it with the project it runs in before it sends a request —
 * and a Console token — to a gateway on this machine, so a command run in project B never lands
 * on project A's gateway that happens to listen on the same port.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** 32 hex characters of SHA-256 over the canonical project root path. */
export function projectIdentity(projectRoot: string): string {
  let root = resolve(projectRoot);
  try { root = realpathSync.native(root); } catch { /* keep the resolved path */ }
  // Windows paths are case-insensitive.
  if (process.platform === 'win32') root = root.toLowerCase();
  return createHash('sha256').update(`zhin-project:${root}`).digest('hex').slice(0, 32);
}
