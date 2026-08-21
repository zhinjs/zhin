import {
  createProjectDataGovernanceAuthority,
  FileDataGovernanceAuthorityRepository,
  type DataGovernanceAuthorityDecision,
  type DataGovernanceAuthorityRepository,
  type DataGovernanceAuthorityVerificationPort,
  type ProjectDataGovernanceAuthority,
  type ProjectDataGovernanceAuthorityInput,
} from '../data-governance/governance-authority-repository.js';
import { join } from 'node:path';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import { digestWorkroomCatalogProjectBinding } from './workroom-assignment-authority-provider.js';

export type ProjectDataGovernanceAuthorityCandidate = Omit<
  ProjectDataGovernanceAuthorityInput,
  'governanceDecision'
>;

export interface WorkroomDataGovernancePublicationDecision
extends DataGovernanceAuthorityDecision {
  readonly catalogRevision: string;
  readonly catalogBindingDigest: string;
}

export interface WorkroomDataGovernancePublicationDecisionPort {
  authorize(input: Readonly<{
    projectId: string;
    catalogRevision: string;
    catalogBindingDigest: string;
    candidateDigest: string;
    expectedPreviousDigest?: string;
  }>, signal: AbortSignal): Promise<WorkroomDataGovernancePublicationDecision | null>;
}

export interface WorkroomDataGovernanceAuthorityControlPort {
  publish(input: Readonly<{
    catalogRevision: string;
    catalogBindingDigest: string;
    candidate: ProjectDataGovernanceAuthorityCandidate;
  }>, signal: AbortSignal): Promise<ProjectDataGovernanceAuthority>;
}

/** Trusted control-plane writer. It derives no policy and accepts no caller decision proof. */
export class WorkroomDataGovernanceAuthorityWriter
implements WorkroomDataGovernanceAuthorityControlPort {
  constructor(readonly options: Readonly<{
    catalog: Pick<WorkroomCatalog, 'read'>;
    repository: Pick<DataGovernanceAuthorityRepository, 'readProject' | 'appendProject'>;
    decisions: WorkroomDataGovernancePublicationDecisionPort;
  }>) {}

  async publish(
    input: Parameters<WorkroomDataGovernanceAuthorityControlPort['publish']>[0],
    signal: AbortSignal,
  ): Promise<ProjectDataGovernanceAuthority> {
    signal.throwIfAborted();
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[input.candidate.projectId];
    if (!definition || definition.enabled === false
      || catalog.revision !== input.catalogRevision
      || digestWorkroomCatalogProjectBinding(definition) !== input.catalogBindingDigest) {
      throw new Error('Data Governance publication Catalog binding is stale');
    }
    assertProjectionAuthority(input.candidate);
    assertWorkroomJournalDataGovernanceAuthority(input.candidate);
    const current = await this.options.repository.readProject(input.candidate.projectId);
    if ((!current && input.candidate.revision !== 1)
      || (current && (input.candidate.revision !== current.revision + 1
        || input.candidate.previousDigest !== current.digest))) {
      throw new Error('Data Governance publication revision/CAS authority is stale');
    }
    const candidateDigest = digest(input.candidate);
    const decision = await this.options.decisions.authorize({
      projectId: input.candidate.projectId,
      catalogRevision: input.catalogRevision,
      catalogBindingDigest: input.catalogBindingDigest,
      candidateDigest,
      ...(current ? { expectedPreviousDigest: current.digest } : {}),
    }, signal);
    if (!decision
      || decision.projectId !== input.candidate.projectId
      || decision.candidateDigest !== candidateDigest
      || decision.expectedPreviousDigest !== current?.digest
      || decision.catalogRevision !== input.catalogRevision
      || decision.catalogBindingDigest !== input.catalogBindingDigest
      || (decision.authorizedBy !== 'data_steward' && decision.authorizedBy !== 'sponsor')) {
      throw new Error('Data Governance publication decision is unavailable or forged');
    }
    const authority = createProjectDataGovernanceAuthority({
      ...structuredClone(input.candidate),
      governanceDecision: structuredClone(decision),
    });
    return (await this.options.repository.appendProject(authority, current?.digest)).authority;
  }
}

/** Exact policy gate for materializing protected Journal fields into Kernel replay memory. */
export function assertWorkroomJournalDataGovernanceAuthority(
  candidate: ProjectDataGovernanceAuthorityCandidate,
): void {
  const rule = candidate.derivedPayloads.journal;
  const sink = candidate.sinks['workroom-journal:kernel-replay'];
  const servicePrincipal = `service:workroom-kernel:${candidate.projectId}`;
  const destination = sink && candidate.policy.destinations[sink.destinationId];
  if (!rule
    || !rule.allowedPurposes.includes('orchestration')
    || !sink
    || sink.channel !== 'context_view'
    || sink.purpose !== 'orchestration'
    || sink.requestedMode !== 'full'
    || sink.fixedPrincipalId !== servicePrincipal
    || sink.principal.role !== 'orchestrator'
    || !sink.principal.allowedPurposes.includes('orchestration')
    || !sink.recipients.recipients.some(recipient => recipient.principalId === servicePrincipal)
    || !destination
    || destination.external
    || !destination.noTraining
    || destination.loggingMode !== 'metadata_only') {
    throw new Error('Project Data Governance authority lacks exact Workroom Journal derived/sink policy');
  }
}

/** Trusted Root helper; returns only the narrow governed publisher. */
export function createFileWorkroomDataGovernanceAuthorityControl(options: Readonly<{
  stateRoot: string;
  catalog: Pick<WorkroomCatalog, 'read'>;
  governance: DataGovernanceAuthorityVerificationPort;
  decisions: WorkroomDataGovernancePublicationDecisionPort;
}>): WorkroomDataGovernanceAuthorityControlPort {
  return new WorkroomDataGovernanceAuthorityWriter({
    catalog: options.catalog,
    repository: new FileDataGovernanceAuthorityRepository(
      join(options.stateRoot, 'workroom-data-governance-authority'),
      options.governance,
    ),
    decisions: options.decisions,
  });
}

function assertProjectionAuthority(candidate: ProjectDataGovernanceAuthorityCandidate): void {
  const rule = candidate.derivedPayloads.projection;
  const sink = candidate.sinks['projection:workroom'];
  const servicePrincipal = `service:workroom-projection:${candidate.projectId}`;
  if (!rule
    || !rule.allowedPurposes.includes('workroom_awareness')
    || !sink
    || sink.channel !== 'workroom_projection'
    || sink.purpose !== 'workroom_awareness'
    || sink.fixedPrincipalId !== servicePrincipal
    || sink.principal.role !== 'projector'
    || !sink.principal.allowedPurposes.includes('workroom_awareness')
    || !candidate.policy.destinations[sink.destinationId]) {
    throw new Error('Project Data Governance authority lacks exact Projection derived/sink policy');
  }
}
