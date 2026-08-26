import {
  createDataCategoryRegistrySnapshot,
  createDataGovernancePolicySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
  type ConfidentialityClass,
} from '../data-governance/data-governance.js';
import type { WorkroomDefinition } from '../workroom/catalog-definition.js';
import type { ProjectDataGovernanceAuthorityCandidate } from './workroom-data-governance-authority-writer.js';

export interface WorkroomModelProcessingContractInput {
  readonly providerId: string;
  readonly endpoint: string;
  readonly owner?: string;
  readonly trustDomain?: string;
  readonly processingRegions: readonly string[];
  readonly maxConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly external: boolean;
  readonly noTraining: boolean;
  readonly loggingMode: 'disabled' | 'metadata_only' | 'full';
  readonly maximumRetentionSeconds: number;
  readonly allowsRedisclosure: boolean;
  readonly supportsDeletion: boolean;
}

/** Conservative P12 baseline generated only from an explicit processor contract. */
export function createWorkroomDataGovernanceBootstrapCandidate(input: Readonly<{
  projectId: string;
  tenantId: string;
  definition: WorkroomDefinition;
  model: WorkroomModelProcessingContractInput;
  revision: number;
  previousDigest?: string;
}>): ProjectDataGovernanceAuthorityCandidate {
  const conversation = input.definition.conversation;
  if (!conversation) throw new Error('Workroom disclosure bootstrap requires a Project conversation');
  if (input.model.external && !input.model.noTraining) {
    throw new Error('External Workroom model processor must prohibit training');
  }
  if (input.model.maxConfidentiality === 'public') {
    throw new Error('Workroom model processor requires at least project_internal clearance');
  }
  const modelRegions = uniqueText(input.model.processingRegions, 'model processingRegions');
  const allowedRegions = uniqueText(['local', ...modelRegions], 'allowedRegions');
  const categoryId = 'workroom_content';
  const modelRecipients = createDisclosureRecipientSetSnapshot({
    revision: input.revision,
    recipients: [{
      principalId: `processor:${input.model.providerId}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      clearance: input.model.maxConfidentiality,
    }],
  });
  const workroomRecipients = createDisclosureRecipientSetSnapshot({
    revision: input.revision,
    recipients: [
      `room:${input.projectId}`,
      `service:workroom-kernel:${input.projectId}`,
      `service:workroom-projection:${input.projectId}`,
    ].map(principalId => ({
      principalId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      clearance: 'project_internal' as const,
    })),
  });
  const modelDestination = createProcessingDestinationContract({
    id: `model-provider:${input.model.providerId}`,
    owner: input.model.owner ?? input.model.providerId,
    endpoint: input.model.endpoint,
    tenantId: input.tenantId,
    projectId: input.projectId,
    trustDomain: input.model.trustDomain ?? `model-provider:${input.model.providerId}`,
    processingRegions: modelRegions,
    maxConfidentiality: input.model.maxConfidentiality,
    allowedCategories: [categoryId],
    external: input.model.external,
    noTraining: input.model.noTraining,
    loggingMode: input.model.loggingMode,
    maximumRetentionSeconds: input.model.maximumRetentionSeconds,
    allowsRedisclosure: input.model.allowsRedisclosure,
    supportsDeletion: input.model.supportsDeletion,
    recipientSnapshotRevision: modelRecipients.revision,
    recipientSnapshotDigest: modelRecipients.digest,
  });
  const workroomDestination = createProcessingDestinationContract({
    id: `workroom-room:${input.projectId}`,
    owner: `workroom:${input.projectId}`,
    endpoint: conversationEndpoint(conversation),
    tenantId: input.tenantId,
    projectId: input.projectId,
    trustDomain: `workroom:${input.projectId}`,
    processingRegions: allowedRegions,
    maxConfidentiality: 'project_internal',
    allowedCategories: [categoryId],
    external: false,
    noTraining: true,
    loggingMode: 'metadata_only',
    maximumRetentionSeconds: 86_400,
    allowsRedisclosure: false,
    supportsDeletion: true,
    recipientSnapshotRevision: workroomRecipients.revision,
    recipientSnapshotDigest: workroomRecipients.digest,
  });
  const sponsorRecipients = input.definition.sponsorConversation
    ? createDisclosureRecipientSetSnapshot({
        revision: input.revision,
        recipients: (input.definition.sponsors ?? []).map(principalId => ({
          principalId,
          tenantId: input.tenantId,
          projectId: input.projectId,
          clearance: 'project_internal' as const,
        })),
      })
    : undefined;
  const sponsorDestination = input.definition.sponsorConversation && sponsorRecipients
    ? createProcessingDestinationContract({
        id: `workroom-sponsor-room:${input.projectId}`,
        owner: `workroom:${input.projectId}`,
        endpoint: conversationEndpoint(input.definition.sponsorConversation),
        tenantId: input.tenantId,
        projectId: input.projectId,
        trustDomain: `workroom:${input.projectId}`,
        processingRegions: allowedRegions,
        maxConfidentiality: 'project_internal',
        allowedCategories: [categoryId],
        external: false,
        noTraining: true,
        loggingMode: 'metadata_only',
        maximumRetentionSeconds: 86_400,
        allowsRedisclosure: false,
        supportsDeletion: true,
        recipientSnapshotRevision: sponsorRecipients.revision,
        recipientSnapshotDigest: sponsorRecipients.digest,
      })
    : undefined;
  const categoryRegistry = createDataCategoryRegistrySnapshot({
    id: `workroom:${input.projectId}:categories`,
    revision: input.revision,
    tenantId: input.tenantId,
    kindFloors: {
      source_message: 'project_internal',
      workroom_fact: 'project_internal',
      context_digest: 'project_internal',
      task_report: 'project_internal',
      artifact: 'project_internal',
      evidence: 'project_internal',
      execution_trace: 'project_internal',
      projection_payload: 'project_internal',
    },
    categories: { [categoryId]: { confidentialityFloor: 'project_internal' } },
  });
  const destinations = {
    [modelDestination.id]: modelDestination,
    [workroomDestination.id]: workroomDestination,
    ...(sponsorDestination ? { [sponsorDestination.id]: sponsorDestination } : {}),
  };
  const policy = createDataGovernancePolicySnapshot({
    id: `workroom:${input.projectId}:policy`,
    revision: input.revision,
    tenantId: input.tenantId,
    projectId: input.projectId,
    destinations,
    channelCeilings: {
      context_view: 'project_internal',
      evidence_port: 'project_internal',
      workroom_projection: 'project_internal',
      sponsor_projection: 'project_internal',
      console: 'project_internal',
      model_provider: input.model.maxConfidentiality,
      a2a: 'project_internal',
    },
    transforms: {},
    externalApprovalFloor: 'confidential',
  });
  const operationalRule = Object.freeze({
    proposedConfidentiality: 'project_internal' as const,
    categories: [categoryId],
    allowedPurposes: ['orchestration' as const],
    allowedRegions,
    retentionClass: 'operational' as const,
    minimumRetentionMs: 0,
    maximumRetentionMs: 86_400_000,
  });
  const projectionRule = Object.freeze({
    ...operationalRule,
    allowedPurposes: ['workroom_awareness' as const, 'portfolio_oversight' as const],
  });
  const candidate: ProjectDataGovernanceAuthorityCandidate = {
    version: 1,
    revision: input.revision,
    ...(input.previousDigest ? { previousDigest: input.previousDigest } : {}),
    projectId: input.projectId,
    tenantId: input.tenantId,
    categoryRegistry,
    policy,
    planning: {
      destinationId: modelDestination.id,
      recipients: modelRecipients,
      principal: {
        role: 'orchestrator',
        clearance: input.model.maxConfidentiality,
        allowedPurposes: ['orchestration'],
      },
      source: {
        ...operationalRule,
        requestedMode: 'full',
        linkPrincipalAsSubject: true,
      },
    },
    remote: {},
    sinks: {
      'model-provider:planning': {
        destinationId: modelDestination.id,
        channel: 'model_provider',
        purpose: 'orchestration',
        recipients: modelRecipients,
        principal: {
          role: 'orchestrator',
          clearance: input.model.maxConfidentiality,
          allowedPurposes: ['orchestration'],
        },
        requestedMode: 'full',
      },
      'projection:workroom': {
        destinationId: workroomDestination.id,
        channel: 'workroom_projection',
        purpose: 'workroom_awareness',
        fixedPrincipalId: `service:workroom-projection:${input.projectId}`,
        recipients: workroomRecipients,
        principal: {
          role: 'projector', clearance: 'project_internal',
          allowedPurposes: ['workroom_awareness'],
        },
        requestedMode: 'full',
      },
      ...(sponsorDestination && sponsorRecipients ? {
        'projection:sponsor-room': {
          destinationId: sponsorDestination.id,
          channel: 'sponsor_projection' as const,
          purpose: 'portfolio_oversight' as const,
          fixedPrincipalId: `service:workroom-sponsor-projection:${input.projectId}`,
          recipients: sponsorRecipients,
          principal: {
            role: 'projector' as const,
            clearance: 'project_internal' as const,
            allowedPurposes: ['portfolio_oversight' as const],
          },
          requestedMode: 'full' as const,
        },
      } : {}),
      'workroom-journal:kernel-replay': {
        destinationId: workroomDestination.id,
        channel: 'context_view',
        purpose: 'orchestration',
        fixedPrincipalId: `service:workroom-kernel:${input.projectId}`,
        recipients: workroomRecipients,
        principal: {
          role: 'orchestrator', clearance: 'project_internal',
          allowedPurposes: ['orchestration'],
        },
        requestedMode: 'full',
      },
    },
    derivedPayloads: {
      projection: projectionRule,
      journal: operationalRule,
    },
    approvals: [],
  };
  return Object.freeze(candidate);
}

function conversationEndpoint(conversation: NonNullable<WorkroomDefinition['conversation']>): string {
  return `im://${encodeURIComponent(conversation.adapter)}/${encodeURIComponent(conversation.endpoint)}/${encodeURIComponent(conversation.kind)}/${encodeURIComponent(conversation.id)}`;
}

function uniqueText(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value) => {
    if (!value || value.trim() !== value) throw new Error(`${label} contains an invalid value`);
    return value;
  });
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must contain unique values`);
  }
  return Object.freeze([...normalized].sort());
}
