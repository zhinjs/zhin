import { describe, expect, it } from 'vitest';
import {
  createWorkroomDataGovernanceBootstrapCandidate,
} from '../../src/plugin-runtime/workroom-data-governance-bootstrap.js';
import {
  WorkroomDataGovernanceAuthorityWriter,
} from '../../src/plugin-runtime/workroom-data-governance-authority-writer.js';
import { digestWorkroomCatalogProjectBinding } from '../../src/plugin-runtime/workroom-assignment-authority-provider.js';

describe('Workroom Data Governance bootstrap', () => {
  it('builds a writer-valid Project authority from an explicit model processor contract', async () => {
    const definition = {
      name: 'Project 1',
      members: [{ agent: 'planner', role: 'orchestrator' as const }],
      sponsors: ['principal:sponsor'],
      conversation: {
        adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
        id: 'project-1', agent: 'planner',
      },
      sponsorConversation: {
        adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
        id: 'project-1-sponsors', agent: 'planner',
      },
    };
    const candidate = createWorkroomDataGovernanceBootstrapCandidate({
      projectId: 'project-1',
      tenantId: 'tenant:project-1',
      definition,
      revision: 1,
      model: {
        providerId: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        processingRegions: ['global'],
        maxConfidentiality: 'project_internal',
        external: true,
        noTraining: true,
        loggingMode: 'metadata_only',
        maximumRetentionSeconds: 1,
        allowsRedisclosure: false,
        supportsDeletion: false,
      },
    });
    const writer = new WorkroomDataGovernanceAuthorityWriter({
      catalog: { read: async () => ({ revision: 'catalog:1', definitions: { 'project-1': definition } }) },
      repository: {
        readProject: async () => undefined,
        appendProject: async authority => ({ status: 'created' as const, authority }),
      },
      decisions: {
        authorize: async input => ({
          decisionId: 'decision:1',
          projectId: input.projectId,
          candidateDigest: input.candidateDigest,
          principalId: 'principal:sponsor',
          authorizedBy: 'sponsor',
          decidedAt: 1,
          catalogRevision: input.catalogRevision,
          catalogBindingDigest: input.catalogBindingDigest,
        }),
      },
    });

    await expect(writer.publish({
      catalogRevision: 'catalog:1',
      catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
      candidate,
    }, new AbortController().signal)).resolves.toMatchObject({
      projectId: 'project-1',
      planning: { destinationId: 'model-provider:openrouter' },
    });
  });

  it('refuses to attest an external processor that may train on Workroom content', () => {
    expect(() => createWorkroomDataGovernanceBootstrapCandidate({
      projectId: 'project-1', tenantId: 'tenant:project-1', revision: 1,
      definition: {
        name: 'Project 1', members: [{ agent: 'planner', role: 'orchestrator' }],
        conversation: {
          adapter: 'sandbox', endpoint: 'bot', kind: 'channel', id: 'project-1', agent: 'planner',
        },
      },
      model: {
        providerId: 'unsafe', endpoint: 'https://example.invalid', processingRegions: ['global'],
        maxConfidentiality: 'project_internal', external: true, noTraining: false,
        loggingMode: 'full', maximumRetentionSeconds: 86_400,
        allowsRedisclosure: true, supportsDeletion: false,
      },
    })).toThrow('prohibit training');
  });

  it('refuses a processor whose clearance cannot receive project-internal Workroom content', () => {
    expect(() => createWorkroomDataGovernanceBootstrapCandidate({
      projectId: 'project-1', tenantId: 'tenant:project-1', revision: 1,
      definition: {
        name: 'Project 1', members: [{ agent: 'planner', role: 'orchestrator' }],
        conversation: {
          adapter: 'sandbox', endpoint: 'bot', kind: 'channel', id: 'project-1', agent: 'planner',
        },
      },
      model: {
        providerId: 'public-only', endpoint: 'https://example.invalid', processingRegions: ['global'],
        maxConfidentiality: 'public', external: false, noTraining: true,
        loggingMode: 'disabled', maximumRetentionSeconds: 1,
        allowsRedisclosure: false, supportsDeletion: false,
      },
    })).toThrow('project_internal clearance');
  });
});
