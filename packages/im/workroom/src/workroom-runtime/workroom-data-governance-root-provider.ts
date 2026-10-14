import {
  createRootPrivateToken,
  type PluginId,
  type Scope,
} from '@zhin.js/plugin-runtime';
import type { PayloadVaultCryptographyPort } from '../data-governance/encrypted-file-payload-vault.js';
import type { DataGovernanceAuthorityVerificationPort } from '../data-governance/governance-authority-repository.js';
import type {
  PayloadLifecycleCommandAuthorityPort,
  PayloadLifecycleKernelClockPort,
  PayloadLocationDeletionPort,
  PayloadPurgeReceiptAuthorityPort,
  PayloadSubjectErasureResolverPort,
} from '../data-governance/payload-lifecycle.js';
import type { GovernedPayloadWritePurgePort } from '../data-governance/governed-payload-write-saga.js';
import type { WorkroomDataLifecycleConsoleAuthorityPort } from './workroom-data-lifecycle-console.js';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface WorkroomDataGovernanceRootProviderRequest {
  readonly version: 1;
  readonly generation: number;
  readonly requester: PluginId;
  readonly digest: string;
}

export interface WorkroomDataLifecycleRootAuthorities {
  /** Authority-owned identity; never accepted from command bodies or Console metadata. */
  readonly registrationPrincipalId: string;
  readonly clock: PayloadLifecycleKernelClockPort;
  readonly authority: PayloadLifecycleCommandAuthorityPort;
  readonly subjects: PayloadSubjectErasureResolverPort;
  readonly deletion: PayloadLocationDeletionPort;
  readonly receipts: PayloadPurgeReceiptAuthorityPort;
  readonly orphanPurge: GovernedPayloadWritePurgePort;
  /** Optional authenticated human role authority; absence disables the Console lifecycle plane. */
  readonly console?: WorkroomDataLifecycleConsoleAuthorityPort;
}

export interface WorkroomDataGovernanceRootProviderResolution {
  readonly version: 1;
  readonly generation: number;
  readonly requestDigest: string;
  readonly providerId: string;
  readonly cryptography: PayloadVaultCryptographyPort;
  readonly governance: DataGovernanceAuthorityVerificationPort;
  readonly lifecycle?: WorkroomDataLifecycleRootAuthorities;
}

export interface WorkroomDataGovernanceRootProviderPort {
  resolve(
    request: WorkroomDataGovernanceRootProviderRequest,
    signal: AbortSignal,
  ): Promise<WorkroomDataGovernanceRootProviderResolution | null>;
}

/** Root-only: child Plugin scopes and Runtime snapshots cannot observe this token. */
export const workroomDataGovernanceRootProviderToken =
  createRootPrivateToken<WorkroomDataGovernanceRootProviderPort>(
    'zhin.agent.workroom-data-governance-root-provider',
    'Generation-bound private KMS and governance authority provider',
  );

export function createWorkroomDataGovernanceRootProviderRequest(input: Readonly<{
  generation: number;
  requester: PluginId;
}>): WorkroomDataGovernanceRootProviderRequest {
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error('Workroom Data Governance Root provider generation is invalid');
  }
  const body = deepFreeze({
    version: 1 as const,
    generation: input.generation,
    requester: input.requester,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export async function resolveWorkroomDataGovernanceRootAuthorities(options: Readonly<{
  resources: Pick<Scope, 'has' | 'use'>;
  generation: number;
  requester: PluginId;
  signal: AbortSignal;
  fallbackCryptography?: PayloadVaultCryptographyPort;
  fallbackGovernance?: DataGovernanceAuthorityVerificationPort;
}>): Promise<WorkroomDataGovernanceRootProviderResolution | undefined> {
  options.signal.throwIfAborted();
  const request = createWorkroomDataGovernanceRootProviderRequest(options);
  if (!options.resources.has(workroomDataGovernanceRootProviderToken)) {
    if (!options.fallbackCryptography || !options.fallbackGovernance) return undefined;
    return Object.freeze({
      version: 1,
      generation: options.generation,
      requestDigest: request.digest,
      providerId: 'trusted-root-option:fallback',
      cryptography: options.fallbackCryptography,
      governance: options.fallbackGovernance,
    });
  }
  const resolved = await options.resources.use(workroomDataGovernanceRootProviderToken)
    .resolve(request, options.signal);
  options.signal.throwIfAborted();
  if (!resolved) return undefined;
  if (resolved.version !== 1 || resolved.generation !== request.generation) {
    throw new Error('Workroom Data Governance Root provider generation binding drift');
  }
  if (resolved.requestDigest !== request.digest) {
    throw new Error('Workroom Data Governance Root provider request binding drift');
  }
  if (!resolved.providerId || resolved.providerId.trim() !== resolved.providerId
    || typeof resolved.cryptography?.wrap !== 'function'
    || typeof resolved.cryptography?.unwrap !== 'function'
    || typeof resolved.governance?.verify !== 'function') {
    throw new Error('Workroom Data Governance Root provider capability is invalid');
  }
  if (resolved.lifecycle && (!resolved.lifecycle.registrationPrincipalId
    || resolved.lifecycle.registrationPrincipalId.trim() !== resolved.lifecycle.registrationPrincipalId
    || typeof resolved.lifecycle.clock?.read !== 'function'
    || typeof resolved.lifecycle.authority?.authorize !== 'function'
    || typeof resolved.lifecycle.authority?.verify !== 'function'
    || typeof resolved.lifecycle.subjects?.resolve !== 'function'
    || typeof resolved.lifecycle.deletion?.purge !== 'function'
    || typeof resolved.lifecycle.receipts?.verify !== 'function'
    || typeof resolved.lifecycle.orphanPurge?.purge !== 'function'
    || typeof resolved.lifecycle.orphanPurge?.reconcile !== 'function'
    || resolved.lifecycle.console !== undefined
      && (typeof resolved.lifecycle.console.authorize !== 'function'
        || resolved.lifecycle.console.persistSubjectExportAudit !== undefined
          && typeof resolved.lifecycle.console.persistSubjectExportAudit !== 'function'))) {
    throw new Error('Workroom Data Governance Root lifecycle capability is invalid');
  }
  return Object.freeze(resolved);
}
