#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #10. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  compileProfile,
  decideProfileProposal,
  draftRollbackRevision,
  initialProfileGovernance,
  pinRunProfile,
  proposeProfileRevision,
  resolveAssignmentCapabilities,
  type AssignmentCapabilitySnapshot,
  type ProfileGovernanceState,
  type WorkroomProfileRevision,
} from './profile-governance.ts';
import { catalog, contentProfile, socialDistributionIntegration, softwareProfile } from './fixtures.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const acceptedSources = ['acceptance://learning', 'acceptance://distribution', 'sponsor://rollback'];
const curator = { id: 'agent:profile-curator', role: 'profile_curator' } as const;
const policy = { id: 'profile-policy:v1', role: 'policy' } as const;
const sponsor = { id: 'human:sponsor', role: 'sponsor' } as const;
const rl = createInterface({ input, output });

let domain: 'software' | 'content' = 'software';
let state = resetState(domain);
let lastSnapshot: AssignmentCapabilitySnapshot | undefined;
let lastMessage = 'Inspect two domains that share one competency pack but no Project state.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === 's') load('software');
    else if (answer === 'c') load('content');
    else if (answer === 'm') resolveMinimal();
    else if (answer === 'k') safeLearning();
    else if (answer === 'p') pinRun();
    else if (answer === 'x') proposeExpansion();
    else if (answer === 'a') approveExpansion();
    else if (answer === 'r') rollback();
    else lastMessage = `Unknown action: ${answer || '(empty)'}`;
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function resetState(next: 'software' | 'content'): ProfileGovernanceState {
  return initialProfileGovernance(catalog, next === 'software' ? softwareProfile() : contentProfile(), acceptedSources);
}

function load(next: 'software' | 'content'): void {
  domain = next;
  state = resetState(next);
  lastSnapshot = undefined;
  lastMessage = `${next} Project loaded with an exact Profile Revision.`;
}

function resolveMinimal(): void {
  const profile = compileProfile(state.revisions[state.activeRevisionId]!, catalog);
  lastSnapshot = domain === 'software'
    ? resolveAssignmentCapabilities(profile, 'workflow:software-change', 'implement')
    : resolveAssignmentCapabilities(profile, 'workflow:editorial', 'draft');
  lastMessage = 'Assignment received only its Task requirement closure.';
}

function safeLearning(): void {
  const base = state.revisions[state.activeRevisionId]!;
  const draft: WorkroomProfileRevision = {
    ...base,
    id: `${base.id}:learned`, version: base.version + 1, parentRevisionId: base.id,
    overlay: {
      ...base.overlay,
      glossary: [...(base.overlay.glossary ?? []), { term: 'Accepted Learning', definition: 'Project knowledge backed by an Acceptance Record.' }],
      workflowParameters: { ...(base.overlay.workflowParameters ?? {}), learned: { evidence_depth: 'targeted' } },
    },
    sourceRefs: ['acceptance://learning'], proposedBy: curator.id,
  };
  state = proposeProfileRevision(state, curator, `proposal:learning:${draft.version}`, draft);
  state = decideProfileProposal(state, policy, `proposal:learning:${draft.version}`, 'activate', 'accepted and non-expansive');
  lastMessage = 'Pinned policy activated accepted knowledge/work method; immutable Packs were not edited.';
}

function pinRun(): void {
  const runId = `run:${domain}:${Object.keys(state.runPins).length + 1}`;
  state = pinRunProfile(state, runId);
  lastMessage = `${runId} pinned ${state.runPins[runId]}; later Profile changes cannot mutate it.`;
}

function proposeExpansion(): void {
  const base = state.revisions[state.activeRevisionId]!;
  const draft: WorkroomProfileRevision = {
    ...base,
    id: `${base.id}:expanded`, version: base.version + 1, parentRevisionId: base.id,
    packs: [...base.packs, { id: socialDistributionIntegration.id, version: socialDistributionIntegration.version, digest: socialDistributionIntegration.digest }],
    overlay: {
      ...base.overlay,
      enabledTools: [...(base.overlay.enabledTools ?? []), 'tool:social.publish'],
      enabledIntegrations: [...(base.overlay.enabledIntegrations ?? []), 'integration:social-distribution'],
      authorityGrants: [...(base.overlay.authorityGrants ?? []), 'authority:social-publish'],
      autoAcceptanceGrants: [...(base.overlay.autoAcceptanceGrants ?? []), 'accept:social-low-risk'],
    },
    sourceRefs: ['acceptance://distribution'], proposedBy: curator.id,
  };
  const id = `proposal:expansion:${draft.version}`;
  state = proposeProfileRevision(state, curator, id, draft);
  try {
    state = decideProfileProposal(state, policy, id, 'activate', 'policy attempted self-expansion');
  } catch {
    // Expected: keep approval_required for the user to inspect.
  }
  lastMessage = `${id} requires Sponsor: ${state.proposals[id]?.assessment.classes.join(', ')}`;
}

function approveExpansion(): void {
  const proposal = Object.values(state.proposals).reverse().find((item) => item.status === 'approval_required');
  if (!proposal) throw new Error('no Sponsor-gated proposal');
  state = decideProfileProposal(state, sponsor, proposal.id, 'activate', 'Sponsor approved exact expansion classes');
  lastMessage = `Sponsor activated ${proposal.draft.id}; existing Run pins are unchanged.`;
}

function rollback(): void {
  const active = state.revisions[state.activeRevisionId]!;
  const targetId = active.parentRevisionId;
  if (!targetId) throw new Error('active Profile has no prior revision');
  const draft = draftRollbackRevision(state, targetId, `${active.id}:rollback`, 'sponsor://rollback', sponsor.id);
  const id = `proposal:rollback:${draft.version}`;
  state = proposeProfileRevision(state, sponsor, id, draft);
  const actor = state.proposals[id]!.assessment.requiresSponsor ? sponsor : policy;
  state = decideProfileProposal(state, actor, id, 'activate', 'new revision restores a prior exact composition');
  lastMessage = `Rollback created ${draft.id}; history and Run pins remain intact.`;
}

function render(): void {
  console.clear();
  const profile = compileProfile(state.revisions[state.activeRevisionId]!, catalog);
  console.log(`${bold}Workroom Profile Governance — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Immutable Packs + Project Overlay → compiled Profile → minimal Assignment snapshot.${reset}\n`);
  console.log(`${bold}PROJECT / REVISION${reset}`);
  console.log(`  ${profile.revision.projectId} domain=${domain} active=${profile.revision.id}`);
  console.log(`  digest=${profile.digest.slice(0, 28)}… charter=${profile.revision.charter.id}`);
  console.log(`${bold}PACKS${reset}`);
  for (const pack of profile.packs) console.log(`  ${pack.kind.padEnd(11)} ${pack.id}@${pack.version}`);
  console.log(`${bold}COMPILED${reset}`);
  console.log(`  agents=${Object.keys(profile.agents).length} tools=${Object.keys(profile.tools).length} skills=${Object.keys(profile.skills).length} integrations=${Object.keys(profile.integrations).length}`);
  console.log(`  memory=${Object.keys(profile.memorySchema).join(', ')} glossary=${Object.keys(profile.glossary).join(', ')}`);
  for (const strategy of profile.strategies) console.log(`  strategy ${strategy.strategyId}: ${strategy.available ? 'available' : `BLOCKED ${strategy.reasons.join('; ')}`}`);
  console.log(`${bold}LAST ASSIGNMENT SNAPSHOT${reset}`);
  if (!lastSnapshot) console.log('  (none)');
  else {
    console.log(`  ${lastSnapshot.workflowId}/${lastSnapshot.taskKey} → ${lastSnapshot.agentDefinitionId}`);
    console.log(`  tools=${lastSnapshot.tools.join(', ') || '-'} skills=${lastSnapshot.skills.join(', ') || '-'}`);
    console.log(`  integrations=${lastSnapshot.integrations.join(', ') || '-'} authority=${lastSnapshot.authorities.join(', ') || '-'}`);
  }
  console.log(`${bold}GOVERNANCE${reset}`);
  for (const proposal of Object.values(state.proposals).slice(-3)) console.log(`  ${proposal.id}: ${proposal.status} [${proposal.assessment.classes.join(', ')}]`);
  for (const [runId, revisionId] of Object.entries(state.runPins)) console.log(`  pin ${runId} → ${revisionId}`);
  console.log(`${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [s] software [c] content [m] minimal Assignment [k] accepted learning [p] pin Run');
  console.log('  [x] propose expansion [a] Sponsor approve [r] rollback [q] quit');
}
