/** Executable scenarios for decision-map ticket #10 (not production tests). */
import assert from 'node:assert/strict';
import {
  compileProfile,
  decideProfileProposal,
  draftRollbackRevision,
  initialProfileGovernance,
  packKey,
  pinRunProfile,
  proposeProfileRevision,
  resolveAssignmentCapabilities,
  type WorkroomProfileRevision,
} from './profile-governance.ts';
import {
  catalog,
  contentProfile,
  evidenceCompetency,
  githubIntegration,
  socialDistributionIntegration,
  softwareProfile,
} from './fixtures.ts';

const curator = { id: 'agent:profile-curator', role: 'profile_curator' } as const;
const policy = { id: 'profile-policy:v1', role: 'policy' } as const;
const sponsor = { id: 'human:sponsor', role: 'sponsor' } as const;
const acceptedSources = [
  'acceptance://software/terminology',
  'acceptance://content/distribution-request',
  'sponsor://rollback',
];

// Two heterogeneous domains compile against the same Profile module and reuse
// an identical competency pack without sharing Project-local memory or glossary.
{
  const software = compileProfile(softwareProfile(), catalog);
  const content = compileProfile(contentProfile(), catalog);
  assert.equal(software.packs.find((pack) => pack.id === evidenceCompetency.id)?.digest, evidenceCompetency.digest);
  assert.equal(content.packs.find((pack) => pack.id === evidenceCompetency.id)?.digest, evidenceCompetency.digest);
  assert.equal(software.skills['skill:evidence-analysis']?.digest, content.skills['skill:evidence-analysis']?.digest);
  assert.equal(software.glossary['Editorial Brief'], undefined, 'content glossary must not leak into software Project');
  assert.equal(content.memorySchema.canonical_branch, undefined, 'software memory fields must not leak into content Project');
  assert.equal(software.strategies.every((item) => item.available), true);
  assert.equal(content.strategies.every((item) => item.available), true);
}

// Assignment snapshots contain only the Task requirement closure, never the
// complete Profile, Agent ceiling or sibling-domain capabilities.
{
  const software = compileProfile(softwareProfile(), catalog);
  const implementation = resolveAssignmentCapabilities(software, 'workflow:software-change', 'implement');
  assert.deepEqual(implementation.skills, ['skill:software-implementation']);
  assert.deepEqual(implementation.tools, ['tool:repo.read', 'tool:repo.write', 'tool:test.run']);
  assert.deepEqual(implementation.integrations, ['integration:github']);
  assert.deepEqual(implementation.authorities, []);
  assert.equal(implementation.tools.includes('tool:git.create-pr'), false);

  const content = compileProfile(contentProfile(), catalog);
  const writer = resolveAssignmentCapabilities(content, 'workflow:editorial', 'draft');
  assert.deepEqual(writer.skills, ['skill:content-writing']);
  assert.deepEqual(writer.tools, ['tool:document.write', 'tool:library.read']);
  assert.equal(writer.tools.includes('tool:publish.article'), false);
  assert.equal(writer.integrations.includes('integration:github'), false);
}

// A required Workflow Strategy fails compilation when a required integration
// capability disappears; the Orchestrator cannot silently run a degraded Plan.
{
  const brokenCatalog = { ...catalog };
  delete brokenCatalog[packKey(githubIntegration)];
  assert.throws(() => compileProfile(softwareProfile(), brokenCatalog), /Missing Capability Pack/u);
  const withoutWrite = softwareProfile('profile:software-broken');
  const broken: WorkroomProfileRevision = {
    ...withoutWrite,
    overlay: { ...withoutWrite.overlay, enabledTools: withoutWrite.overlay.enabledTools?.filter((id) => id !== 'tool:repo.write') },
  };
  assert.throws(() => compileProfile(broken, catalog), /requires unavailable Tool tool:repo.write/u);
}

// Accepted knowledge and non-expansive working-method changes may be activated
// by pinned policy, but discussion/unaccepted memory cannot propose a revision.
{
  let state = initialProfileGovernance(catalog, softwareProfile(), acceptedSources);
  const base = state.revisions[state.activeRevisionId]!;
  const safeDraft: WorkroomProfileRevision = {
    ...base,
    id: 'profile:software@2', version: 2, parentRevisionId: base.id,
    overlay: {
      ...base.overlay,
      glossary: [{ term: 'Acceptance Evidence', definition: 'Evidence bound to the exact candidate evaluated by policy.' }],
      memorySchema: [{ key: 'supported_node_versions', type: 'string[]', required: false }],
      workflowParameters: { 'workflow:software-change': { default_test_depth: 'targeted' } },
    },
    sourceRefs: ['acceptance://software/terminology'], proposedBy: curator.id,
  };
  state = proposeProfileRevision(state, curator, 'proposal:safe', safeDraft);
  assert.equal(state.proposals['proposal:safe']?.status, 'policy_eligible');
  assert.deepEqual([...state.proposals['proposal:safe']!.assessment.classes].sort(), ['knowledge', 'working_method']);
  state = decideProfileProposal(state, policy, 'proposal:safe', 'activate', 'accepted knowledge; no capability expansion');
  assert.equal(state.activeRevisionId, safeDraft.id);

  const untrusted = { ...safeDraft, id: 'profile:software@3-untrusted', version: 3, parentRevisionId: safeDraft.id, sourceRefs: ['discussion://agent/guess'] };
  assert.throws(() => proposeProfileRevision(state, curator, 'proposal:untrusted', untrusted), /accepted source refs/u);
}

// Adding Tool/external access/authority/automatic acceptance is explainably
// classified and cannot be self-authorized by Curator or policy.
{
  let state = initialProfileGovernance(catalog, contentProfile(), acceptedSources);
  state = pinRunProfile(state, 'run:article-1');
  const base = state.revisions[state.activeRevisionId]!;
  const riskyDraft: WorkroomProfileRevision = {
    ...base,
    id: 'profile:content@2', version: 2, parentRevisionId: base.id,
    packs: [...base.packs, { id: socialDistributionIntegration.id, version: socialDistributionIntegration.version, digest: socialDistributionIntegration.digest }],
    overlay: {
      ...base.overlay,
      enabledTools: [...(base.overlay.enabledTools ?? []), 'tool:social.publish'],
      enabledIntegrations: [...(base.overlay.enabledIntegrations ?? []), 'integration:social-distribution'],
      authorityGrants: [...(base.overlay.authorityGrants ?? []), 'authority:social-publish'],
      autoAcceptanceGrants: ['accept:social-low-risk'],
    },
    sourceRefs: ['acceptance://content/distribution-request'], proposedBy: curator.id,
  };
  state = proposeProfileRevision(state, curator, 'proposal:risky', riskyDraft);
  const assessment = state.proposals['proposal:risky']!.assessment;
  assert.equal(assessment.requiresSponsor, true);
  assert.equal(assessment.classes.includes('tool_expansion'), true);
  assert.equal(assessment.classes.includes('external_access_expansion'), true);
  assert.equal(assessment.classes.includes('authority_expansion'), true);
  assert.equal(assessment.classes.includes('auto_acceptance_expansion'), true);
  assert.throws(() => decideProfileProposal(state, policy, 'proposal:risky', 'activate', 'policy tried'), /Sponsor approval/u);
  state = decideProfileProposal(state, sponsor, 'proposal:risky', 'activate', 'approved exact Profile digest and expansion classes');
  assert.equal(state.activeRevisionId, riskyDraft.id);
  assert.equal(state.runPins['run:article-1'], base.id, 'in-flight Run must keep its pinned Profile revision');

  // Rollback creates a new revision and passes through the same governance. It
  // does not delete history or mutate the in-flight Run pin.
  const rollback = draftRollbackRevision(state, base.id, 'profile:content@3-rollback', 'sponsor://rollback', sponsor.id);
  state = proposeProfileRevision(state, sponsor, 'proposal:rollback', rollback);
  assert.equal(state.proposals['proposal:rollback']?.assessment.requiresSponsor, false, 'removing expansion is non-expansive');
  state = decideProfileProposal(state, policy, 'proposal:rollback', 'activate', 'restore prior exact pack/overlay set');
  assert.equal(state.activeRevisionId, rollback.id);
  assert.equal(state.revisions[rollback.id]?.restoredFromRevisionId, base.id);
  assert.equal(state.runPins['run:article-1'], base.id);
}

// Same canonical capability id with a different digest is a compile conflict,
// never last-writer-wins across packs.
{
  const conflictingPack = {
    id: 'integration.conflict', version: 1, kind: 'integration' as const, digest: 'sha256:conflict-pack',
    tools: [{ id: 'tool:repo.read', digest: 'sha256:different-implementation', external: true, mutating: false }],
  };
  const conflictCatalog = { ...catalog, [packKey(conflictingPack)]: conflictingPack };
  const base = softwareProfile('profile:software-conflict');
  const revision = { ...base, packs: [...base.packs, { id: conflictingPack.id, version: 1, digest: conflictingPack.digest }] };
  assert.throws(() => compileProfile(revision, conflictCatalog), /Tool conflict/u);
}

// Pack refs pin the digest, not merely an id/version label.
{
  const tampered = { ...catalog, [packKey(evidenceCompetency)]: { ...evidenceCompetency, digest: 'sha256:tampered-same-version' } };
  assert.throws(() => compileProfile(softwareProfile(), tampered), /digest mismatch/u);
}

console.log('workroom-profile scenarios: OK');
