import { createHash } from 'node:crypto';
import {
  classifyDataDescriptor,
  type DataDescriptor,
  type DisclosureApprovalSnapshot,
  type DisclosureContext,
  type DisclosureDecisionInput,
} from '../data-governance/data-governance.js';
import {
  materializeDisclosureManifest,
  type MaterializedDisclosureManifest,
  type GovernedDisclosureManifestRequest,
  type PayloadVaultPort,
  type TrustedDisclosureTransformPort,
} from '../data-governance/disclosure-manifest.js';
import {
  EncryptedFilePayloadVault,
  PayloadVaultCryptographyUnavailableError,
  type PayloadVaultCryptographyPort,
} from '../data-governance/encrypted-file-payload-vault.js';
import {
  FileDataGovernanceAuthorityRepository,
  DataGovernanceAuthorityUnauthorizedError,
  createGovernedSourceAuthority,
  type DataGovernanceAuthorityRepository,
  type DataGovernanceBlockerKind,
  type GovernedSourceAuthority,
  type ProjectDataGovernanceAuthority,
  type DataGovernanceAuthorityVerificationPort,
} from '../data-governance/governance-authority-repository.js';
import {
  FileGovernedPayloadWriteSagaRepository,
  GovernedPayloadPublicationReconciler,
  GovernedPayloadWritePurgeConsumer,
  createGovernedPayloadWriteIntentId,
  type GovernedPayloadPublicationVerifierPort,
  type GovernedPayloadWritePurgePort,
} from '../data-governance/governed-payload-write-saga.js';
import { join } from 'node:path';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  WorkroomPlanningClarificationError,
} from '../workroom/human-ingress-orchestrator.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomAssignmentDisclosureManifestAuthorityPort } from '../workroom/assignment-authority-grant-application.js';
import {
  WorkroomGovernedPayloadHeaderCasLostError,
  WorkroomGovernedPayloadPublicationAbandonedError,
  type WorkroomGovernedPayloadPublicationPort,
  PersistedWorkroomStructuredTaskReport,
  type WorkroomGovernedPayloadReceipt,
  type WorkroomTaskReportPayloadPort,
} from '../workroom/workroom-task-report-store.js';
import {
  createWorkroomJournalPayloadObjectId,
  type WorkroomJournalPayloadPort,
  type WorkroomJournalPayloadReadInput,
  type WorkroomJournalPayloadWriteInput,
} from '../workroom/journal.js';
import type {
  WorkroomEvidencePayloadWriteInput,
  WorkroomEvidencePayloadWriterPort,
} from './workroom-local-agent-loop.js';
import {
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomPlanningDisclosure,
  createWorkroomPlanningDisclosureSourceBinding,
  type WorkroomPlanningDisclosure,
  type WorkroomPlanningDisclosurePort,
  type WorkroomPlanningDisclosureRequest,
} from './workroom-dynamic-planning-provider.js';
import {
  type WorkroomAcceptanceProjectionPayloadPort,
  type WorkroomAcceptanceProjectionPayloadReceipt,
  type WorkroomAcceptanceProjectionSource,
} from './workroom-acceptance-fact-providers.js';
import {
  createWorkroomGovernedAcceptanceProjection,
  type WorkroomGovernedAcceptanceProjection,
} from './workroom-acceptance-provider-composition.js';

export type { GovernedDisclosureManifestRequest } from '../data-governance/disclosure-manifest.js';

/** Common P12 boundary for model, Projection, Evidence and A2A adapters. */
export interface WorkroomDisclosureManifestAuthorityPort {
  materialize(
    request: GovernedDisclosureManifestRequest,
    signal: AbortSignal,
  ): Promise<MaterializedDisclosureManifest | null>;
  revalidate(
    input: GovernedDisclosureRevalidationInput,
    signal: AbortSignal,
  ): Promise<GovernedDisclosureRevalidationResult>;
  prepareProjection(
    input: GovernedProjectionDisclosureInput,
    signal: AbortSignal,
  ): Promise<GovernedProjectionDisclosureResult>;
}

export interface GovernedProjectionDisclosureInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly sinkRuleId: string;
  readonly body: string;
  readonly sourceEventIds: readonly string[];
}

export type GovernedProjectionDisclosureResult =
  | Readonly<{
      status: 'ready';
      request: GovernedDisclosureManifestRequest;
      manifest: MaterializedDisclosureManifest;
    }>
  | Readonly<{ status: 'blocked'; reason: GovernedDisclosureBlockReason }>;

export interface GovernedDisclosureRevalidationInput {
  readonly request: GovernedDisclosureManifestRequest;
  readonly manifest: MaterializedDisclosureManifest;
}

export type GovernedDisclosureBlockReason =
  | DataGovernanceBlockerKind;

export type GovernedDisclosureRevalidationResult =
  | Readonly<{
      status: 'ready';
      manifest: MaterializedDisclosureManifest;
      /** Ephemeral governed body. Callers must not persist, log or echo it. */
      body: Uint8Array;
    }>
  | Readonly<{ status: 'blocked'; reason: GovernedDisclosureBlockReason }>;

export const workroomDisclosureManifestAuthorityToken =
  createToken<WorkroomDisclosureManifestAuthorityPort>(
    'zhin.agent.workroom-disclosure-manifest-authority',
    'Authority-owned exact sink-rule Disclosure Manifest materializer',
  );

export type WorkroomDataGovernancePayloadVaultPort = PayloadVaultPort
  & Pick<EncryptedFilePayloadVault, 'putSource'>
  & Partial<Pick<EncryptedFilePayloadVault, 'resolveLifecycleObject'>>;

export interface WorkroomDataGovernanceRuntimeOptions {
  readonly generation: number;
  readonly repository: DataGovernanceAuthorityRepository;
  readonly vault: WorkroomDataGovernancePayloadVaultPort;
  /** Production composition always supplies the durable content-free saga. */
  readonly payloadWrites?: FileGovernedPayloadWriteSagaRepository;
  readonly payloadPurge?: GovernedPayloadWritePurgeConsumer;
  readonly payloadLifecycleIndex?: WorkroomPayloadLifecycleIndexPort;
  readonly payloadPublicationVerifier?: GovernedPayloadPublicationVerifierPort;
  readonly transforms?: TrustedDisclosureTransformPort;
  readonly evidenceSources?: WorkroomEvidenceSourceAuthorityPort;
  readonly acceptanceProjectionSources?: WorkroomAcceptanceProjectionSourceAuthorityPort;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}

export interface WorkroomPayloadLifecycleIndexPort {
  register(input: Readonly<{
    operationId: string;
    handle: import('../data-governance/disclosure-manifest.js').PayloadVaultObjectHandle;
  }>, signal: AbortSignal): Promise<Readonly<{ digest: string }>>;
}

/** Trusted Root composition helper; raw repository/Vault are intentionally not returned. */
export function createFileWorkroomDataGovernanceRuntime(options: Readonly<{
  stateRoot: string;
  generation: number;
  signal: AbortSignal;
  cryptography?: PayloadVaultCryptographyPort;
  /** Root-private storage latch. Raw Vault capability is never published. */
  vault?: WorkroomDataGovernancePayloadVaultPort;
  governance?: DataGovernanceAuthorityVerificationPort;
  evidenceSources?: WorkroomEvidenceSourceAuthorityPort;
  acceptanceProjectionSources?: WorkroomAcceptanceProjectionSourceAuthorityPort;
  transforms?: TrustedDisclosureTransformPort;
  now?: () => number;
  payloadLifecycleIndex?: WorkroomPayloadLifecycleIndexPort;
  payloadPurge?: GovernedPayloadWritePurgePort;
  payloadPublicationVerifier?: GovernedPayloadPublicationVerifierPort;
}>): WorkroomDataGovernanceRuntime {
  const repository = new FileDataGovernanceAuthorityRepository(
    join(options.stateRoot, 'workroom-data-governance-authority'),
    options.governance,
  );
  const cryptography = options.cryptography ?? Object.freeze<PayloadVaultCryptographyPort>({
    wrap: async () => null,
    unwrap: async () => null,
  });
  const vault = options.vault ?? new EncryptedFilePayloadVault({
    directory: join(options.stateRoot, 'workroom-payload-vault'),
    generation: options.generation,
    cryptography,
  });
  const payloadWrites = new FileGovernedPayloadWriteSagaRepository(
    join(options.stateRoot, 'workroom-payload-write-sagas'),
  );
  const payloadPurge = options.payloadPurge
    ? new GovernedPayloadWritePurgeConsumer({
        generation: options.generation,
        repository: payloadWrites,
        provider: options.payloadPurge,
      })
    : undefined;
  return new WorkroomDataGovernanceRuntime({
    generation: options.generation,
    repository,
    vault,
    payloadWrites,
    ...(payloadPurge ? { payloadPurge } : {}),
    ...(options.payloadPublicationVerifier
      ? { payloadPublicationVerifier: options.payloadPublicationVerifier }
      : {}),
    ...(options.payloadLifecycleIndex ? { payloadLifecycleIndex: options.payloadLifecycleIndex } : {}),
    signal: options.signal,
    ...(options.evidenceSources ? { evidenceSources: options.evidenceSources } : {}),
    ...(options.acceptanceProjectionSources
      ? { acceptanceProjectionSources: options.acceptanceProjectionSources }
      : {}),
    ...(options.transforms ? { transforms: options.transforms } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}

export interface WorkroomEvidenceSourceAuthorityPort {
  resolve(input: Readonly<{
    claimedSource: WorkroomEvidencePayloadWriteInput['claimedSource'];
    attribution: WorkroomEvidencePayloadWriteInput['attribution'];
    payloadHash: string;
  }>): Promise<WorkroomGovernedPayloadReceipt['source'] | null>;
}

export interface WorkroomAcceptanceProjectionSourceAuthorityPort {
  resolve(input: Readonly<{
    projectId: string;
    projectionDigest: string;
    source: WorkroomAcceptanceProjectionSource & Readonly<{ bindingDigest: string }>;
  }>, signal: AbortSignal): Promise<Readonly<{
    kind: 'profile-policy';
    ref: string;
    digest: string;
    issuer: string;
    issuerDigest: string;
    revision: number;
    bindingDigest: string;
    verification: 'verified';
  }> | undefined>;
}

export const workroomAcceptanceProjectionSourceAuthorityToken =
  createToken<WorkroomAcceptanceProjectionSourceAuthorityPort>(
    'zhin.agent.workroom-acceptance-projection-source-authority',
    'Trusted exact Profile-policy source resolver for governed Acceptance projection payloads',
  );

/**
 * One immutable Root-generation adapter over persistent policy/source facts.
 * It never falls back to config or request metadata authority.
 */
export class WorkroomDataGovernanceRuntime {
  readonly generation: number;
  readonly planningDisclosure: WorkroomPlanningDisclosurePort;
  readonly disclosureManifest: WorkroomDisclosureManifestAuthorityPort;
  readonly assignmentDisclosure: WorkroomAssignmentDisclosureManifestAuthorityPort;
  readonly evidencePayloads: WorkroomEvidencePayloadWriterPort;
  readonly taskReportPayloads: WorkroomTaskReportPayloadPort;
  readonly acceptanceProjectionPayloads: WorkroomAcceptanceProjectionPayloadPort;
  readonly journalPayloads: WorkroomJournalPayloadPort;
  readonly #now: () => number;

  constructor(readonly options: WorkroomDataGovernanceRuntimeOptions) {
    this.generation = positive(options.generation, 'generation');
    this.#now = options.now ?? Date.now;
    this.planningDisclosure = Object.freeze({
      materialize: async (request: WorkroomPlanningDisclosureRequest, signal: AbortSignal) =>
        await this.#materializePlanning(request, signal),
    });
    this.disclosureManifest = Object.freeze({
      materialize: async (request: GovernedDisclosureManifestRequest, signal: AbortSignal) =>
        await this.#materializeRegistered(request, signal),
      revalidate: async (input: GovernedDisclosureRevalidationInput, signal: AbortSignal) =>
        await this.#revalidateRegistered(input, signal),
      prepareProjection: async (input: GovernedProjectionDisclosureInput, signal: AbortSignal) =>
        await this.#prepareProjection(input, signal),
    });
    this.assignmentDisclosure = Object.freeze({
      materialize: async (
        request: Parameters<WorkroomAssignmentDisclosureManifestAuthorityPort['materialize']>[0],
      ) => await this.#materializeAssignment(request),
    });
    this.evidencePayloads = Object.freeze({
      write: async (input: WorkroomEvidencePayloadWriteInput, signal: AbortSignal) =>
        await this.#writeEvidence(input, signal),
    });
    this.taskReportPayloads = Object.freeze({
      write: async (
        input: Parameters<WorkroomTaskReportPayloadPort['write']>[0],
        signal: AbortSignal,
      ) => await this.#writeTaskReport(input, signal),
      read: async (
        input: Parameters<WorkroomTaskReportPayloadPort['read']>[0],
        signal: AbortSignal,
      ) => await this.#readTaskReport(input, signal),
    });
    this.acceptanceProjectionPayloads = Object.freeze({
      write: async (
        input: Parameters<WorkroomAcceptanceProjectionPayloadPort['write']>[0],
        signal: AbortSignal,
      ) => await this.#writeAcceptanceProjection(input, signal),
      read: async (
        input: Parameters<WorkroomAcceptanceProjectionPayloadPort['read']>[0],
        signal: AbortSignal,
      ) => await this.#readAcceptanceProjection(input, signal),
    });
    this.journalPayloads = Object.freeze({
      write: async (input: WorkroomJournalPayloadWriteInput) =>
        await this.#writeJournalPayload(input),
      read: async (input: WorkroomJournalPayloadReadInput) =>
        await this.#readJournalPayload(input),
      publish: async (
        input: Parameters<NonNullable<WorkroomJournalPayloadPort['publish']>>[0],
      ) => await this.#publishJournalPayloads(input),
      prepare: async (
        input: Parameters<NonNullable<WorkroomJournalPayloadPort['prepare']>>[0],
      ) => await this.#prepareJournalPayloads(input),
      abandon: async (
        input: Parameters<NonNullable<WorkroomJournalPayloadPort['abandon']>>[0],
      ) => await this.#abandonJournalPayloads(input),
      reconcile: async (
        input: Parameters<NonNullable<WorkroomJournalPayloadPort['reconcile']>>[0],
      ) => await this.#reconcileJournalPayloads(input),
    });
  }

  /** Trusted generation handoff hook; no raw Vault or receipt body is returned. */
  async reconcilePayloadPurges(
    projectIds: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.payloadPurge || !this.options.payloadWrites) return;
    const publications = new GovernedPayloadPublicationReconciler({
      repository: this.options.payloadWrites,
      purge: this.options.payloadPurge,
      ...(this.options.payloadPublicationVerifier
        ? { verifier: this.options.payloadPublicationVerifier }
        : {}),
    });
    for (const projectId of [...new Set(projectIds)].sort()) {
      await publications.drainProject(projectId, signal);
      await this.options.payloadPurge.drainProject(projectId, signal);
    }
  }

  async #writeJournalPayload(
    input: WorkroomJournalPayloadWriteInput,
  ): Promise<WorkroomGovernedPayloadReceipt> {
    const operationId = `workroom-journal-write:${input.eventId}:${digest(input.fieldPath)}`;
    await this.#requirePayloadInfrastructure(this.options.signal, {
      operationId,
      projectId: input.projectId,
    });
    const payload = new TextEncoder().encode(canonicalWorkroomJson(input.value));
    if (hashBytes(payload) !== input.contentHash) {
      throw new Error('Governed Workroom Journal payload content hash drift');
    }
    const source = deepFreeze<WorkroomGovernedPayloadReceipt['source']>({
      kind: 'command',
      ref: input.source.ref,
      digest: input.source.digest,
      bindingDigest: input.source.bindingDigest,
      verification: 'verified',
    });
    return await this.#writeDerivedPayload({
      operationId,
      projectId: input.projectId,
      kind: 'journal',
      objectId: createWorkroomJournalPayloadObjectId(input),
      payload,
      source,
      signal: this.options.signal,
      publicationScope: input.runId,
    });
  }

  async #publishJournalPayloads(
    input: Parameters<NonNullable<WorkroomJournalPayloadPort['publish']>>[0],
  ): Promise<void> {
    if (!this.options.payloadWrites) return;
    for (const receipt of input.receipts) {
      await this.options.payloadWrites.publish(journalIntentId(input.projectId, input.runId, receipt), input.publicationDigest);
    }
  }

  async #prepareJournalPayloads(
    input: Parameters<NonNullable<WorkroomJournalPayloadPort['prepare']>>[0],
  ): Promise<void> {
    if (!this.options.payloadWrites) return;
    const candidates = new Set(input.receipts.map(receipt =>
      journalIntentId(input.projectId, input.runId, receipt)));
    for (const pending of await this.options.payloadWrites.listUnpublished(input.projectId, input.runId)) {
      if (!candidates.has(pending.intentId)) {
        await this.options.payloadWrites.requirePurge(pending.intentId, 'restart_unpublished');
        await this.#purgeIntent(pending.intentId);
      }
    }
  }

  async #abandonJournalPayloads(
    input: Parameters<NonNullable<WorkroomJournalPayloadPort['abandon']>>[0],
  ): Promise<void> {
    if (!this.options.payloadWrites) return;
    for (const receipt of input.receipts) {
      await this.options.payloadWrites.requirePurge(
        journalIntentId(input.projectId, input.runId, receipt),
        input.reason,
      );
      await this.#purgeIntent(journalIntentId(input.projectId, input.runId, receipt));
    }
  }

  async #reconcileJournalPayloads(
    input: Parameters<NonNullable<WorkroomJournalPayloadPort['reconcile']>>[0],
  ): Promise<void> {
    if (!this.options.payloadWrites) return;
    const published = new Set(input.receipts.map(receipt =>
      journalIntentId(input.projectId, input.runId, receipt)));
    for (const pending of await this.options.payloadWrites.listUnpublished(input.projectId, input.runId)) {
      if (published.has(pending.intentId)) {
        await this.options.payloadWrites.publish(pending.intentId, input.publicationDigest);
      } else {
        await this.options.payloadWrites.requirePurge(pending.intentId, 'restart_unpublished');
        await this.#purgeIntent(pending.intentId);
      }
    }
  }

  async #readJournalPayload(input: WorkroomJournalPayloadReadInput): Promise<unknown> {
    await this.#requirePayloadInfrastructure(this.options.signal, {
      operationId: `workroom-journal-read:${input.eventId}:${digest(input.fieldPath)}`,
      projectId: input.projectId,
    });
    const authority = await this.options.repository.readProject(input.projectId);
    const sinkRuleId = 'workroom-journal:kernel-replay';
    const sink = authority?.sinks[sinkRuleId];
    if (!authority || !sink?.fixedPrincipalId) {
      throw new Error('Workroom Journal replay disclosure authority is unavailable');
    }
    const manifest = await this.disclosureManifest.materialize({
      operationId: `workroom-journal-read:${input.eventId}:${digest(input.fieldPath)}`,
      projectId: input.projectId,
      sourceRef: input.receipt.descriptor.objectId,
      sourceDigest: input.receipt.descriptor.payloadHash,
      sinkRuleId,
      principalId: sink.fixedPrincipalId,
    }, this.options.signal);
    if (!manifest || manifest.output.mode !== 'full'
      || manifest.output.handle.vaultObjectId !== input.receipt.descriptor.vaultObjectId
      || manifest.output.handle.descriptorDigest !== input.receipt.descriptor.descriptorDigest
      || manifest.output.handle.locationManifestDigest !== input.receipt.descriptor.locationManifestDigest
      || manifest.output.payloadHash !== input.contentHash) {
      throw new Error('Workroom Journal replay disclosure is not exact/full');
    }
    await this.#requirePayloadInfrastructure(this.options.signal);
    const payload = await this.options.vault.readExact({
      handle: manifest.output.handle,
      requestDigest: manifest.requestDigest,
      purpose: manifest.purpose,
      principalId: manifest.principal.principalId,
      destinationId: manifest.destination.id,
    }, this.options.signal);
    if (hashBytes(payload) !== input.contentHash) {
      throw new Error('Governed Workroom Journal payload content hash mismatch');
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown;
    } catch (error) {
      throw new Error('Governed Workroom Journal payload is not canonical JSON', { cause: error });
    }
  }

  async #writeEvidence(
    input: WorkroomEvidencePayloadWriteInput,
    signal: AbortSignal,
  ): Promise<WorkroomGovernedPayloadReceipt> {
    const operationId = `evidence:${input.attribution.assignmentId}:${input.attribution.attempt}:${input.attribution.fence}`;
    await this.#requirePayloadInfrastructure(signal, {
      operationId,
      projectId: input.attribution.projectId,
    });
    const payload = new TextEncoder().encode(input.content);
    const payloadHash = hashBytes(payload);
    const trusted = await this.options.evidenceSources?.resolve({
      claimedSource: structuredClone(input.claimedSource),
      attribution: structuredClone(input.attribution),
      payloadHash,
    }) ?? null;
    const source = trusted
      ? validateReceiptSource(trusted)
      : deepFreeze<WorkroomGovernedPayloadReceipt['source']>({
        kind: input.claimedSource.kind,
        ref: `quarantine:workroom-evidence:${digest({
          attribution: input.attribution,
          mediaType: input.mediaType,
          payloadHash,
        })}`,
        digest: digest({ version: 1, disposition: 'unverified', payloadHash }),
        bindingDigest: digest({ version: 1, attribution: input.attribution, payloadHash }),
        verification: 'unverified',
      });
    return await this.#writeDerivedPayload({
      operationId,
      projectId: input.attribution.projectId,
      kind: 'evidence',
      objectId: `workroom-evidence-payload:${digest({
        attribution: input.attribution,
        mediaType: input.mediaType,
        payloadHash,
      })}`,
      payload,
      source,
      signal,
      consumer: 'evidence_header',
      publicationScope: digest({
        version: 1,
        attribution: input.attribution,
        payloadHash,
      }),
      publication: input.publication,
    });
  }

  async #writeTaskReport(
    input: Parameters<WorkroomTaskReportPayloadPort['write']>[0],
    signal: AbortSignal,
  ): Promise<WorkroomGovernedPayloadReceipt> {
    const operationId = `task-report:${input.report.candidateHash}`;
    await this.#requirePayloadInfrastructure(signal, {
      operationId,
      projectId: input.attribution.projectId,
    });
    const payload = new TextEncoder().encode(canonicalWorkroomJson(input.report));
    const payloadHash = hashBytes(payload);
    const source = deepFreeze<WorkroomGovernedPayloadReceipt['source']>({
      kind: 'tool',
      ref: `workroom-task:${encodeURIComponent(input.attribution.projectId)}:`
        + `${encodeURIComponent(input.attribution.runId)}:${encodeURIComponent(input.attribution.taskKey)}:`
        + input.attribution.taskRevision,
      digest: digest({ version: 1, reportRef: input.report.ref, candidateHash: input.report.candidateHash }),
      bindingDigest: digest({ version: 1, attribution: input.attribution, reportDigest: input.report.digest }),
      verification: 'verified',
    });
    return await this.#writeDerivedPayload({
      operationId,
      projectId: input.attribution.projectId,
      kind: 'taskReport',
      objectId: `workroom-task-report-payload:${input.report.candidateHash}`,
      payload,
      source,
      signal,
      consumer: 'task_report_header',
      publicationScope: input.report.ref,
      publication: input.publication,
    });
  }

  async #writeAcceptanceProjection(
    input: Parameters<WorkroomAcceptanceProjectionPayloadPort['write']>[0],
    signal: AbortSignal,
  ): Promise<WorkroomAcceptanceProjectionPayloadReceipt> {
    const linked = linkSignals(this.options.signal, signal);
    try {
      linked.signal.throwIfAborted();
      const projection = createWorkroomGovernedAcceptanceProjection(input.projection);
      if (canonicalWorkroomJson(projection) !== canonicalWorkroomJson(input.projection)
        || projection.projectId !== input.projectId) {
        throw new Error('Acceptance projection governed payload candidate drift');
      }
      const trusted = await this.options.acceptanceProjectionSources?.resolve({
        projectId: input.projectId,
        projectionDigest: projection.digest,
        source: structuredClone(input.source),
      }, linked.signal);
      linked.signal.throwIfAborted();
      if (!trusted || trusted.kind !== 'profile-policy' || trusted.verification !== 'verified'
        || trusted.ref !== input.source.ref || trusted.digest !== input.source.digest
        || trusted.issuer !== input.source.issuer || trusted.issuerDigest !== input.source.issuerDigest
        || trusted.revision !== input.source.revision
        || trusted.bindingDigest !== input.source.bindingDigest) {
        throw new Error('Trusted Acceptance projection Profile-policy source is unavailable');
      }
      const { digest: _projectionDigest, ...projectionInput } = projection;
      const payload = new TextEncoder().encode(canonicalWorkroomJson(projectionInput));
      if (hashBytes(payload) !== projection.digest) {
        throw new Error('Acceptance projection canonical payload hash drift');
      }
      const receipt = await this.#writeDerivedPayload({
        operationId: input.operationId,
        projectId: input.projectId,
        kind: 'acceptanceProjection',
        objectId: `workroom-acceptance-projection:${projection.digest.slice('sha256:'.length)}`,
        payload,
        source: deepFreeze(structuredClone(trusted)),
        signal: linked.signal,
      });
      return deepFreeze({
        vaultObjectId: receipt.descriptor.vaultObjectId,
        objectId: receipt.descriptor.objectId,
        payloadHash: receipt.descriptor.payloadHash,
        descriptorDigest: receipt.descriptor.descriptorDigest,
        locationManifestDigest: receipt.descriptor.locationManifestDigest,
        source: receipt.source,
        sourceBindingDigest: receipt.source.bindingDigest,
        bytes: receipt.descriptor.bytes,
      });
    } finally {
      linked.dispose();
    }
  }

  async #readAcceptanceProjection(
    input: Parameters<WorkroomAcceptanceProjectionPayloadPort['read']>[0],
    signal: AbortSignal,
  ): Promise<WorkroomGovernedAcceptanceProjection | undefined> {
    const linked = linkSignals(this.options.signal, signal);
    try {
      linked.signal.throwIfAborted();
      if (input.purpose !== 'acceptance-policy') {
        throw new Error('Acceptance projection disclosure purpose is invalid');
      }
      assertAcceptanceProjectionReceipt(input.receipt);
      const trusted = await this.options.acceptanceProjectionSources?.resolve({
        projectId: input.projectId,
        projectionDigest: input.receipt.payloadHash,
        source: {
          kind: input.receipt.source.kind,
          ref: input.receipt.source.ref,
          digest: input.receipt.source.digest,
          issuer: input.receipt.source.issuer,
          issuerDigest: input.receipt.source.issuerDigest,
          revision: input.receipt.source.revision,
          bindingDigest: input.receipt.source.bindingDigest,
        },
      }, linked.signal);
      linked.signal.throwIfAborted();
      if (!trusted || canonicalWorkroomJson(trusted) !== canonicalWorkroomJson(input.receipt.source)) {
        return undefined;
      }
      const authority = await this.options.repository.readProject(input.projectId);
      const sinkRuleId = 'acceptance-projection:acceptance-policy';
      const sink = authority?.sinks[sinkRuleId];
      if (!authority || !sink?.fixedPrincipalId) return undefined;
      const manifest = await this.disclosureManifest.materialize({
        operationId: input.operationId,
        projectId: input.projectId,
        sourceRef: input.receipt.objectId,
        sourceDigest: input.receipt.payloadHash,
        sinkRuleId,
        principalId: sink.fixedPrincipalId,
      }, linked.signal);
      if (!manifest || manifest.output.mode !== 'full'
        || manifest.output.handle.vaultObjectId !== input.receipt.vaultObjectId
        || manifest.output.handle.descriptorDigest !== input.receipt.descriptorDigest
        || manifest.output.handle.locationManifestDigest !== input.receipt.locationManifestDigest
        || manifest.output.payloadHash !== input.receipt.payloadHash) return undefined;
      await this.#requirePayloadInfrastructure(linked.signal);
      const payload = await this.options.vault.readExact({
        handle: manifest.output.handle,
        requestDigest: manifest.requestDigest,
        purpose: manifest.purpose,
        principalId: manifest.principal.principalId,
        destinationId: manifest.destination.id,
      }, linked.signal);
      let candidate: unknown;
      try {
        candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
      } catch (error) {
        throw new Error('Acceptance projection governed payload is malformed', { cause: error });
      }
      if (!isAcceptanceProjectionInput(candidate)) {
        throw new Error('Acceptance projection governed payload is malformed');
      }
      const projection = createWorkroomGovernedAcceptanceProjection(candidate);
      if (projection.digest !== input.receipt.payloadHash || projection.projectId !== input.projectId) {
        throw new Error('Acceptance projection governed payload binding drift');
      }
      return projection;
    } finally {
      linked.dispose();
    }
  }

  async #writeDerivedPayload<TSource extends Readonly<{
    kind: string;
    ref: string;
    digest: string;
    bindingDigest: string;
    verification: 'verified' | 'unverified';
  }>>(input: Readonly<{
    operationId: string;
    projectId: string;
    kind: 'evidence' | 'taskReport' | 'projection' | 'acceptanceProjection' | 'journal';
    objectId: string;
    payload: Uint8Array;
    source: TSource;
    signal: AbortSignal;
    consumer?: 'authority_source' | 'evidence_header' | 'task_report_header' | 'journal_header';
    publicationScope?: string;
    publication?: WorkroomGovernedPayloadPublicationPort;
  }>): Promise<Readonly<{
    descriptor: WorkroomGovernedPayloadReceipt['descriptor'];
    source: TSource;
  }>> {
    const linked = linkSignals(this.options.signal, input.signal);
    let intentId: string | undefined;
    let authorityIndexed = false;
    let publicationStarted = false;
    let publicationConfirmed = false;
    try {
      const infrastructure = await this.#requirePayloadInfrastructure(linked.signal);
      const authority = await this.options.repository.readProject(input.projectId);
      if (!authority) throw new Error('Data Governance Project authority is unavailable');
      const rule = authority.derivedPayloads[input.kind];
      if (!rule) throw new Error(`Governed ${input.kind} payload authority is unavailable`);
      const createdAt = this.#now();
      const classified = classifyDataDescriptor({
        objectId: input.objectId,
        payloadHash: hashBytes(input.payload),
        tenantId: authority.tenantId,
        projectId: authority.projectId,
        kind: input.kind === 'evidence'
          ? 'evidence'
          : input.kind === 'taskReport'
            ? 'task_report'
            : input.kind === 'acceptanceProjection' || input.kind === 'journal'
              ? 'workroom_fact'
              : 'projection_payload',
        proposedConfidentiality: rule.proposedConfidentiality,
        categories: rule.categories,
        allowedPurposes: rule.allowedPurposes,
        allowedRegions: rule.allowedRegions,
        subjectRefs: [],
        retention: {
          class: rule.retentionClass,
          minimumRetainUntil: safeAdd(createdAt, rule.minimumRetentionMs),
          deleteAfter: safeAdd(createdAt, rule.maximumRetentionMs),
        },
        lineage: { sourceObjectIds: [input.source.ref] },
      }, authority.categoryRegistry);
      if (classified.status === 'quarantined') {
        await this.#block(input.operationId, input.projectId, 'source_classification_quarantined');
        throw new Error(`Governed ${input.kind} payload classification is quarantined`);
      }
      const descriptor = classified.descriptor;
      const descriptorDigest = digest(descriptor);
      let intent = await infrastructure.payloadWrites.begin({
        operationId: input.operationId,
        projectId: input.projectId,
        objectId: descriptor.objectId,
        payloadHash: descriptor.payloadHash,
        descriptorDigest,
        sourceBindingDigest: input.source.bindingDigest,
        consumer: input.consumer ?? (input.kind === 'journal' ? 'journal_header' : 'authority_source'),
        ...(input.publicationScope ? { publicationScope: input.publicationScope } : {}),
      });
      intentId = intent.intentId;
      if (intent.state === 'purge_required') {
        throw new Error('Governed Payload write was abandoned and cannot be republished');
      }
      let handle = intent.handle;
      if (!handle) {
        handle = await this.options.vault.putSource({
          descriptor,
          descriptorDigest,
          payload: input.payload,
          sourceBindingDigest: input.source.bindingDigest,
        }, linked.signal);
        intent = await infrastructure.payloadWrites.recordVault(intentId, handle);
      }
      if (intent.state === 'vault_written') {
        const lifecycleIndex = await infrastructure.payloadLifecycleIndex.register({
          operationId: input.operationId,
          handle,
        }, linked.signal);
        const sourceAuthority = createGovernedSourceAuthority({
          version: 1,
          projectId: authority.projectId,
          sourceRef: descriptor.objectId,
          sourceDigest: descriptor.payloadHash,
          sourceBindingDigest: input.source.bindingDigest,
          descriptor,
          handle,
          projectAuthorityRevision: authority.revision,
          projectAuthorityDigest: authority.digest,
        });
        const persistedSource = await this.options.repository.appendSource(sourceAuthority);
        if (canonicalWorkroomJson(persistedSource) !== canonicalWorkroomJson(sourceAuthority)) {
          throw new Error('Governed Payload source authority CAS winner drift');
        }
        intent = await infrastructure.payloadWrites.recordAuthorityIndex(intentId, digest({
          sourceAuthorityDigest: sourceAuthority.digest,
          lifecycleIndexDigest: lifecycleIndex.digest,
        }));
      }
      authorityIndexed = intent.state === 'authority_indexed' || intent.state === 'published';
      const receipt = deepFreeze({
        descriptor: {
          vaultObjectId: handle.vaultObjectId,
          objectId: handle.objectId,
          payloadHash: handle.payloadHash,
          descriptorDigest: handle.descriptorDigest,
          locationManifestDigest: handle.locationManifestDigest,
          bytes: input.payload.byteLength,
        },
        source: structuredClone(input.source),
      });
      if (input.publication && intent.state !== 'published') {
        publicationStarted = true;
        const publicationReceipt: WorkroomGovernedPayloadReceipt = deepFreeze({
          descriptor: receipt.descriptor,
          source: validatePublicationReceiptSource(input.source),
        });
        const publication = await input.publication.publish(publicationReceipt, linked.signal);
        publicationConfirmed = true;
        await infrastructure.payloadWrites.publish(
          intentId,
          exactDigest(publication.publicationDigest, 'payload publicationDigest'),
        );
      }
      return receipt;
    } catch (error) {
      if (intentId) {
        const snapshot = await this.options.payloadWrites?.read(intentId);
        const definiteAbandon = !authorityIndexed
          || error instanceof WorkroomGovernedPayloadHeaderCasLostError
          || error instanceof WorkroomGovernedPayloadPublicationAbandonedError;
        if (snapshot && snapshot.state !== 'published' && definiteAbandon
          && !(publicationStarted && publicationConfirmed)) {
          if (snapshot.state !== 'purge_required') {
            await this.options.payloadWrites?.requirePurge(
              intentId,
              error instanceof WorkroomGovernedPayloadHeaderCasLostError
                ? 'cas_lost'
                : 'write_failed',
            );
          }
          await this.#purgeIntent(intentId);
        }
      }
      if (linked.signal.aborted) {
        throw linked.signal.reason ?? new DOMException('Governed payload write cancelled', 'AbortError');
      }
      await this.#block(input.operationId, input.projectId, blockerKind(error));
      throw error;
    } finally {
      linked.dispose();
    }
  }

  async #purgeIntent(intentId: string): Promise<void> {
    if (!this.options.payloadPurge) return;
    await this.options.payloadPurge.processIntent(intentId, this.options.signal);
  }

  async #requirePayloadInfrastructure(
    signal: AbortSignal,
    blocker?: Readonly<{ operationId: string; projectId: string }>,
  ): Promise<Readonly<{
    payloadWrites: FileGovernedPayloadWriteSagaRepository;
    payloadLifecycleIndex: WorkroomPayloadLifecycleIndexPort;
    payloadPurge: GovernedPayloadWritePurgeConsumer;
  }>> {
    signal.throwIfAborted();
    const payloadWrites = this.options.payloadWrites;
    const payloadLifecycleIndex = this.options.payloadLifecycleIndex;
    const payloadPurge = this.options.payloadPurge;
    const rejectUnavailable = async (unavailable: Error): Promise<never> => {
      if (blocker) {
        await this.#block(blocker.operationId, blocker.projectId, blockerKind(unavailable));
      }
      throw unavailable;
    };
    if (!payloadWrites) {
      return await rejectUnavailable(new Error('Governed Payload durable write saga authority is unavailable'));
    }
    if (!payloadLifecycleIndex) {
      return await rejectUnavailable(new Error('Governed Payload Lifecycle index authority is unavailable'));
    }
    if (!payloadPurge) {
      return await rejectUnavailable(new Error('Governed Payload orphan purge authority is unavailable'));
    }
    await payloadWrites.assertReady();
    signal.throwIfAborted();
    return Object.freeze({
      payloadWrites,
      payloadLifecycleIndex,
      payloadPurge,
    });
  }

  async #readTaskReport(
    input: Parameters<WorkroomTaskReportPayloadPort['read']>[0],
    signal: AbortSignal,
  ): Promise<PersistedWorkroomStructuredTaskReport> {
    await this.#requirePayloadInfrastructure(signal, {
      operationId: `accepted-source-read:${input.candidateHash}`,
      projectId: input.projectId,
    });
    const authority = await this.options.repository.readProject(input.projectId);
    const sinkRuleId = 'task-report:accepted-source-memory-projector';
    const sink = authority?.sinks[sinkRuleId];
    if (!authority || !sink?.fixedPrincipalId) {
      throw new Error('Accepted-source Task Report disclosure authority is unavailable');
    }
    const manifest = await this.disclosureManifest.materialize({
      operationId: `accepted-source-read:${input.candidateHash}`,
      projectId: input.projectId,
      sourceRef: input.receipt.descriptor.objectId,
      sourceDigest: input.receipt.descriptor.payloadHash,
      sinkRuleId,
      principalId: sink.fixedPrincipalId,
    }, signal);
    if (!manifest || manifest.output.mode !== 'full'
      || manifest.output.handle.vaultObjectId !== input.receipt.descriptor.vaultObjectId
      || manifest.output.handle.descriptorDigest !== input.receipt.descriptor.descriptorDigest
      || manifest.output.payloadHash !== input.receipt.descriptor.payloadHash) {
      throw new Error('Accepted-source Task Report disclosure is not exact/full');
    }
    const payload = await this.options.vault.readExact({
      handle: manifest.output.handle,
      requestDigest: manifest.requestDigest,
      purpose: manifest.purpose,
      principalId: manifest.principal.principalId,
      destinationId: manifest.destination.id,
    }, signal);
    let report: unknown;
    try {
      report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    } catch (error) {
      throw new Error('Governed Task Report payload is not canonical JSON', { cause: error });
    }
    if (!report || typeof report !== 'object'
      || (report as PersistedWorkroomStructuredTaskReport).projectId !== input.projectId
      || (report as PersistedWorkroomStructuredTaskReport).runId !== input.runId
      || (report as PersistedWorkroomStructuredTaskReport).taskKey !== input.taskKey
      || (report as PersistedWorkroomStructuredTaskReport).ref !== input.reportRef
      || (report as PersistedWorkroomStructuredTaskReport).candidateHash !== input.candidateHash) {
      throw new Error('Governed Task Report payload escaped accepted-source scope');
    }
    return deepFreeze(report as PersistedWorkroomStructuredTaskReport);
  }

  async #materializePlanning(
    request: WorkroomPlanningDisclosureRequest,
    operationSignal: AbortSignal,
  ): Promise<WorkroomPlanningDisclosure> {
    const linked = linkSignals(this.options.signal, operationSignal);
    const binding = createWorkroomPlanningDisclosureSourceBinding(request.input.source);
    try {
      this.#assertGeneration(request);
      if (canonicalWorkroomJson(binding) !== canonicalWorkroomJson(request.source)) {
        throw new Error('Planning disclosure source binding drift');
      }
      const authority = await this.options.repository.readProject(request.input.projectId);
      if (!authority) {
        await this.#block(request.input.operationId, request.input.projectId,
          'project_authority_unavailable', binding.digest);
        throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
      }
      const source = await this.#resolvePlanningSource(request, authority, binding.digest, linked.signal);
      const manifest = await this.#materialize({
        operationId: request.input.operationId,
        authority,
        source,
        context: {
          channel: 'model_provider',
          purpose: 'orchestration',
          requestedMode: authority.planning.source.requestedMode,
          policyRevision: authority.policy.revision,
          principal: {
            principalId: request.input.principalId,
            tenantId: authority.tenantId,
            projectId: authority.projectId,
            ...authority.planning.principal,
          },
          destination: authority.policy.destinations[authority.planning.destinationId]!,
          recipients: authority.planning.recipients,
        },
        signal: linked.signal,
      });
      await this.#requirePayloadInfrastructure(linked.signal);
      const payload = await this.options.vault.readExact(deepFreeze({
        handle: structuredClone(manifest.output.handle),
        requestDigest: manifest.requestDigest,
        purpose: manifest.purpose,
        principalId: manifest.principal.principalId,
        destinationId: manifest.destination.id,
      }), linked.signal);
      if (hashBytes(payload) !== manifest.output.payloadHash) {
        throw new Error('Planning disclosure output body hash mismatch');
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      } catch (error) {
        throw new Error('Planning disclosure output is not valid UTF-8', { cause: error });
      }
      return createWorkroomPlanningDisclosure({ source: request.source, manifest, text });
    } catch (error) {
      if (error instanceof WorkroomPlanningClarificationError) throw error;
      const kind = blockerKind(error);
      await this.#block(request.input.operationId, request.input.projectId, kind, binding.digest);
      if (linked.signal.aborted) {
        throw linked.signal.reason ?? new DOMException('Data Governance planning cancelled', 'AbortError');
      }
      throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
    } finally {
      linked.dispose();
    }
  }

  async #resolvePlanningSource(
    request: WorkroomPlanningDisclosureRequest,
    authority: ProjectDataGovernanceAuthority,
    sourceBindingDigest: string,
    signal: AbortSignal,
  ): Promise<GovernedSourceAuthority> {
    const existing = await this.options.repository.readSource(
      request.input.projectId,
      request.input.source.ref,
      request.input.source.digest,
    );
    if (existing) {
      if (existing.sourceBindingDigest !== sourceBindingDigest
        || existing.projectAuthorityDigest !== authority.digest
        || existing.projectAuthorityRevision !== authority.revision) {
        throw new Error('Governed source authority is stale for current policy');
      }
      return existing;
    }
    await this.#requirePayloadInfrastructure(signal);
    const payload = new TextEncoder().encode(request.input.source.text);
    const payloadHash = hashBytes(payload);
    const timestamp = nonNegative(request.input.source.event.timestamp, 'source timestamp');
    const rule = authority.planning.source;
    const classified = classifyDataDescriptor({
      objectId: `workroom-source:${request.input.source.digest}`,
      payloadHash,
      tenantId: authority.tenantId,
      projectId: authority.projectId,
      kind: 'source_message',
      proposedConfidentiality: rule.proposedConfidentiality,
      categories: rule.categories,
      allowedPurposes: rule.allowedPurposes,
      allowedRegions: rule.allowedRegions,
      subjectRefs: rule.linkPrincipalAsSubject ? [request.input.principalId] : [],
      retention: {
        class: rule.retentionClass,
        minimumRetainUntil: safeAdd(timestamp, rule.minimumRetentionMs),
        deleteAfter: safeAdd(timestamp, rule.maximumRetentionMs),
      },
      lineage: { sourceObjectIds: [request.input.source.ref] },
    }, authority.categoryRegistry);
    if (classified.status === 'quarantined') {
      throw new Error(`Source classification quarantined: ${classified.reasonCodes.join(',')}`);
    }
    const descriptor = classified.descriptor;
    const handle = await this.options.vault.putSource({
      descriptor,
      descriptorDigest: digest(descriptor),
      payload,
      sourceBindingDigest,
    }, signal);
    return await this.options.repository.appendSource(createGovernedSourceAuthority({
      version: 1,
      projectId: authority.projectId,
      sourceRef: request.input.source.ref,
      sourceDigest: request.input.source.digest,
      sourceBindingDigest,
      descriptor,
      handle,
      projectAuthorityRevision: authority.revision,
      projectAuthorityDigest: authority.digest,
    }));
  }

  async #materializeRegistered(
    request: GovernedDisclosureManifestRequest,
    operationSignal: AbortSignal,
  ): Promise<MaterializedDisclosureManifest | null> {
    const linked = linkSignals(this.options.signal, operationSignal);
    try {
      const authority = await this.options.repository.readProject(request.projectId);
      if (!authority) {
        await this.#block(request.operationId, request.projectId, 'project_authority_unavailable');
        return null;
      }
      const source = await this.options.repository.readSource(
        request.projectId,
        request.sourceRef,
        request.sourceDigest,
      );
      if (!source || source.projectAuthorityDigest !== authority.digest) {
        await this.#block(request.operationId, request.projectId, 'source_authority_conflict', undefined,
          authority.digest);
        return null;
      }
      const rule = authority.sinks[request.sinkRuleId];
      const destination = rule && authority.policy.destinations[rule.destinationId];
      if (!rule || !destination
        || (rule.fixedPrincipalId !== undefined && request.principalId !== rule.fixedPrincipalId)) {
        await this.#block(request.operationId, request.projectId, 'disclosure_denied',
          source.sourceBindingDigest, authority.digest);
        return null;
      }
      return await this.#materialize({
        operationId: request.operationId,
        authority,
        source,
        context: {
          channel: rule.channel,
          purpose: rule.purpose,
          requestedMode: rule.requestedMode,
          policyRevision: authority.policy.revision,
          principal: {
            principalId: request.principalId,
            ...(request.assignmentId === undefined ? {} : { assignmentId: request.assignmentId }),
            tenantId: authority.tenantId,
            projectId: authority.projectId,
            ...rule.principal,
          },
          destination,
          recipients: structuredClone(rule.recipients),
        },
        signal: linked.signal,
      });
    } catch (error) {
      await this.#block(request.operationId, request.projectId, blockerKind(error));
      if (linked.signal.aborted) {
        throw linked.signal.reason ?? new DOMException('Data Governance operation cancelled', 'AbortError');
      }
      return null;
    } finally {
      linked.dispose();
    }
  }

  async #prepareProjection(
    input: GovernedProjectionDisclosureInput,
    operationSignal: AbortSignal,
  ): Promise<GovernedProjectionDisclosureResult> {
    const linked = linkSignals(this.options.signal, operationSignal);
    try {
      const authority = await this.options.repository.readProject(input.projectId);
      const sink = authority?.sinks[input.sinkRuleId];
      const expectedChannel = input.sinkRuleId === 'projection:sponsor-room'
        ? 'sponsor_projection'
        : 'workroom_projection';
      if (!authority || !sink || sink.channel !== expectedChannel || !sink.fixedPrincipalId
        || !authority.derivedPayloads.projection) {
        const reason = authority ? 'disclosure_denied' : 'project_authority_unavailable';
        await this.#block(input.operationId, input.projectId, reason, undefined, authority?.digest);
        return deepFreeze({ status: 'blocked', reason });
      }
      if (input.sourceEventIds.length === 0 || input.sourceEventIds.some(value => !value.trim())) {
        await this.#block(input.operationId, input.projectId, 'source_authority_conflict',
          undefined, authority.digest);
        return deepFreeze({ status: 'blocked', reason: 'source_authority_conflict' });
      }
      const payload = new TextEncoder().encode(input.body);
      const payloadHash = hashBytes(payload);
      const source = deepFreeze<WorkroomGovernedPayloadReceipt['source']>({
        kind: 'tool',
        ref: `workroom-projection-events:${digest({
          projectId: input.projectId,
          sourceEventIds: input.sourceEventIds,
        })}`,
        digest: digest({ version: 1, sourceEventIds: input.sourceEventIds }),
        bindingDigest: digest({
          version: 1, projectId: input.projectId, sourceEventIds: input.sourceEventIds, payloadHash,
        }),
        verification: 'verified',
      });
      const receipt = await this.#writeDerivedPayload({
        operationId: input.operationId,
        projectId: input.projectId,
        kind: 'projection',
        objectId: `workroom-projection-payload:${digest({
          projectId: input.projectId, sourceEventIds: input.sourceEventIds, payloadHash,
        })}`,
        payload,
        source,
        signal: linked.signal,
      });
      const request = deepFreeze<GovernedDisclosureManifestRequest>({
        operationId: input.operationId,
        projectId: input.projectId,
        sourceRef: receipt.descriptor.objectId,
        sourceDigest: receipt.descriptor.payloadHash,
        sinkRuleId: input.sinkRuleId,
        principalId: sink.fixedPrincipalId,
      });
      const manifest = await this.#materializeRegistered(request, linked.signal);
      if (!manifest) return deepFreeze({ status: 'blocked', reason: 'disclosure_denied' });
      return deepFreeze({ status: 'ready', request, manifest });
    } catch (error) {
      if (linked.signal.aborted) {
        throw linked.signal.reason ?? new DOMException('Projection disclosure cancelled', 'AbortError');
      }
      const reason = blockerKind(error);
      await this.#block(input.operationId, input.projectId, reason);
      return deepFreeze({ status: 'blocked', reason });
    } finally {
      linked.dispose();
    }
  }

  async #revalidateRegistered(
    input: GovernedDisclosureRevalidationInput,
    operationSignal: AbortSignal,
  ): Promise<GovernedDisclosureRevalidationResult> {
    const linked = linkSignals(this.options.signal, operationSignal);
    let reason: GovernedDisclosureBlockReason | undefined;
    try {
      const { request, manifest } = input;
      const authority = await this.options.repository.readProject(request.projectId);
      if (!authority) reason = 'project_authority_unavailable';
      const source = authority
        ? await this.options.repository.readSource(
            request.projectId,
            request.sourceRef,
            request.sourceDigest,
          )
        : undefined;
      const sourceInvalid = !source
        || source.sourceRef !== request.sourceRef
        || source.sourceDigest !== request.sourceDigest
        || source.projectAuthorityDigest !== authority!.digest
        || source.projectAuthorityRevision !== authority!.revision
        || source.descriptor.objectId !== manifest.source.objectId
        || source.descriptor.payloadHash !== manifest.source.payloadHash
        || digest(source.descriptor) !== manifest.source.descriptorDigest
        || digest(source.descriptor.lineage) !== manifest.source.lineageDigest
        || canonicalWorkroomJson(source.handle) !== canonicalWorkroomJson(manifest.source.handle);
      const rule = authority?.sinks[request.sinkRuleId];
      const destination = rule && authority?.policy.destinations[rule.destinationId];
      if (!reason && (!rule || !destination
        || (rule.fixedPrincipalId !== undefined && request.principalId !== rule.fixedPrincipalId)
        || manifest.channel !== rule.channel
        || manifest.purpose !== rule.purpose
        || manifest.principal.principalId !== request.principalId
        || manifest.principal.assignmentId !== request.assignmentId
        || manifest.destination.id !== rule.destinationId)) {
        reason = 'disclosure_manifest_stale';
      }
      if (!reason && (manifest.destination.recipientRevision !== rule!.recipients.revision
        || manifest.destination.recipientDigest !== rule!.recipients.digest
        || destination!.recipientSnapshotRevision !== rule!.recipients.revision
        || destination!.recipientSnapshotDigest !== rule!.recipients.digest)) {
        reason = 'disclosure_recipient_revoked';
      }
      if (!reason && manifest.destination.contractDigest !== destination!.contractDigest) {
        reason = 'disclosure_manifest_stale';
      }
      // Any policy replacement invalidates the persisted decision. A wider
      // current policy must never silently extend an older Manifest.
      if (!reason && (manifest.policy.revision !== authority!.policy.revision
        || manifest.policy.digest !== authority!.policy.digest)) {
        reason = 'disclosure_manifest_stale';
      }
      if (!reason && sourceInvalid) reason = 'source_authority_conflict';
      const now = this.#now();
      if (!reason && now >= manifest.expiresAt) reason = 'disclosure_manifest_expired';
      if (!reason && !exactCurrentApprovals(manifest, authority!.approvals, now)) {
        reason = 'disclosure_approval_required';
      }
      if (reason) {
        await this.#block(request.operationId, request.projectId, reason,
          source?.sourceBindingDigest, authority?.digest);
        return deepFreeze({ status: 'blocked', reason });
      }
      linked.signal.throwIfAborted();
      await this.#requirePayloadInfrastructure(linked.signal);
      const body = await this.options.vault.readExact({
        handle: structuredClone(manifest.output.handle),
        requestDigest: manifest.requestDigest,
        purpose: manifest.purpose,
        principalId: manifest.principal.principalId,
        destinationId: manifest.destination.id,
      }, linked.signal);
      if (hashBytes(body) !== manifest.output.payloadHash) {
        await this.#block(request.operationId, request.projectId, 'source_authority_conflict',
          source?.sourceBindingDigest, authority?.digest);
        return deepFreeze({ status: 'blocked', reason: 'source_authority_conflict' });
      }
      return Object.freeze({ status: 'ready', manifest: deepFreeze(structuredClone(manifest)), body });
    } catch (error) {
      if (linked.signal.aborted) {
        throw linked.signal.reason ?? new DOMException('Data Governance dispatch cancelled', 'AbortError');
      }
      const blocked = blockerKind(error);
      await this.#block(input.request.operationId, input.request.projectId, blocked);
      return deepFreeze({ status: 'blocked', reason: blocked });
    } finally {
      linked.dispose();
    }
  }

  async #materializeAssignment(
    request: Parameters<WorkroomAssignmentDisclosureManifestAuthorityPort['materialize']>[0],
  ): Promise<MaterializedDisclosureManifest | null> {
    let authority: ProjectDataGovernanceAuthority | undefined;
    try {
      authority = await this.options.repository.readProject(request.preview.projectId);
    } catch (error) {
      if (this.options.signal.aborted) throw this.options.signal.reason;
      await this.#block(request.preview.operationId, request.preview.projectId, blockerKind(error));
      return null;
    }
    const rule = authority?.remote[request.endpointId];
    if (!authority || !rule || request.preview.generation !== this.generation
      || rule.principal.role !== request.preview.role) {
      await this.#block(request.preview.operationId, request.preview.projectId,
        authority ? 'disclosure_denied' : 'project_authority_unavailable', undefined, authority?.digest);
      return null;
    }
    return await this.disclosureManifest.materialize({
      operationId: request.preview.operationId,
      projectId: request.preview.projectId,
      sourceRef: request.contextView.ref,
      sourceDigest: request.contextView.hash,
      sinkRuleId: `remote:${request.endpointId}`,
      principalId: request.principalId,
      assignmentId: request.assignmentId,
    }, this.options.signal);
  }

  async #materialize(input: Readonly<{
    operationId: string;
    authority: ProjectDataGovernanceAuthority;
    source: GovernedSourceAuthority;
    context: DisclosureContext;
    signal: AbortSignal;
  }>): Promise<MaterializedDisclosureManifest> {
    const decisionInput: DisclosureDecisionInput = deepFreeze({
      descriptor: structuredClone(input.source.descriptor),
      policy: structuredClone(input.authority.policy),
      context: structuredClone(input.context),
      approvals: structuredClone(input.authority.approvals),
      evaluatedAt: this.#now(),
    });
    return await materializeDisclosureManifest({
      decisionInput,
      categoryRegistry: input.authority.categoryRegistry,
      source: input.source.handle,
      vault: this.options.vault,
      ...(this.options.transforms ? { transforms: this.options.transforms } : {}),
      signal: input.signal,
    });
  }

  #assertGeneration(request: WorkroomPlanningDisclosureRequest): void {
    const expected = createWorkroomDynamicPlanningGenerationSnapshot(this.generation);
    if (canonicalWorkroomJson(request.generation) !== canonicalWorkroomJson(expected)) {
      throw new Error('Data Governance request escaped its Root generation');
    }
    this.options.signal.throwIfAborted();
  }

  async #block(
    operationId: string,
    projectId: string,
    kind: DataGovernanceBlockerKind,
    sourceBindingDigest?: string,
    authorityDigest?: string,
  ): Promise<void> {
    await this.options.repository.recordBlocker({
      version: 1,
      generation: this.generation,
      operationId,
      projectId,
      kind,
      ...(authorityDigest ? { authorityDigest } : {}),
      ...(sourceBindingDigest && /^sha256:[a-f\d]{64}$/u.test(sourceBindingDigest)
        ? { sourceBindingDigest }
        : {}),
      createdAt: this.#now(),
    });
  }
}

function blockerKind(error: unknown): DataGovernanceBlockerKind {
  if (error instanceof DOMException && error.name === 'AbortError') return 'generation_retired';
  if (error instanceof DataGovernanceAuthorityUnauthorizedError) return 'project_authority_unavailable';
  if (error instanceof PayloadVaultCryptographyUnavailableError) return 'payload_vault_key_unavailable';
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Project authority is unavailable')) return 'project_authority_unavailable';
  if (message.includes('quarantined')) return 'source_classification_quarantined';
  if (message.includes('approval')) return 'disclosure_approval_required';
  if (message.includes('stale') || message.includes('conflict')) return 'source_authority_conflict';
  if (message.includes('Abort') || message.includes('retired')) return 'generation_retired';
  return 'disclosure_denied';
}

function exactCurrentApprovals(
  manifest: MaterializedDisclosureManifest,
  approvals: readonly DisclosureApprovalSnapshot[],
  now: number,
): boolean {
  if (manifest.approvalIds.length === 0) return true;
  const byId = new Map(approvals.map(approval => [approval.id, approval]));
  return manifest.approvalIds.every((id) => {
    const approval = byId.get(id);
    return approval?.decision === 'approved'
      && approval.requestDigest === manifest.requestDigest
      && approval.policyRevision === manifest.policy.revision
      && now < approval.expiresAt;
  });
}

function validateReceiptSource(
  value: WorkroomGovernedPayloadReceipt['source'],
): WorkroomGovernedPayloadReceipt['source'] {
  if (!value || !['command', 'file', 'url', 'tool', 'human'].includes(value.kind)
    || typeof value.ref !== 'string' || !value.ref.trim()
    || !/^sha256:[a-f\d]{64}$/u.test(value.digest)
    || !/^sha256:[a-f\d]{64}$/u.test(value.bindingDigest)
    || (value.verification !== 'verified' && value.verification !== 'unverified')) {
    throw new Error('Trusted Evidence source resolver returned invalid canonical authority');
  }
  return deepFreeze(structuredClone(value));
}

function validatePublicationReceiptSource(value: Readonly<{
  kind: string;
  ref: string;
  digest: string;
  bindingDigest: string;
  verification: 'verified' | 'unverified';
}>): WorkroomGovernedPayloadReceipt['source'] {
  const kind = (() => {
    switch (value.kind) {
      case 'command': return 'command' as const;
      case 'file': return 'file' as const;
      case 'url': return 'url' as const;
      case 'tool': return 'tool' as const;
      case 'human': return 'human' as const;
      default: throw new Error('Governed Payload header publication source kind is invalid');
    }
  })();
  return validateReceiptSource(deepFreeze({
    kind,
    ref: value.ref,
    digest: value.digest,
    bindingDigest: value.bindingDigest,
    verification: value.verification,
  }));
}

function exactDigest(value: string, label: string): string {
  if (!/^sha256:[a-f\d]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertAcceptanceProjectionReceipt(receipt: WorkroomAcceptanceProjectionPayloadReceipt): void {
  if (!receipt.vaultObjectId.trim() || !receipt.objectId.trim()
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.payloadHash)
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.descriptorDigest)
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.locationManifestDigest)
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.sourceBindingDigest)
    || receipt.source.kind !== 'profile-policy'
    || !receipt.source.ref.trim()
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.source.digest)
    || !receipt.source.issuer.trim()
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.source.issuerDigest)
    || !Number.isSafeInteger(receipt.source.revision) || receipt.source.revision < 1
    || !/^sha256:[a-f\d]{64}$/u.test(receipt.source.bindingDigest)
    || receipt.source.bindingDigest !== receipt.sourceBindingDigest
    || receipt.source.verification !== 'verified'
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1) {
    throw new Error('Acceptance projection governed payload receipt is malformed');
  }
}

function isAcceptanceProjectionInput(
  value: unknown,
): value is Parameters<typeof createWorkroomGovernedAcceptanceProjection>[0] {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.projectId !== 'string'
    || typeof value.profileRevisionId !== 'string'
    || typeof value.profileDigest !== 'string'
    || typeof value.revision !== 'number'
    || typeof value.issuer !== 'string'
    || !Array.isArray(value.tasks)
    || !value.tasks.every(isAcceptanceTaskPolicy)
    || !isRecord(value.memorySchema)
    || typeof value.memorySchema.revision !== 'number'
    || !Array.isArray(value.memorySchema.claimRules)
    || !value.memorySchema.claimRules.every(isMemoryClaimRule)) {
    return false;
  }
  return Object.keys(value).every(key => [
    'version', 'projectId', 'profileRevisionId', 'profileDigest', 'revision', 'issuer', 'tasks', 'memorySchema',
  ].includes(key));
}

function isAcceptanceTaskPolicy(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.taskKey !== 'string'
    || !['task_result', 'integration_candidate', 'effect_intent'].includes(String(value.kind))
    || !Array.isArray(value.criteria)
    || !value.criteria.every(isAcceptanceCriterion)
    || !Array.isArray(value.requiredEvidence)
    || !value.requiredEvidence.every(item => typeof item === 'string')
    || !['baseline', 'reviewer_required', 'sponsor_required', 'reviewer_then_sponsor']
      .includes(String(value.minimumRoute))
    || typeof value.reviewerPrincipalId !== 'string'
    || typeof value.sponsorPrincipalId !== 'string'
    || typeof value.reviewerTimeoutMs !== 'number'
    || typeof value.sponsorTimeoutMs !== 'number') {
    return false;
  }
  return Object.keys(value).every(key => [
    'taskKey', 'kind', 'criteria', 'requiredEvidence', 'minimumRoute', 'reviewerPrincipalId',
    'sponsorPrincipalId', 'reviewerTimeoutMs', 'sponsorTimeoutMs',
  ].includes(key));
}

function isAcceptanceCriterion(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && ['deterministic', 'judgment'].includes(String(value.kind))
    && typeof value.description === 'string'
    && Object.keys(value).every(key => ['id', 'kind', 'description'].includes(key));
}

function isMemoryClaimRule(value: unknown): boolean {
  return isRecord(value)
    && typeof value.key === 'string'
    && value.valueType === 'string'
    && Array.isArray(value.allowedStatuses)
    && value.allowedStatuses.every(status => status === 'verified' || status === 'assumed')
    && typeof value.allowSupersedes === 'boolean'
    && Object.keys(value).every(key => [
      'key', 'valueType', 'allowedStatuses', 'allowSupersedes',
    ].includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function linkSignals(generation: AbortSignal, operation: AbortSignal) {
  const controller = new AbortController();
  const abortGeneration = (): void => controller.abort(generation.reason);
  const abortOperation = (): void => controller.abort(operation.reason);
  generation.addEventListener('abort', abortGeneration, { once: true });
  operation.addEventListener('abort', abortOperation, { once: true });
  if (generation.aborted) abortGeneration();
  else if (operation.aborted) abortOperation();
  return {
    signal: controller.signal,
    dispose: () => {
      generation.removeEventListener('abort', abortGeneration);
      operation.removeEventListener('abort', abortOperation);
    },
  };
}

function journalIntentId(
  projectId: string,
  runId: string,
  receipt: WorkroomGovernedPayloadReceipt,
): string {
  return createGovernedPayloadWriteIntentId({
    operationId: `journal-publication:${runId}`,
    projectId,
    objectId: receipt.descriptor.objectId,
    payloadHash: receipt.descriptor.payloadHash,
    descriptorDigest: receipt.descriptor.descriptorDigest,
    sourceBindingDigest: receipt.source.bindingDigest,
    consumer: 'journal_header',
    publicationScope: runId,
  });
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Data Governance ${label} is invalid`);
  return Number(value);
}

function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Data Governance ${label} is invalid`);
  return Number(value);
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Data Governance retention overflow');
  return value;
}
