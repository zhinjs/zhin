import { join } from 'node:path';
import type { Scope } from '@zhin.js/plugin-runtime';
import type {
  PayloadVaultCryptographyPort,
} from '../data-governance/encrypted-file-payload-vault.js';
import type {
  DataGovernanceAuthorityVerificationPort,
} from '../data-governance/governance-authority-repository.js';
import type {
  GovernedPayloadPublicationVerifierPort,
  GovernedPayloadWritePurgePort,
} from '../data-governance/governed-payload-write-saga.js';
import {
  workroomAssignmentDisclosureManifestAuthorityToken,
} from './workroom-assignment-authority-grant-runtime.js';
import {
  workroomPlanningDisclosureToken,
} from './workroom-dynamic-planning-provider.js';
import {
  workroomEvidencePayloadWriterToken,
  workroomTaskReportPayloadToken,
} from './workroom-local-agent-loop.js';
import { workroomAcceptanceProjectionPayloadToken } from './workroom-acceptance-fact-providers.js';
import {
  createFileWorkroomDataGovernanceRuntime,
  workroomDisclosureManifestAuthorityToken,
  type WorkroomDataGovernanceRuntime,
  type WorkroomDataGovernancePayloadVaultPort,
  type WorkroomAcceptanceProjectionSourceAuthorityPort,
  type WorkroomEvidenceSourceAuthorityPort,
  type WorkroomPayloadLifecycleIndexPort,
} from './workroom-data-governance-runtime.js';

export interface InstallWorkroomDataGovernanceResourcesOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  /** Trusted Root option only; never published as a Resource/Feature. */
  readonly cryptography?: PayloadVaultCryptographyPort;
  /** Root-private activation latch; never provided as a Resource. */
  readonly vault?: WorkroomDataGovernancePayloadVaultPort;
  readonly payloadLifecycleIndex?: WorkroomPayloadLifecycleIndexPort;
  readonly payloadPurge?: GovernedPayloadWritePurgePort;
  readonly payloadPublicationVerifier?: GovernedPayloadPublicationVerifierPort;
  /** Trusted Root Data Steward/Sponsor decision verifier; never published. */
  readonly governance?: DataGovernanceAuthorityVerificationPort;
  readonly evidenceSources?: WorkroomEvidenceSourceAuthorityPort;
  readonly acceptanceProjectionSources?: WorkroomAcceptanceProjectionSourceAuthorityPort;
  readonly resources: Pick<Scope, 'has' | 'provide'>;
}

/**
 * Standard generation composition. It publishes only governed, narrow ports;
 * raw Vault, crypto and authority writer objects never enter the Resource Scope.
 */
export function installWorkroomDataGovernanceResources(
  options: InstallWorkroomDataGovernanceResourcesOptions,
): WorkroomDataGovernanceRuntime {
  const runtime = createFileWorkroomDataGovernanceRuntime({
    stateRoot: join(options.projectRoot, '.zhin'),
    generation: options.generation,
    signal: options.signal,
    ...(options.cryptography ? { cryptography: options.cryptography } : {}),
    ...(options.vault ? { vault: options.vault } : {}),
    ...(options.payloadLifecycleIndex ? { payloadLifecycleIndex: options.payloadLifecycleIndex } : {}),
    ...(options.payloadPurge ? { payloadPurge: options.payloadPurge } : {}),
    ...(options.payloadPublicationVerifier
      ? { payloadPublicationVerifier: options.payloadPublicationVerifier }
      : {}),
    ...(options.governance ? { governance: options.governance } : {}),
    ...(options.evidenceSources ? { evidenceSources: options.evidenceSources } : {}),
    ...(options.acceptanceProjectionSources
      ? { acceptanceProjectionSources: options.acceptanceProjectionSources }
      : {}),
  });
  provideIfAbsent(options.resources, workroomPlanningDisclosureToken, runtime.planningDisclosure);
  provideIfAbsent(
    options.resources,
    workroomAssignmentDisclosureManifestAuthorityToken,
    runtime.assignmentDisclosure,
  );
  provideIfAbsent(options.resources, workroomEvidencePayloadWriterToken, runtime.evidencePayloads);
  provideIfAbsent(options.resources, workroomTaskReportPayloadToken, runtime.taskReportPayloads);
  provideIfAbsent(
    options.resources,
    workroomAcceptanceProjectionPayloadToken,
    runtime.acceptanceProjectionPayloads,
  );
  provideIfAbsent(
    options.resources,
    workroomDisclosureManifestAuthorityToken,
    runtime.disclosureManifest,
  );
  return runtime;
}

function provideIfAbsent<T>(
  resources: Pick<Scope, 'has' | 'provide'>,
  token: import('@zhin.js/plugin-runtime').Token<T>,
  value: T,
): void {
  if (!resources.has(token)) resources.provide(token, value);
}
