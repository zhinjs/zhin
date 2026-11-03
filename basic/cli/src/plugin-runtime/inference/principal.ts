import { InferenceManagementError, type InferenceManagementPrincipal } from './management.js';

export interface InferencePrincipalInput {
  readonly hostOwnerId: string;
  readonly scope: 'full' | 'demo';
  readonly principalId?: string;
  readonly requestedOwner?: string;
  /** Already validated static administrator bindings, expressed in canonical personal owner IDs. */
  readonly bindings: Readonly<Record<string, readonly string[]>>;
}

export function resolveInferenceManagementPrincipal(
  input: InferencePrincipalInput
): InferenceManagementPrincipal {
  if (input.scope === 'full') {
    if (input.requestedOwner && input.requestedOwner !== input.hostOwnerId)
      throw new InferenceManagementError('forbidden');
    return { ownerId: input.hostOwnerId, hostAdministrator: true };
  }
  const owners = input.principalId ? input.bindings[input.principalId] : undefined;
  const owner = input.requestedOwner ?? (owners?.length === 1 ? owners[0] : undefined);
  if (!owner || owner === input.hostOwnerId || !owners?.includes(owner))
    throw new InferenceManagementError('forbidden');
  return { ownerId: owner, hostAdministrator: false };
}
