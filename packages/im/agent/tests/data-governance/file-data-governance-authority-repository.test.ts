import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDataCategoryRegistrySnapshot,
  createDataGovernancePolicySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
} from '../../src/data-governance/data-governance.js';
import {
  DataGovernanceAuthorityConflictError,
  DataGovernanceAuthorityUnauthorizedError,
  FileDataGovernanceAuthorityRepository,
  createProjectDataGovernanceAuthority,
} from '../../src/data-governance/governance-authority-repository.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

describe('FileDataGovernanceAuthorityRepository', () => {
  it('replays exact Project policy and content-free blockers across restart with CAS', async () => {
    const parent = join(tmpdir(), `zhin-governance-${randomUUID()}`);
    await mkdir(parent);
    const directory = join(parent, 'authority');
    const authority = projectAuthority();
    const governance = { verify: async () => true };
    const first = new FileDataGovernanceAuthorityRepository(directory, governance);
    await expect(first.appendProject(authority, undefined)).resolves.toMatchObject({ status: 'created' });
    await expect(first.appendProject(authority, undefined)).resolves.toMatchObject({ status: 'replayed' });
    await expect(new FileDataGovernanceAuthorityRepository(join(parent, 'untrusted'))
      .appendProject(authority, undefined)).rejects.toBeInstanceOf(DataGovernanceAuthorityUnauthorizedError);

    const restarted = new FileDataGovernanceAuthorityRepository(directory, governance);
    await expect(restarted.readProject('project-1')).resolves.toEqual(authority);
    await expect(new FileDataGovernanceAuthorityRepository(directory).readProject('project-1'))
      .rejects.toBeInstanceOf(DataGovernanceAuthorityUnauthorizedError);
    const { digest: _digest, governanceDecision: _decision, ...authorityInput } = authority;
    const nextCandidate = { ...authorityInput, revision: 2, previousDigest: authority.digest } as const;
    const next = createProjectDataGovernanceAuthority({
      ...nextCandidate,
      governanceDecision: {
        decisionId: 'governance:decision-2', projectId: 'project-1',
        expectedPreviousDigest: authority.digest,
        candidateDigest: digestCanonicalWorkroomValue(nextCandidate),
        principalId: 'principal:data-steward', authorizedBy: 'data_steward', decidedAt: 2,
      },
    });
    await expect(restarted.appendProject(next, undefined))
      .rejects.toBeInstanceOf(DataGovernanceAuthorityConflictError);

    const blocker = await restarted.recordBlocker({
      version: 1,
      generation: 9,
      operationId: 'operation:planning-1',
      projectId: 'project-1',
      kind: 'payload_vault_key_unavailable',
      authorityDigest: authority.digest,
      sourceBindingDigest: `sha256:${'a'.repeat(64)}`,
      createdAt: 100,
    });
    expect(JSON.stringify(blocker)).not.toContain('private objective');
    await expect(new FileDataGovernanceAuthorityRepository(directory).listBlockers('project-1'))
      .resolves.toEqual([blocker]);
  });
});

function projectAuthority() {
  const recipients = createDisclosureRecipientSetSnapshot({
    revision: 3,
    recipients: [{
      principalId: 'principal:model-provider', tenantId: 'tenant-1', projectId: 'project-1',
      clearance: 'confidential',
    }],
  });
  const destination = createProcessingDestinationContract({
    id: 'destination:model', owner: 'owner:ai', endpoint: 'model://provider-1',
    tenantId: 'tenant-1', projectId: 'project-1', trustDomain: 'trust:processor',
    processingRegions: ['ap-southeast-1'], maxConfidentiality: 'confidential',
    allowedCategories: ['customer_content'], external: true, noTraining: true,
    loggingMode: 'metadata_only', maximumRetentionSeconds: 60, allowsRedisclosure: false,
    supportsDeletion: true, recipientSnapshotRevision: recipients.revision,
    recipientSnapshotDigest: recipients.digest,
  });
  const registry = createDataCategoryRegistrySnapshot({
    id: 'registry:tenant-1', revision: 2, tenantId: 'tenant-1',
    kindFloors: { source_message: 'project_internal', projection_payload: 'project_internal' },
    categories: { customer_content: { confidentialityFloor: 'confidential' } },
  });
  const policy = createDataGovernancePolicySnapshot({
    id: 'policy:project-1', revision: 4, tenantId: 'tenant-1', projectId: 'project-1',
    destinations: { [destination.id]: destination },
    channelCeilings: {
      context_view: 'confidential', evidence_port: 'confidential', workroom_projection: 'project_internal',
      sponsor_projection: 'confidential', console: 'confidential', model_provider: 'confidential', a2a: 'confidential',
    },
    transforms: {}, externalApprovalFloor: 'restricted',
  });
  const candidate = {
    version: 1, revision: 1, projectId: 'project-1', tenantId: 'tenant-1',
    categoryRegistry: registry, policy,
    planning: {
      destinationId: destination.id, recipients,
      principal: { role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'] },
      source: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['orchestration'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'operational', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
        requestedMode: 'full', linkPrincipalAsSubject: true,
      },
    },
    remote: {}, sinks: {}, derivedPayloads: {},
    approvals: [],
  } as const;
  return createProjectDataGovernanceAuthority({
    ...candidate,
    governanceDecision: {
      decisionId: 'governance:decision-1', projectId: 'project-1',
      candidateDigest: digestCanonicalWorkroomValue(candidate),
      principalId: 'principal:data-steward', authorizedBy: 'data_steward', decidedAt: 1,
    },
  });
}
