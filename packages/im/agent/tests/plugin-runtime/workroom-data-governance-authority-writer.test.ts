import { describe, expect, it, vi } from 'vitest';
import {
  createDataCategoryRegistrySnapshot,
  createDataGovernancePolicySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
} from '../../src/data-governance/data-governance.js';
import type { ProjectDataGovernanceAuthority } from '../../src/data-governance/governance-authority-repository.js';
import {
  WorkroomDataGovernanceAuthorityWriter,
  type ProjectDataGovernanceAuthorityCandidate,
} from '../../src/plugin-runtime/workroom-data-governance-authority-writer.js';
import { digestWorkroomCatalogProjectBinding } from '../../src/plugin-runtime/workroom-assignment-authority-provider.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('trusted Project Data Governance authority writer', () => {
  it('publishes exact Catalog-bound Projection and Journal policies only after trusted decision echo', async () => {
    const definition = {
      name: 'Software', enabled: true,
      members: [{ agent: 'orchestrator', role: 'orchestrator' as const }],
      sponsors: ['principal:sponsor'],
      sponsorConversation: {
        adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
        id: 'project-1-sponsors', agent: 'orchestrator',
      },
    };
    const candidate = projectionCandidate();
    let stored: ProjectDataGovernanceAuthority | undefined;
    const authorize = vi.fn(async (input: Parameters<
      ConstructorParameters<typeof WorkroomDataGovernanceAuthorityWriter>[0]['decisions']['authorize']
    >[0]) => ({
      decisionId: 'decision:projection-1', projectId: input.projectId,
      candidateDigest: input.candidateDigest, principalId: 'principal:data-steward',
      authorizedBy: 'data_steward' as const, decidedAt: 100,
      catalogRevision: input.catalogRevision,
      catalogBindingDigest: input.catalogBindingDigest,
    }));
    const writer = new WorkroomDataGovernanceAuthorityWriter({
      catalog: { read: async () => ({ revision: 'catalog:1', definitions: { 'project-1': definition } }) },
      repository: {
        readProject: async () => undefined,
        appendProject: async (authority, expected) => {
          expect(expected).toBeUndefined();
          stored = authority;
          return { status: 'created', authority };
        },
      },
      decisions: { authorize },
    });

    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate: {
        ...candidate,
        sinks: {
          ...candidate.sinks,
          'projection:sponsor-room': {
            ...candidate.sinks['projection:sponsor-room']!,
            channel: 'workroom_projection',
          },
        },
      },
    }, new AbortController().signal)).rejects.toThrow('Projection derived/sink');
    expect(authorize).not.toHaveBeenCalled();

    const result = await writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate,
    }, new AbortController().signal);
    expect(result).toBe(stored);
    expect(result.sinks['projection:workroom']).toMatchObject({
      channel: 'workroom_projection', purpose: 'workroom_awareness',
      fixedPrincipalId: 'service:workroom-projection:project-1',
    });
    expect(result.sinks['projection:sponsor-room']).toMatchObject({
      channel: 'sponsor_projection', purpose: 'portfolio_oversight',
      fixedPrincipalId: 'service:workroom-sponsor-projection:project-1',
      recipients: { recipients: [{ principalId: 'principal:sponsor' }] },
    });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      candidateDigest: digest(candidate), catalogRevision: 'catalog:1',
    }), expect.any(AbortSignal));
  });

  it('rejects stale Catalog binding, missing Projection authority and forged decision echo', async () => {
    const definition = { name: 'Software', members: [{ agent: 'o', role: 'orchestrator' as const }], sponsors: ['principal:sponsor'] };
    const authorize = vi.fn(async () => null);
    const writer = new WorkroomDataGovernanceAuthorityWriter({
      catalog: { read: async () => ({ revision: 'catalog:1', definitions: { 'project-1': definition } }) },
      repository: { readProject: async () => undefined, appendProject: async () => { throw new Error('no write'); } },
      decisions: { authorize },
    });
    await expect(writer.publish({
      catalogRevision: 'catalog:stale',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate: projectionCandidate(),
    }, new AbortController().signal)).rejects.toThrow('Catalog binding');
    expect(authorize).not.toHaveBeenCalled();

    const candidate = projectionCandidate();
    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate: { ...candidate, derivedPayloads: {} },
    }, new AbortController().signal)).rejects.toThrow('Projection derived/sink');

    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate: {
        ...candidate,
        derivedPayloads: { ...candidate.derivedPayloads, journal: undefined },
      },
    }, new AbortController().signal)).rejects.toThrow('Workroom Journal derived/sink');

    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate,
    }, new AbortController().signal)).rejects.toThrow('decision');
  });

  it('rejects a trusted decision whose persisted Catalog authority echo is forged', async () => {
    const definition = { name: 'Software', members: [{ agent: 'o', role: 'orchestrator' as const }], sponsors: ['principal:sponsor'] };
    const writer = new WorkroomDataGovernanceAuthorityWriter({
      catalog: { read: async () => ({ revision: 'catalog:1', definitions: { 'project-1': definition } }) },
      repository: {
        readProject: async () => undefined,
        appendProject: async authority => ({ status: 'created', authority }),
      },
      decisions: {
        authorize: async input => ({
          decisionId: 'decision:forged-catalog', projectId: input.projectId,
          candidateDigest: input.candidateDigest, principalId: 'principal:data-steward',
          authorizedBy: 'data_steward', decidedAt: 100,
          catalogRevision: 'catalog:forged',
          catalogBindingDigest: input.catalogBindingDigest,
        }),
      },
    });

    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate: projectionCandidate(),
    }, new AbortController().signal)).rejects.toThrow('decision');
  });
});

function projectionCandidate(): ProjectDataGovernanceAuthorityCandidate {
  const recipients = createDisclosureRecipientSetSnapshot({
    revision: 1,
    recipients: [
      {
        principalId: 'room:project-1', tenantId: 'tenant-1', projectId: 'project-1',
        clearance: 'confidential',
      },
      {
        principalId: 'service:workroom-kernel:project-1', tenantId: 'tenant-1', projectId: 'project-1',
        clearance: 'confidential',
      },
      {
        principalId: 'principal:sponsor', tenantId: 'tenant-1', projectId: 'project-1',
        clearance: 'confidential',
      },
    ],
  });
  const destination = createProcessingDestinationContract({
    id: 'destination:projection', owner: 'owner:workroom', endpoint: 'im://project-1',
    tenantId: 'tenant-1', projectId: 'project-1', trustDomain: 'trust:workroom',
    processingRegions: ['ap-southeast-1'], maxConfidentiality: 'confidential',
    allowedCategories: ['customer_content'], external: false, noTraining: true,
    loggingMode: 'metadata_only', maximumRetentionSeconds: 86_400,
    allowsRedisclosure: false, supportsDeletion: true,
    recipientSnapshotRevision: recipients.revision, recipientSnapshotDigest: recipients.digest,
  });
  const sponsorRecipients = createDisclosureRecipientSetSnapshot({
    revision: 1,
    recipients: [{
      principalId: 'principal:sponsor', tenantId: 'tenant-1', projectId: 'project-1',
      clearance: 'confidential',
    }],
  });
  const sponsorDestination = createProcessingDestinationContract({
    id: 'destination:sponsor-room', owner: 'owner:workroom', endpoint: 'im://project-1/sponsors',
    tenantId: 'tenant-1', projectId: 'project-1', trustDomain: 'trust:workroom',
    processingRegions: ['ap-southeast-1'], maxConfidentiality: 'confidential',
    allowedCategories: ['customer_content'], external: false, noTraining: true,
    loggingMode: 'metadata_only', maximumRetentionSeconds: 86_400,
    allowsRedisclosure: false, supportsDeletion: true,
    recipientSnapshotRevision: sponsorRecipients.revision,
    recipientSnapshotDigest: sponsorRecipients.digest,
  });
  const categoryRegistry = createDataCategoryRegistrySnapshot({
    id: 'registry:tenant-1', revision: 1, tenantId: 'tenant-1',
    kindFloors: {
      source_message: 'project_internal', projection_payload: 'project_internal',
      workroom_fact: 'project_internal',
    },
    categories: { customer_content: { confidentialityFloor: 'confidential' } },
  });
  const policy = createDataGovernancePolicySnapshot({
    id: 'policy:project-1', revision: 1, tenantId: 'tenant-1', projectId: 'project-1',
    destinations: { [destination.id]: destination, [sponsorDestination.id]: sponsorDestination },
    channelCeilings: {
      context_view: 'confidential', evidence_port: 'confidential',
      workroom_projection: 'confidential', sponsor_projection: 'confidential',
      console: 'confidential', model_provider: 'confidential', a2a: 'confidential',
    },
    transforms: {}, externalApprovalFloor: 'restricted',
  });
  const derivedRule = {
    proposedConfidentiality: 'confidential' as const,
    categories: ['customer_content'], allowedPurposes: [
      'workroom_awareness' as const, 'portfolio_oversight' as const,
    ],
    allowedRegions: ['ap-southeast-1'], retentionClass: 'operational' as const,
    minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
  };
  return {
    version: 1, revision: 1, projectId: 'project-1', tenantId: 'tenant-1',
    categoryRegistry, policy,
    planning: {
      destinationId: destination.id, recipients,
      principal: { role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'] },
      source: {
        ...derivedRule, requestedMode: 'full', linkPrincipalAsSubject: true,
      },
    },
    remote: {},
    sinks: {
      'projection:workroom': {
        destinationId: destination.id, channel: 'workroom_projection', purpose: 'workroom_awareness',
        fixedPrincipalId: 'service:workroom-projection:project-1', recipients,
        principal: {
          role: 'projector', clearance: 'confidential', allowedPurposes: ['workroom_awareness'],
        },
        requestedMode: 'full',
      },
      'projection:sponsor-room': {
        destinationId: sponsorDestination.id, channel: 'sponsor_projection', purpose: 'portfolio_oversight',
        fixedPrincipalId: 'service:workroom-sponsor-projection:project-1', recipients: sponsorRecipients,
        principal: {
          role: 'projector', clearance: 'confidential', allowedPurposes: ['portfolio_oversight'],
        },
        requestedMode: 'full',
      },
      'workroom-journal:kernel-replay': {
        destinationId: destination.id, channel: 'context_view', purpose: 'orchestration',
        fixedPrincipalId: 'service:workroom-kernel:project-1', recipients,
        principal: {
          role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'],
        },
        requestedMode: 'full',
      },
    },
    derivedPayloads: {
      projection: derivedRule,
      journal: { ...derivedRule, allowedPurposes: ['orchestration'] },
    },
    approvals: [],
  };
}
