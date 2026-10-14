/**
 * Policy narrowing shared by sub-agent turns (#718) and trust tiers (#726).
 * Every function here only removes authority from a policy; none can add it.
 */
import { turnPolicyAllowsShell } from '../plugin-runtime/native-bash-tool.js';
import type { TurnPolicyContext } from '../turn/turn-ingress.js';

export interface SubagentPolicyNarrowing {
  /** Read-only delegation: no shell, read-only filesystem. */
  readonly readOnly?: boolean;
}

/**
 * Policy for a sub-agent turn. It is derived only from the parent policy, so it
 * can never be wider: every authority the parent lacks stays absent, a shell
 * the parent cannot actually run is dropped, and narrowing only removes power.
 */
export function deriveSubagentPolicy(
  parent: Readonly<TurnPolicyContext>,
  narrowing: SubagentPolicyNarrowing = {},
): Readonly<TurnPolicyContext> {
  const filesystem = parent.filesystem
    ? Object.freeze({
      ...parent.filesystem,
      ...(narrowing.readOnly ? { access: 'read-only' as const } : {}),
    })
    : undefined;
  const keepShell = parent.shell !== undefined
    && !narrowing.readOnly
    && turnPolicyAllowsShell(parent);
  return Object.freeze({
    permissions: Object.freeze([...parent.permissions]),
    unattended: parent.unattended,
    ...(parent.network
      ? {
        network: Object.freeze({
          ...parent.network,
          ...(parent.network.allowedDomains
            ? { allowedDomains: Object.freeze([...parent.network.allowedDomains]) }
            : {}),
        }),
      }
      : {}),
    ...(filesystem ? { filesystem } : {}),
    ...(keepShell ? { shell: Object.freeze({ ...parent.shell }) } : {}),
  });
}
