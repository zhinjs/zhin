import { describe, expect, it } from 'vitest';
import {
  createWorkroomAssignmentAuthorityGrant,
  createWorkroomGenerationAuthoritySnapshot,
  digestWorkroomCatalogProjectBinding,
  digestWorkroomRemoteEndpointAuthority,
  GenerationOwnedWorkroomAssignmentAuthorityProvider,
} from '../../src/plugin-runtime/workroom-assignment-authority-provider.js';
import { MemoryProjectProfileJournal, ProjectProfileRegistry } from '../../src/workroom/profile-registry.js';
import type { WorkroomCatalogSnapshot } from '../../src/workroom/catalog.js';
import type { WorkroomRemoteAssignmentAuthorityInput } from '../../src/workroom/remote-assignment-issuance.js';
import { WORKROOM_A2A_EXTENSION_URI } from '../../src/workroom/remote-dispatch.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import { remoteDisclosureFixture } from '../workroom/remote-disclosure-fixture.js';
import { compileWorkroomProfile, type CapabilityPack } from '../../src/workroom/profile-compiler.js';

const SHA = (value: string): string => `sha256:${value.repeat(64)}`;

describe('generation-owned Workroom Assignment authority provider', () => {
  it('composes only the exact persisted Run Profile pin, generation supply, Project member, grant and endpoint', async () => {
    const fixture = await createFixture();

    await expect(fixture.provider.resolve(fixture.input)).resolves.toMatchObject({
      principalId: 'agent:developer',
      role: 'executor',
      agentDefinitionId: 'developer',
      endpoint: { id: 'remote-dev', cardDigest: SHA('7'), authBindingId: 'auth-dev' },
      workspace: { fence: 4, baseRevision: SHA('8') },
      remoteWorkspace: { fence: 4, baseSha: SHA('8') },
    });

    const resolved = await fixture.provider.resolve(fixture.input);
    expect(resolved.capabilitySnapshot.ref).toBe('capability:assignment-1:1');
    expect(resolved.capabilitySnapshot.revision).toBe(1);
    expect(resolved.capabilitySnapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('fails closed when a Run is not pinned even though the Project has an active Profile', async () => {
    const fixture = await createFixture({ pinRun: false });
    await expect(fixture.provider.resolve(fixture.input)).rejects.toThrow('exact Run Profile pin');
  });

  it('fails closed when the current generation Agent digest drifts from the pinned Profile', async () => {
    const fixture = await createFixture({ agentDigest: SHA('e') });
    await expect(fixture.provider.resolve(fixture.input)).rejects.toThrow('generation Agent');
  });

  it.each([
    ['grant', { omitGrant: true }, 'issuance grant'],
    ['endpoint', { omitEndpoint: true }, 'endpoint authority'],
    ['disclosure', { omitDisclosure: true }, 'Disclosure Manifest'],
    ['workspace', { omitWorkspace: true }, 'Workspace grant'],
  ] as const)('fails closed without an exact %s authority', async (_name, options, message) => {
    const fixture = await createFixture(options);
    await expect(fixture.provider.resolve(fixture.input)).rejects.toThrow(message);
  });
});

interface FixtureOptions {
  pinRun?: boolean;
  agentDigest?: string;
  omitGrant?: boolean;
  omitEndpoint?: boolean;
  omitDisclosure?: boolean;
  omitWorkspace?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const journal = new MemoryProjectProfileJournal();
  const registry = new ProjectProfileRegistry(journal, {
    authorize: async input => ({
      ...input,
      approved: true,
      decisionId: 'decision-1',
      route: 'sponsor',
      outcome: 'approved',
      decidedBy: 'sponsor-1',
    }),
  });
  const pack: CapabilityPack = {
    id: 'software', version: '1.0.0', digest: SHA('a'), kind: 'domain',
    tools: [{ id: 'read_file', digest: SHA('1') }],
    skills: [{ id: 'typescript', digest: SHA('2'), requiresTools: ['read_file'] }],
    agents: [{
      id: 'developer', digest: SHA('3'), role: 'executor',
      allowedTools: ['read_file'], allowedSkills: ['typescript'],
    }],
    workflows: [], memories: [], glossaries: [], acceptancePolicies: [],
  };
  const compiled = compileWorkroomProfile({
    revision: {
      id: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: ['read_file'], enabledSkills: ['typescript'], enabledAgents: ['developer'],
      enabledWorkflows: [], enabledMemories: [], enabledGlossaries: [], enabledAcceptancePolicies: [],
    },
    packs: [pack],
    generationSupply: {
      tools: [{ id: 'read_file', digest: SHA('1') }],
      skills: [{ id: 'typescript', digest: SHA('2') }],
      agents: [{ id: 'developer', digest: SHA('3') }],
    },
  });
  if (!compiled.ok) throw new Error(`Profile fixture must compile: ${JSON.stringify(compiled.diagnostics)}`);
  const profile = compiled.profile;
  const compiledDigest = profile.digest;
  await registry.registerRevision({
    projectId: 'project-1', expectedRegistryRevision: -1,
    revision: {
      revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
      packRefs: profile.packRefs, overlayDigest: SHA('5'), compiledDigest,
      compiledProfile: profile,
      source: { kind: 'sponsor_decision', sourceId: 'decision-1' },
    },
  });
  await registry.activateRevision({
    projectId: 'project-1', expectedRegistryRevision: 0,
    revisionId: 'profile-1', compiledDigest,
  });
  if (options.pinRun !== false) {
    await registry.pinRun({ projectId: 'project-1', runId: 'run-1', expectedRegistryRevision: 1 });
  }

  const catalog: WorkroomCatalogSnapshot = Object.freeze({
    revision: '6'.repeat(64),
    definitions: Object.freeze({
      'project-1': Object.freeze({
        name: 'Project One', enabled: true,
        members: Object.freeze([
          Object.freeze({ agent: 'orchestrator', role: 'orchestrator' as const }),
          Object.freeze({ agent: 'developer', role: 'executor' as const }),
        ]),
        conversation: Object.freeze({
          adapter: 'github', endpoint: 'github-main', kind: 'repository' as const,
          id: 'owner/repo', agent: 'orchestrator',
        }),
      }),
    }),
  });
  const generation = createWorkroomGenerationAuthoritySnapshot({
    generation: 9,
    tools: [{ name: 'read_file', digest: SHA('1') }],
    skills: [{ name: 'typescript', digest: SHA('2') }],
    agents: [{ id: 'developer', digest: options.agentDigest ?? SHA('3') }],
  });
  const input: WorkroomRemoteAssignmentAuthorityInput = Object.freeze({
    projectId: 'project-1', runId: 'run-1',
    task: Object.freeze({
      key: 'build', revision: 2,
      acceptanceContract: Object.freeze({ id: 'acceptance-1', revision: 1, digest: SHA('9'), criteria: [] }),
    }),
    assignment: Object.freeze({ id: 'assignment-1', revision: 1, attempt: 1, fence: 4 }),
    requestedAgentDefinitionId: 'developer', requestedEndpointId: 'remote-dev',
    factAnchor: Object.freeze({ ref: 'journal:run-1:12', sequence: 12, digest: SHA('b') }),
  });
  const endpointAuthority = Object.freeze({
    generation: 9,
    transportBindingDigest: SHA('7'),
    endpoint: Object.freeze({
      id: 'remote-dev', owner: 'tenant-1', cardDigest: SHA('7'), authBindingId: 'auth-dev',
      workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true, typedCompletionEnvelope: true,
      workspaceProviders: Object.freeze(['github_pull_request']),
    }),
  });
  const grant = createWorkroomAssignmentAuthorityGrant({
    generation: 9,
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 2,
    assignmentId: 'assignment-1', assignmentRevision: 1, attempt: 1, fence: 4,
    agentDefinitionId: 'developer', endpointId: 'remote-dev',
    endpointAuthorityDigest: digestWorkroomRemoteEndpointAuthority(endpointAuthority),
    catalogRevision: '6'.repeat(64),
    catalogBindingDigest: digestWorkroomCatalogProjectBinding(catalog.definitions['project-1']!),
    profileRevisionId: 'profile-1', profileDigest: compiledDigest,
    principalId: 'agent:developer', role: 'executor',
    capabilitySnapshotRef: 'capability:assignment-1:1', capabilitySnapshotRevision: 1,
    roleCapabilities: ceiling('role:executor', 1),
    taskCapabilities: ceiling('task:build:2', 2),
    policyCapabilities: ceiling('policy:software:1', 1),
    plan: { ref: 'plan:run-1:1', revision: 1, digest: SHA('c') },
    contextPolicy: { ref: 'context-policy:run-1:1', revision: 1, digest: SHA('d') },
    policySnapshot: { ref: 'profile-policy:profile-1', revision: 1, digest: SHA('e') },
    ...(options.omitWorkspace ? {} : {
      workspace: { leaseRef: 'workspace-lease:assignment-1:4', mountRef: 'workspace:owner/repo', baseRevision: SHA('8'), fence: 4 },
      remoteWorkspace: {
        provider: 'github_pull_request' as const, repositoryId: 'owner/repo',
        integrationBindingId: 'github-main', baseSha: SHA('8'), targetRef: 'refs/heads/main',
        branchRef: 'refs/heads/workroom/assignment-1-4', pathScope: ['packages/im/agent'],
        mode: 'branch_and_pr' as const, fence: 4,
      },
    }),
    contextView: { ref: 'context-view:assignment-1', hash: SHA('f') },
    capabilityGrantRef: 'capability-grant:assignment-1:1',
    ...(options.omitDisclosure ? {} : {
      disclosureManifest: remoteDisclosureFixture({
        assignmentId: 'assignment-1', endpointId: 'remote-endpoint',
        principalId: 'agent:developer', sourceRef: 'context-view:assignment-1', sourceDigest: SHA('f'),
      }),
    }),
  });
  const provider = new GenerationOwnedWorkroomAssignmentAuthorityProvider({
    generation,
    profiles: registry,
    catalog: { read: async () => catalog },
    grants: {
      resolve: async () => options.omitGrant ? undefined : grant,
    },
    endpoints: {
      resolve: async endpointId => options.omitEndpoint || endpointId !== 'remote-dev'
        ? undefined
        : endpointAuthority,
    },
  });
  return { provider, input };
}

function ceiling(id: string, revision: number) {
  return {
    id, revision,
    tools: [{ name: 'read_file', digest: SHA('1') }],
    skills: [{ name: 'typescript', digest: SHA('2'), requiredTools: ['read_file'] }],
  } as const;
}
