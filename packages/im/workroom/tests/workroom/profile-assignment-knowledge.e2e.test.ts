import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  MemoryProjectKnowledgeJournal,
  ProjectKnowledgeRegistry,
  createProjectKnowledgeEntry,
} from '../../src/workroom/project-knowledge-registry.js';
import { compileWorkroomProfile, type CapabilityPack } from '../../src/workroom/profile-compiler.js';
import { MemoryProjectProfileJournal, ProjectProfileRegistry } from '../../src/workroom/profile-registry.js';
import { WorkroomAssignmentKnowledgeContextProjector } from '../../src/workroom/workroom-assignment-knowledge-context.js';

describe('Profile → Run pin → Assignment Knowledge production path', () => {
  it('projects minimal software/content/support context and reauthorizes every body through P12', async () => {
    const domains = [
      { projectId: 'software', role: 'executor', taskKey: 'build', primary: 'runtime-contract', kind: 'memory' as const, body: 'Node 22 contract' },
      { projectId: 'content', role: 'executor', taskKey: 'edit', primary: 'editorial-glossary', kind: 'glossary' as const, body: 'Editorial terminology' },
      { projectId: 'customer-support', role: 'integration', taskKey: 'reply', primary: 'ticket-policy', kind: 'memory' as const, body: 'alice.high-risk@example.test' },
    ] as const;
    for (const domain of domains) {
      const fixture = await setupDomain(domain);
      const reads: string[] = [];
      const projector = new WorkroomAssignmentKnowledgeContextProjector({
        profiles: fixture.profiles,
        knowledge: fixture.knowledge,
        contentReader: {
          read: async input => {
            reads.push(`${input.assignmentId}:${input.handle.knowledgeId}`);
            return {
              body: domain.body,
              contentDigest: input.handle.governedContent.digest,
              authorizationDigest: digest({ assignmentId: input.assignmentId, handle: input.handle.entryDigest }),
            };
          },
        },
        publisher: {
          publish: async input => ({
            ref: `ephemeral-context://${input.assignmentId}`,
            hash: input.expectedHash,
          }),
        },
      });
      const request = {
        projectId: domain.projectId,
        runId: fixture.runId,
        taskKey: domain.taskKey,
        role: domain.role,
        profileRevisionId: fixture.profileRevisionId,
        profileDigest: fixture.profileDigest,
      };
      const first = await projector.materialize({
        request, assignmentId: `assignment:${domain.projectId}:1`, principalId: `agent:${domain.projectId}`,
      });
      const second = await projector.materialize({
        request, assignmentId: `assignment:${domain.projectId}:2`, principalId: `agent:${domain.projectId}`,
      });
      expect(first.projection.handles.map(value => value.knowledgeId)).toEqual([domain.primary]);
      expect(fixture.packIds).toContain('shared-governance');
      expect(second.projection.digest).toBe(first.projection.digest);
      expect(reads).toEqual([
        `assignment:${domain.projectId}:1:${domain.primary}`,
        `assignment:${domain.projectId}:2:${domain.primary}`,
      ]);
      const envelope = createAssignmentExecutionEnvelope({
        projectId: domain.projectId,
        runId: fixture.runId,
        taskKey: domain.taskKey,
        taskRevision: 1,
        assignmentId: `assignment:${domain.projectId}:1`,
        assignmentRevision: 1,
        attempt: 1,
        fence: 1,
        principalId: `agent:${domain.projectId}`,
        role: domain.role,
        agentDefinition: { ref: `agent:${domain.projectId}`, revision: 1, digest: digest({ agent: domain.projectId }) },
        plan: { ref: `plan:${domain.projectId}`, revision: 1, digest: digest({ plan: domain.projectId }) },
        contextPolicy: { ref: first.contextView.ref, revision: first.projection.knowledgeRevision + 1, digest: first.contextView.hash },
        factAnchor: { ref: `journal:${fixture.runId}`, sequence: 1, digest: digest({ run: fixture.runId }) },
        capabilitySnapshot: { ref: `capability:${domain.projectId}`, revision: 1, digest: fixture.profileDigest },
        policySnapshot: { ref: `policy:${domain.projectId}`, revision: 1, digest: digest({ policy: domain.projectId }) },
        workspace: { leaseRef: `lease:${domain.projectId}`, mountRef: `mount:${domain.projectId}`, baseRevision: 'base:1', fence: 1 },
      });
      expect(JSON.stringify(first.projection)).not.toContain(domain.body);
      expect(JSON.stringify(envelope)).not.toContain(domain.body);
      expect(first.projection.handles.every(handle => handle.governedContent.ref.startsWith(`vault://${domain.projectId}/`))).toBe(true);
    }
  });
});

async function setupDomain(domain: Readonly<{
  projectId: string;
  role: 'executor' | 'integration';
  taskKey: string;
  primary: string;
  kind: 'memory' | 'glossary';
}>) {
  const knowledgeJournal = new MemoryProjectKnowledgeJournal();
  const knowledge = new ProjectKnowledgeRegistry({
    journal: knowledgeJournal,
    generationView: { withCurrent: async (_input, use) => await use() },
    sourceAuthority: { verify: async () => true },
  });
  const primary = createProjectKnowledgeEntry({
    version: 1, projectId: domain.projectId, knowledgeId: domain.primary, kind: domain.kind,
    governedContent: { ref: `vault://${domain.projectId}/${domain.primary}`, digest: digest({ projectId: domain.projectId, content: domain.primary }) },
    schema: { ref: `schema://${domain.kind}/v1`, digest: digest({ kind: domain.kind, version: 1 }) },
    sensitivity: domain.projectId === 'customer-support' ? 'high' : 'standard', selectors: ['assignment'],
  });
  const excluded = createProjectKnowledgeEntry({
    version: 1, projectId: domain.projectId, knowledgeId: 'sponsor-only', kind: 'memory',
    governedContent: { ref: `vault://${domain.projectId}/sponsor-only`, digest: digest({ sponsor: domain.projectId }) },
    schema: { ref: 'schema://memory/v1', digest: digest({ kind: 'memory', version: 1 }) },
    sensitivity: 'restricted', selectors: ['sponsor'],
  });
  const otherTask = createProjectKnowledgeEntry({
    version: 1, projectId: domain.projectId, knowledgeId: 'other-task', kind: 'memory',
    governedContent: { ref: `vault://${domain.projectId}/other-task`, digest: digest({ otherTask: domain.projectId }) },
    schema: { ref: 'schema://memory/v1', digest: digest({ kind: 'memory', version: 1 }) },
    sensitivity: 'standard', selectors: ['assignment'],
  });
  const sourceBody = { kind: 'accepted_task_memory' as const, projectId: domain.projectId, sourceId: `memory:${domain.projectId}`, acceptanceId: `acceptance:${domain.projectId}` };
  await knowledge.publish({
    version: 1, generation: 1, operationId: `knowledge:${domain.projectId}`, projectId: domain.projectId,
    expectedRevision: -1, ownerPrincipalId: `owner:${domain.projectId}`,
    source: { ...sourceBody, digest: digest(sourceBody) }, entries: [primary, excluded, otherTask],
  }, new AbortController().signal);

  const pack: CapabilityPack = {
    id: `pack:${domain.projectId}`, version: '1', digest: digest({ pack: domain.projectId }), kind: 'domain',
    memories: [
      ...(domain.kind === 'memory' ? [{ id: primary.knowledgeId, digest: primary.digest, allowedRoles: [domain.role], taskKeys: [domain.taskKey] }] : []),
      { id: excluded.knowledgeId, digest: excluded.digest, allowedRoles: ['sponsor'], taskKeys: [] },
      { id: otherTask.knowledgeId, digest: otherTask.digest, allowedRoles: [domain.role], taskKeys: ['different-task'] },
    ],
    glossaries: domain.kind === 'glossary'
      ? [{ id: primary.knowledgeId, digest: primary.digest, allowedRoles: [domain.role], taskKeys: [domain.taskKey] }]
      : [],
  };
  const sharedPack: CapabilityPack = {
    id: 'shared-governance', version: '1', digest: digest({ pack: 'shared-governance', version: 1 }), kind: 'policy',
  };
  const profileRevisionId = `profile:${domain.projectId}:1`;
  const compiled = compileWorkroomProfile({
    revision: {
      id: profileRevisionId, projectId: domain.projectId, charterRevisionId: `charter:${domain.projectId}:1`,
      packs: [sharedPack, pack].map(({ id, version, digest: packDigest }) => ({ id, version, digest: packDigest })),
      enabledTools: [], enabledSkills: [], enabledAgents: [], enabledWorkflows: [],
      enabledMemories: pack.memories?.map(value => value.id) ?? [],
      enabledGlossaries: pack.glossaries?.map(value => value.id) ?? [],
    },
    packs: [sharedPack, pack], generationSupply: { tools: [], skills: [], agents: [] },
  });
  if (!compiled.ok) throw new Error(`Profile fixture failed: ${JSON.stringify(compiled.diagnostics)}`);
  const profileJournal = new MemoryProjectProfileJournal();
  const profiles = new ProjectProfileRegistry(profileJournal, {
    authorize: async input => ({
      ...input, approved: true, decisionId: `sponsor:${domain.projectId}:1`, route: 'sponsor',
      outcome: 'approved', decidedBy: `sponsor:${domain.projectId}`,
    }),
  });
  const source = { kind: 'accepted_task_memory' as const, sourceId: sourceBody.sourceId };
  let state = await profiles.registerRevision({
    projectId: domain.projectId, expectedRegistryRevision: -1,
    revision: {
      revisionId: profileRevisionId, projectId: domain.projectId,
      charterRevisionId: `charter:${domain.projectId}:1`, packRefs: compiled.profile.packRefs,
      overlayDigest: digest({ overlay: domain.projectId }), compiledDigest: compiled.profile.digest,
      compiledProfile: compiled.profile, source,
    },
  });
  state = await profiles.activateRevision({
    projectId: domain.projectId, expectedRegistryRevision: state.registryRevision,
    revisionId: profileRevisionId, compiledDigest: compiled.profile.digest,
  });
  const runId = `run:${domain.projectId}:1`;
  await profiles.pinRun({ projectId: domain.projectId, runId, expectedRegistryRevision: state.registryRevision });
  return {
    knowledge, profiles, runId, profileRevisionId, profileDigest: compiled.profile.digest,
    packIds: compiled.profile.packRefs.map(value => value.id),
  };
}
