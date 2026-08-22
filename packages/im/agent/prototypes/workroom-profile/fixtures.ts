import type {
  AgentDefinition,
  CapabilityPack,
  PackRef,
  WorkroomProfileRevision,
} from './profile-governance.ts';
import { packKey } from './profile-governance.ts';

const evidenceAgents: readonly AgentDefinition[] = [];

export const evidenceCompetency: CapabilityPack = {
  id: 'competency.evidence', version: 1, kind: 'competency', digest: 'sha256:competency-evidence-v1',
  agents: evidenceAgents,
  skills: [{ id: 'skill:evidence-analysis', digest: 'sha256:skill-evidence-analysis-v1', requiresTools: ['tool:evidence.read'] }],
};

export const baselinePolicy: CapabilityPack = {
  id: 'policy.workroom-baseline', version: 1, kind: 'policy', digest: 'sha256:policy-workroom-baseline-v1',
  policy: { reviewerFloor: 'medium', autoAcceptanceGrants: ['accept:low-mechanical'] },
};

export const softwareDomain: CapabilityPack = {
  id: 'domain.software-development', version: 1, kind: 'domain', digest: 'sha256:domain-software-v1',
  requires: [{ id: evidenceCompetency.id, version: evidenceCompetency.version, digest: evidenceCompetency.digest }],
  skills: [{ id: 'skill:software-implementation', digest: 'sha256:skill-software-v1', requiresTools: ['tool:repo.read', 'tool:repo.write', 'tool:test.run'] }],
  agents: [
    agent('software.researcher', 'researcher', ['tool:evidence.read', 'tool:repo.read'], ['skill:evidence-analysis'], ['integration:github'], []),
    agent('software.developer', 'developer', ['tool:repo.read', 'tool:repo.write', 'tool:test.run'], ['skill:software-implementation'], ['integration:github'], []),
    agent('software.reviewer', 'reviewer', ['tool:evidence.read', 'tool:repo.read', 'tool:test.run'], ['skill:evidence-analysis'], ['integration:github'], []),
    agent('software.integrator', 'integration', ['tool:repo.read', 'tool:git.create-pr'], [], ['integration:github'], ['authority:canonical-write']),
  ],
  workflows: [{
    id: 'workflow:software-change', digest: 'sha256:workflow-software-change-v1', requiredByProfile: true,
    tasks: [
      { key: 'research', role: 'researcher', requires: { tools: ['tool:repo.read'], skills: ['skill:evidence-analysis'], integrations: ['integration:github'] } },
      { key: 'implement', role: 'developer', dependsOn: ['research'], requires: { skills: ['skill:software-implementation'], integrations: ['integration:github'] } },
      { key: 'review', role: 'reviewer', dependsOn: ['implement'], requires: { tools: ['tool:repo.read', 'tool:test.run'], skills: ['skill:evidence-analysis'], integrations: ['integration:github'] } },
      { key: 'integrate', role: 'integration', dependsOn: ['review'], requires: { tools: ['tool:git.create-pr'], integrations: ['integration:github'], authorities: ['authority:canonical-write'] } },
    ],
  }],
  memorySchema: [
    { key: 'canonical_branch', type: 'string', required: true },
    { key: 'test_contract', type: 'string', required: false },
  ],
  glossary: [
    { term: 'Change Set', definition: 'An immutable patch artifact produced from an isolated Assignment workspace.' },
    { term: 'Integration Task', definition: 'A Task that applies accepted Change Sets to a candidate target.' },
  ],
};

export const githubIntegration: CapabilityPack = {
  id: 'integration.github-workspace', version: 1, kind: 'integration', digest: 'sha256:integration-github-v1',
  tools: [
    tool('tool:evidence.read'), tool('tool:repo.read'), tool('tool:repo.write', false, true),
    tool('tool:test.run'), tool('tool:git.create-pr', true, true),
  ],
  integrations: [{
    id: 'integration:github', digest: 'sha256:github-binding-v1', external: true,
    tools: ['tool:repo.read', 'tool:repo.write', 'tool:test.run', 'tool:git.create-pr'],
  }],
};

export const engineeringPolicy: CapabilityPack = {
  id: 'policy.engineering', version: 1, kind: 'policy', digest: 'sha256:policy-engineering-v1',
  policy: { reviewerFloor: 'medium' },
};

export const contentDomain: CapabilityPack = {
  id: 'domain.content-production', version: 1, kind: 'domain', digest: 'sha256:domain-content-v1',
  requires: [{ id: evidenceCompetency.id, version: evidenceCompetency.version, digest: evidenceCompetency.digest }],
  skills: [
    { id: 'skill:content-writing', digest: 'sha256:skill-content-writing-v1', requiresTools: ['tool:library.read', 'tool:document.write'] },
    { id: 'skill:editorial-review', digest: 'sha256:skill-editorial-review-v1', requiresTools: ['tool:document.read'] },
  ],
  agents: [
    agent('content.researcher', 'researcher', ['tool:evidence.read', 'tool:library.read'], ['skill:evidence-analysis'], ['integration:content-library'], []),
    agent('content.writer', 'writer', ['tool:library.read', 'tool:document.write'], ['skill:content-writing'], ['integration:content-library'], []),
    agent('content.editor', 'editor', ['tool:document.read'], ['skill:editorial-review'], [], []),
    agent('content.publisher', 'integration', ['tool:document.read', 'tool:publish.article'], [], ['integration:publisher'], ['authority:external-publish']),
  ],
  workflows: [{
    id: 'workflow:editorial', digest: 'sha256:workflow-editorial-v1', requiredByProfile: true,
    tasks: [
      { key: 'research', role: 'researcher', requires: { tools: ['tool:library.read'], skills: ['skill:evidence-analysis'], integrations: ['integration:content-library'] } },
      { key: 'draft', role: 'writer', dependsOn: ['research'], requires: { skills: ['skill:content-writing'], integrations: ['integration:content-library'] } },
      { key: 'edit', role: 'editor', dependsOn: ['draft'], requires: { skills: ['skill:editorial-review'] } },
      { key: 'publish', role: 'integration', dependsOn: ['edit'], requires: { tools: ['tool:publish.article'], integrations: ['integration:publisher'], authorities: ['authority:external-publish'] } },
    ],
  }],
  memorySchema: [
    { key: 'audience', type: 'string', required: true },
    { key: 'editorial_voice', type: 'string', required: false },
  ],
  glossary: [
    { term: 'Editorial Brief', definition: 'The accepted audience, intent, voice, and delivery constraints for one content Run.' },
    { term: 'Publication Candidate', definition: 'An accepted content artifact that has not yet been externally published.' },
  ],
};

export const contentIntegration: CapabilityPack = {
  id: 'integration.content-library', version: 1, kind: 'integration', digest: 'sha256:integration-content-v1',
  tools: [
    tool('tool:evidence.read'), tool('tool:library.read', true), tool('tool:document.read'),
    tool('tool:document.write', false, true), tool('tool:publish.article', true, true),
  ],
  integrations: [
    { id: 'integration:content-library', digest: 'sha256:content-library-v1', external: true, tools: ['tool:library.read', 'tool:document.read', 'tool:document.write'] },
    { id: 'integration:publisher', digest: 'sha256:publisher-v1', external: true, tools: ['tool:publish.article'] },
  ],
};

export const editorialPolicy: CapabilityPack = {
  id: 'policy.editorial', version: 1, kind: 'policy', digest: 'sha256:policy-editorial-v1',
  policy: { reviewerFloor: 'medium' },
};

export const socialDistributionIntegration: CapabilityPack = {
  id: 'integration.social-distribution', version: 1, kind: 'integration', digest: 'sha256:integration-social-v1',
  tools: [tool('tool:social.publish', true, true)],
  integrations: [{
    id: 'integration:social-distribution', digest: 'sha256:social-distribution-v1', external: true,
    tools: ['tool:social.publish'],
  }],
};

export const catalog = Object.freeze(Object.fromEntries([
  evidenceCompetency, baselinePolicy,
  softwareDomain, githubIntegration, engineeringPolicy,
  contentDomain, contentIntegration, editorialPolicy,
  socialDistributionIntegration,
].map((pack) => [packKey(pack), pack])));

export function softwareProfile(id = 'profile:software@1'): WorkroomProfileRevision {
  return {
    id, projectId: 'project:zhin', version: 1,
    charter: { id: 'charter:zhin@1', objective: 'Evolve Zhin without bypassing acceptance or workspace isolation.', constraints: ['Journal is the only Workroom state authority.'] },
    packs: refs(softwareDomain, evidenceCompetency, githubIntegration, baselinePolicy, engineeringPolicy),
    overlay: {
      enabledSkills: ['skill:evidence-analysis', 'skill:software-implementation'],
      enabledTools: ['tool:evidence.read', 'tool:repo.read', 'tool:repo.write', 'tool:test.run', 'tool:git.create-pr'],
      enabledIntegrations: ['integration:github'],
      authorityGrants: ['authority:canonical-write'],
    },
    sourceRefs: ['sponsor://profile-bootstrap/software'], proposedBy: 'human:sponsor',
  };
}

export function contentProfile(id = 'profile:content@1'): WorkroomProfileRevision {
  return {
    id, projectId: 'project:publication', version: 1,
    charter: { id: 'charter:publication@1', objective: 'Produce evidence-backed articles for an approved audience.', constraints: ['External publication requires Sponsor approval.'] },
    packs: refs(contentDomain, evidenceCompetency, contentIntegration, baselinePolicy, editorialPolicy),
    overlay: {
      enabledSkills: ['skill:evidence-analysis', 'skill:content-writing', 'skill:editorial-review'],
      enabledTools: ['tool:evidence.read', 'tool:library.read', 'tool:document.read', 'tool:document.write', 'tool:publish.article'],
      enabledIntegrations: ['integration:content-library', 'integration:publisher'],
      authorityGrants: ['authority:external-publish'],
    },
    sourceRefs: ['sponsor://profile-bootstrap/content'], proposedBy: 'human:sponsor',
  };
}

function agent(
  id: string,
  role: string,
  allowedTools: readonly string[],
  allowedSkills: readonly string[],
  allowedIntegrations: readonly string[],
  authorityCeiling: readonly string[],
): AgentDefinition {
  return { id, role, allowedTools, allowedSkills, allowedIntegrations, authorityCeiling };
}

function tool(id: string, external = false, mutating = false) {
  return { id, digest: `sha256:${id}:v1`, external, mutating };
}

function refs(...packs: readonly CapabilityPack[]): readonly PackRef[] {
  return packs.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest }));
}
