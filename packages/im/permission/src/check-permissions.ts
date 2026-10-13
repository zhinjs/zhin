import type { Token } from '@zhin.js/plugin-runtime';
import { assertPermitSyntax } from './builtin.js';
import { permissionHostToken } from './token.js';
import type { PermissionHost } from './host.js';
import { toPermissionSubject } from './subject.js';

export interface PermissionContext {
  use<T>(token: Token<T>): T;
  readonly input?: unknown;
}

/** Shared admission helper for commands, middleware and event callbacks. */
export async function checkPermissions(
  context: PermissionContext,
  permits: readonly string[],
  source: unknown = context.input,
): Promise<boolean> {
  assertPermitSyntax(permits);
  if (!permits.length) return true;
  const subject = toPermissionSubject(source);
  if (!subject.sender?.id && !subject.scene?.id && !subject.adapter && !subject.endpoint) return false;
  let host: PermissionHost;
  try { host = context.use(permissionHostToken); }
  catch { return false; }
  if (!host || typeof host.checkAll !== 'function') return false;
  return host.checkAll(permits, subject);
}
