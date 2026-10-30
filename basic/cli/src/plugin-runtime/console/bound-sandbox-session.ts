import type { SandboxWorkspaceScope } from './sandbox-workspace-scope.js';

/** The live binding owns the target boundary; colons inside target and scene are not separators. */
export function parseBoundSandboxSession(
  scope: Pick<SandboxWorkspaceScope, 'endpoint' | 'endpointKey'>,
  sessionKey: string,
): { status: 'ready'; kind: 'private' | 'group' | 'channel'; id: string }
  | { status: 'scope_mismatch' }
  | { status: 'invalid' } {
  const prefix = `${scope.endpoint.adapter}:${scope.endpointKey}:`;
  if (!sessionKey.startsWith(prefix)) return { status: 'scope_mismatch' };
  const remainder = sessionKey.slice(prefix.length);
  const separator = remainder.indexOf(':');
  const kind = remainder.slice(0, separator);
  if (separator <= 0 || separator === remainder.length - 1
    || (kind !== 'private' && kind !== 'group' && kind !== 'channel')) return { status: 'invalid' };
  return { status: 'ready', kind, id: remainder.slice(separator + 1) };
}
