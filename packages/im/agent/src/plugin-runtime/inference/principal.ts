import { InferenceManagementError, type InferenceManagementPrincipal } from './management.js';

/**
 * Personal owner ids a Console principal (`user:<id>`) may manage. A static map (older Hosts), or
 * a lookup the Host answers from the person ↔ Console links (ADR 0060 P3).
 */
export type InferencePrincipalBindings =
  | Readonly<Record<string, readonly string[]>>
  | ((principalId: string) => readonly string[]);

export interface InferencePrincipalInput {
  readonly hostOwnerId: string;
  readonly scope: 'full' | 'demo';
  readonly principalId?: string;
  readonly requestedOwner?: string;
  /** Already validated administrator bindings, expressed in canonical personal owner IDs. */
  readonly bindings: InferencePrincipalBindings;
}

function ownersOf(bindings: InferencePrincipalBindings, principalId: string | undefined): readonly string[] | undefined {
  if (!principalId) return undefined;
  return typeof bindings === 'function' ? bindings(principalId) : bindings[principalId];
}

/**
 * - `full` without an owner (or with the Host owner): the Host administrator.
 * - `full` with another owner: only a personal owner bound to the caller (ADR 0060 P3: the Console
 *   may switch to the personal inference owner of the person linked to the signed-in user).
 * - `demo`: the caller's only bound owner, or the requested one when it is bound.
 */
export function resolveInferenceManagementPrincipal(
  input: InferencePrincipalInput
): InferenceManagementPrincipal {
  if (input.scope === 'full') {
    if (!input.requestedOwner || input.requestedOwner === input.hostOwnerId)
      return { ownerId: input.hostOwnerId, hostAdministrator: true };
    if (!ownersOf(input.bindings, input.principalId)?.includes(input.requestedOwner))
      throw new InferenceManagementError('forbidden');
    return { ownerId: input.requestedOwner, hostAdministrator: false };
  }
  const owners = ownersOf(input.bindings, input.principalId);
  const owner = input.requestedOwner ?? (owners?.length === 1 ? owners[0] : undefined);
  if (!owner || owner === input.hostOwnerId || !owners?.includes(owner))
    throw new InferenceManagementError('forbidden');
  return { ownerId: owner, hostAdministrator: false };
}
