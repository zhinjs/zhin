import {
  WorkroomAssignmentAuthorityGrantApplication,
  type WorkroomAssignmentGrantClaimPreview,
} from '../../src/workroom/assignment-authority-grant-application.js';
import {
  MemoryAssignmentAuthorityGrantRepository,
  assignmentAuthorityGrantKey,
} from '../../src/workroom/assignment-authority-grant-repository.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

const SHA = `sha256:${'a'.repeat(64)}`;
const request = {
  operationId: 'decision:1', projectId: 'project', runId: 'run', taskKey: 'task',
  agentDefinitionId: 'developer', endpointId: 'endpoint',
};

describe('WorkroomAssignmentAuthorityGrantApplication', () => {
  it('persists a disclosure blocker and promotes the same exact Assignment after repair', async () => {
    const repository = new MemoryAssignmentAuthorityGrantRepository();
    let disclosureReady = false;
    const application = new WorkroomAssignmentAuthorityGrantApplication({
      generation: 7,
      repository,
      preview: { resolve: async () => preview() },
      authority: { materialize: async () => authority() },
      workspace: { allocate: async () => workspace() },
      disclosure: {
        materialize: async input => disclosureReady ? disclosure(input.assignmentId) : null,
      },
      now: () => 1_000,
      blockerTtlMs: 30_000,
    });

    const blocked = await application.prepare(request);
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') throw new Error('expected blocker');
    expect(blocked.record.blocker?.kind).toBe('disclosure');
    expect(blocked.record.revision).toBe(1);

    disclosureReady = true;
    const ready = await application.prepare(request);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('expected ready');
    expect(ready.record.revision).toBe(2);
    expect(ready.grant.disclosureManifest?.manifest.id)
      .toBe(`disclosure-manifest:${ready.grant.disclosureManifest?.manifest.digest}`);
    expect((await application.prepare(request)).record.digest).toBe(ready.record.digest);
  });

  it('fails closed and records capability blockers for stale generation/Profile/fence inputs', async () => {
    const repository = new MemoryAssignmentAuthorityGrantRepository();
    const application = new WorkroomAssignmentAuthorityGrantApplication({
      generation: 8,
      repository,
      preview: { resolve: async () => preview() },
      authority: { materialize: async () => authority() },
      workspace: { allocate: async () => ({ ...workspace(), fence: 6 }) },
      disclosure: { materialize: async input => disclosure(input.assignmentId) },
      now: () => 1_000,
    });
    const result = await application.prepare(request);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('expected blocked');
    expect(result.record.blocker).toMatchObject({ kind: 'capability' });
    expect(await repository.read(assignmentAuthorityGrantKey({
      ...preview(),
      requestedAgentDefinitionId: request.agentDefinitionId,
      requestedEndpointId: request.endpointId,
    }))).toEqual(result.record);
  });
});

function preview(): WorkroomAssignmentGrantClaimPreview {
  return {
    projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
    assignmentId: 'assignment', assignmentRevision: 1, attempt: 1, fence: 7,
    operationId: 'decision:1', agentDefinitionId: 'developer', endpointId: 'endpoint',
    generation: 7,
    profileRevisionId: 'profile:1', profileDigest: SHA,
    catalogRevision: 'a'.repeat(64), catalogBindingDigest: SHA,
    role: 'executor',
    plan: { ref: 'plan:1', revision: 1, digest: SHA },
    taskCapabilityRequirements: { tools: ['bash'], skills: [], integrations: [], authorities: [] },
    factAnchor: { ref: 'workroom-journal:run:4', sequence: 4, digest: SHA },
  };
}

function authority() {
  return {
    principalId: 'agent:developer',
    capabilitySnapshotRef: 'capability:1', capabilitySnapshotRevision: 1,
    roleCapabilities: ceiling('role'), taskCapabilities: ceiling('task'),
    policyCapabilities: ceiling('policy'),
    authorizedIntegrations: [], authorizedAuthorities: [],
    contextPolicy: { ref: 'context-policy:1', revision: 1, digest: SHA },
    policySnapshot: { ref: 'policy:1', revision: 1, digest: SHA },
    contextView: { ref: 'context:1', hash: SHA },
    capabilityGrantRef: 'capability-grant:1',
    endpointAuthorityDigest: SHA,
    expiresAt: 9_000,
  };
}

function workspace() {
  return {
    workspace: { leaseRef: 'lease:1', mountRef: '/workspace', baseRevision: 'base', fence: 7 },
    remoteWorkspace: {
      provider: 'github' as const, repositoryId: 'repo', integrationBindingId: 'integration',
      worktreeRef: 'worktree:1', baseSha: 'base', fence: 7,
    },
    expiresAt: 8_000,
  };
}

function disclosure(assignmentId: string) {
  const projection = {
    version: 1 as const,
    requestDigest: SHA,
    source: {
      objectId: 'context:1', payloadHash: SHA, descriptorDigest: SHA, lineageDigest: SHA,
      handle: handle('context:1'),
    },
    output: { handle: handle('output:1'), payloadHash: SHA, mode: 'full' as const, subjectLinked: false },
    channel: 'a2a' as const,
    purpose: 'remote_execution' as const,
    principal: { principalId: 'agent:developer', assignmentId },
    destination: {
      id: 'endpoint', contractDigest: SHA, recipientRevision: 1, recipientDigest: SHA,
      loggingMode: 'metadata_only' as const, allowsRedisclosure: false, supportsDeletion: true,
    },
    policy: { revision: 1, digest: SHA }, approvalIds: [], expiresAt: 7_000,
  };
  const digest = digestCanonicalWorkroomValue(projection);
  return { ...projection, id: `disclosure-manifest:${digest}`, digest };
}

function handle(objectId: string) {
  return {
    version: 1 as const, vaultObjectId: `vault:${objectId}`, objectId, payloadHash: SHA,
    descriptorDigest: SHA, tenantId: 'tenant', projectId: 'project', locationManifestDigest: SHA,
  };
}

function ceiling(id: string) {
  return { id, revision: 1, tools: [{ name: 'bash', digest: SHA }], skills: [] };
}
