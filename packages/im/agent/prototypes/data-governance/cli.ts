#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #12. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  applyTrustedTransform,
  dispatchGovernance,
  erasureStatus,
  evaluateDisclosure,
  initialGovernanceJournal,
  materializeDisclosure,
  replayGovernance,
  type DataGovernancePolicy,
  type DisclosureChannel,
  type DisclosureDecision,
  type DisclosureDestination,
  type DisclosurePurpose,
  type DisclosureRequest,
  type GovernanceEvent,
} from './data-governance.ts';
import {
  dataSteward,
  compliance,
  disclosureGateway,
  envelope,
  governanceKernel,
  ingressGateway,
  investmentDestinations,
  investmentObjects,
  investmentPolicy,
  privacyOperator,
  storageGateway,
  supportDestinations,
  supportObjects,
  supportPolicy,
} from './fixtures.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });

let domain: 'support' | 'investment' = 'support';
let policy: DataGovernancePolicy;
let destinations: Readonly<Record<string, DisclosureDestination>>;
let journal: readonly GovernanceEvent[];
let selected = 0;
let channel: DisclosureChannel = 'context_view';
let lastRequest: DisclosureRequest | undefined;
let lastDecision: DisclosureDecision | undefined;
let lastMessage = 'Every consumer asks the same policy; start by evaluating the selected object.';
resetDomain('support');

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    handle(answer);
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function resetDomain(next: 'support' | 'investment'): void {
  domain = next;
  policy = next === 'support' ? supportPolicy() : investmentPolicy();
  destinations = next === 'support' ? supportDestinations : investmentDestinations;
  journal = initialGovernanceJournal(policy);
  for (const value of next === 'support' ? supportObjects() : investmentObjects()) {
    journal = dispatchGovernance(journal, { type: 'register_object', actor: ingressGateway, input: value });
  }
  selected = 0;
  lastRequest = undefined;
  lastDecision = undefined;
  lastMessage = `${next} Profile loaded with governance policy v${policy.revision}.`;
}

function handle(key: string): void {
  const state = replayGovernance(journal);
  const objects = Object.values(state.objects);
  const object = objects[selected];
  if (key === '[' || key === ']') {
    selected = (selected + (key === '[' ? objects.length - 1 : 1)) % Math.max(1, objects.length);
    lastMessage = `Selected ${Object.values(state.objects)[selected]?.descriptor.objectId ?? '(none)'}.`;
    return;
  }
  if (key === 'S') return resetDomain('support');
  if (key === 'I') return resetDomain('investment');
  if (key === '1') channel = 'context_view';
  else if (key === '2') channel = 'workroom_projection';
  else if (key === '3') channel = 'sponsor_projection';
  else if (key === '4') channel = 'console';
  else if (key === '5') channel = 'a2a';
  else if (key === 'e') evaluate();
  else if (key === 'x') transform();
  else if (key === 'a') approve();
  else if (key === 'm') materialize();
  else if (key === 'h') placeHold();
  else if (key === 'r') releaseHold();
  else if (key === 'E') requestErasure();
  else if (key === 't') {
    journal = dispatchGovernance(journal, { type: 'advance_clock', actor: governanceKernel, ticks: 5 });
    lastMessage = 'Kernel clock advanced five ticks.';
  } else if (key === 'p') {
    journal = dispatchGovernance(journal, { type: 'plan_lifecycle', actor: governanceKernel });
    lastMessage = 'Lifecycle planner emitted eligible purge plans; holds/minimum retention remain binding.';
  } else if (key === 'g') confirmPurge();
  else if (key === 'R') {
    const copy = JSON.parse(JSON.stringify(journal)) as GovernanceEvent[];
    lastMessage = JSON.stringify(replayGovernance(copy)) === JSON.stringify(replayGovernance(journal))
      ? 'Replay check passed.' : 'Replay check FAILED.';
  } else lastMessage = `Unknown action: ${key || '(empty)'}`;

  if (['1', '2', '3', '4', '5'].includes(key)) {
    lastMessage = `Disclosure channel selected: ${channel}.`;
    lastRequest = undefined;
    lastDecision = undefined;
  }

  function evaluate(): void {
    if (!object) throw new Error('no Data Object selected');
    const destination = destinationFor(channel);
    const purpose = purposeFor(channel);
    const role = channel === 'context_view' ? 'executor'
      : channel === 'evidence_port' ? 'reviewer'
        : channel === 'sponsor_projection' ? 'sponsor'
          : channel === 'console' ? 'auditor'
            : 'projector';
    lastRequest = {
      objectId: object.descriptor.objectId,
      channel,
      purpose,
      envelope: envelope(policy, role, role === 'auditor' ? 'restricted' : 'confidential', [purpose],
        channel === 'sponsor_projection' ? { portfolioProjectIds: [policy.projectId] } : {}),
      destination,
      requestedMode: 'full',
    };
    lastDecision = evaluateDisclosure(state, lastRequest);
    lastMessage = `${lastDecision.disposition}: ${lastDecision.reasons.join(', ')}`;
  }

  function transform(): void {
    if (!object || !lastDecision?.requiredTransformId) throw new Error('evaluate a transform_required disclosure first');
    const outputId = `${object.descriptor.objectId}:via:${lastDecision.requiredTransformId}`;
    const transformed = applyTrustedTransform(object, lastDecision.requiredTransformId, outputId, state.now, policy);
    journal = dispatchGovernance(journal, { type: 'register_object', actor: ingressGateway, input: transformed });
    selected = Object.keys(replayGovernance(journal).objects).indexOf(outputId);
    lastRequest = undefined;
    lastDecision = undefined;
    lastMessage = `Trusted host transform created ${outputId}; source was not overwritten.`;
  }

  function approve(): void {
    if (!lastDecision || lastDecision.disposition !== 'approval_required') throw new Error('no exact disclosure approval is required');
    for (const role of lastDecision.requiredApprovalRoles) {
      journal = dispatchGovernance(journal, {
        type: 'record_disclosure_approval',
        actor: role === 'compliance' ? compliance : dataSteward,
        approval: {
          id: `approval:${role}:${lastDecision.requestDigest.slice(0, 8)}`,
          requestDigest: lastDecision.requestDigest,
          role,
          expiresAt: state.now + 2,
          decision: 'approved',
        },
      });
    }
    lastMessage = `Trusted principals recorded exact temporary approvals: ${lastDecision.requiredApprovalRoles.join(', ')}; evaluate again.`;
  }

  function materialize(): void {
    if (!lastRequest || !lastDecision) throw new Error('evaluate disclosure first');
    const currentDecision = evaluateDisclosure(state, lastRequest);
    const result = materializeDisclosure(state, lastRequest, currentDecision);
    journal = dispatchGovernance(journal, {
      type: 'record_manifest', actor: disclosureGateway, manifest: result.manifest,
    });
    lastDecision = currentDecision;
    lastMessage = `Materialized ${result.manifest.mode} output and recorded ${result.manifest.id}.`;
  }

  function placeHold(): void {
    if (!object) throw new Error('no Data Object selected');
    journal = dispatchGovernance(journal, {
      type: 'place_hold', actor: dataSteward,
      hold: {
        id: `hold:${object.descriptor.objectId}`, objectId: object.descriptor.objectId,
        owner: dataSteward.id, reason: 'prototype hold', reviewAt: state.now + 5,
      },
    });
    lastMessage = 'Retention Hold placed. It changes lifecycle only, never disclosure authority.';
  }

  function releaseHold(): void {
    const hold = Object.values(state.holds).find((item) => item.status === 'active' && item.objectId === object?.descriptor.objectId);
    if (!hold) throw new Error('selected object has no active hold');
    journal = dispatchGovernance(journal, { type: 'release_hold', actor: dataSteward, holdId: hold.id });
    lastMessage = `Released ${hold.id}.`;
  }

  function requestErasure(): void {
    const subjectRef = object?.descriptor.subjectRefs[0];
    if (!subjectRef) throw new Error('selected object has no linked data subject');
    journal = dispatchGovernance(journal, {
      type: 'request_erasure', actor: privacyOperator,
      request: {
        id: `erasure:${subjectRef}`, subjectRef, requestedBy: privacyOperator.id, requestedAt: state.now,
      },
    });
    lastMessage = `Erasure requested for pseudonymous subject ref ${subjectRef}.`;
  }

  function confirmPurge(): void {
    if (!object || object.status !== 'purge_pending') throw new Error('selected object has no Purge Plan');
    for (const location of Object.keys(object.locations)) {
      journal = dispatchGovernance(journal, {
        type: 'record_purge_receipt', actor: storageGateway,
        receipt: {
          id: `receipt:${object.descriptor.objectId}:${location}`,
          objectId: object.descriptor.objectId,
          location,
          outcome: 'purged',
        },
      });
    }
    lastMessage = 'All Payload Vault locations confirmed purge; content-free audit header remains.';
  }
}

function destinationFor(selectedChannel: DisclosureChannel): DisclosureDestination {
  if (selectedChannel === 'context_view') return destinations.localModel!;
  if (selectedChannel === 'workroom_projection') return destinations.workroom!;
  if (selectedChannel === 'sponsor_projection') return destinations.sponsor!;
  if (selectedChannel === 'console') return destinations.console!;
  if (selectedChannel === 'a2a') return destinations.a2a!;
  return destinations.console!;
}

function purposeFor(selectedChannel: DisclosureChannel): DisclosurePurpose {
  if (selectedChannel === 'context_view') return 'task_execution';
  if (selectedChannel === 'workroom_projection') return 'workroom_awareness';
  if (selectedChannel === 'sponsor_projection') return 'portfolio_oversight';
  if (selectedChannel === 'console') return 'audit';
  if (selectedChannel === 'a2a') return 'remote_execution';
  return 'acceptance_review';
}

function render(): void {
  console.clear();
  const state = replayGovernance(journal);
  const objects = Object.values(state.objects);
  console.log(`${bold}Data Governance — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Descriptor + current policy + envelope + purpose + destination → one disclosure decision.${reset}\n`);
  console.log(`${bold}PROFILE${reset} ${domain} policy=${policy.id}@${policy.revision} region=[${policy.allowedRegions.join(',')}] now=${state.now}`);
  console.log(`${bold}DATA OBJECTS${reset}`);
  objects.forEach((object, index) => {
    const marker = index === selected ? '▶' : ' ';
    const descriptor = object.descriptor;
    console.log(`${marker} ${descriptor.objectId} ${object.status} ${descriptor.kind} class=${descriptor.classification}`);
    console.log(`    categories=[${descriptor.categories.join(',') || '-'}] subjects=[${descriptor.subjectRefs.join(',') || '-'}] retain=${descriptor.minimumRetainUntil}..${descriptor.deleteAfter}`);
    console.log(`    sources=[${descriptor.sourceObjectIds.join(',') || '-'}] transform=${descriptor.transformRef ?? '-'} payload=${object.payload === undefined ? 'PURGED' : `${object.payload.length} chars`}`);
  });
  console.log(`${bold}DISCLOSURE${reset} channel=${channel}`);
  console.log(`  decision=${lastDecision?.disposition ?? '-'} digest=${lastDecision?.requestDigest.slice(0, 24) ?? '-'}`);
  console.log(`  transform=${lastDecision?.requiredTransformId ?? '-'} approvals=[${lastDecision?.requiredApprovalRoles.join(',') ?? '-'}]`);
  console.log(`${bold}LIFECYCLE${reset}`);
  for (const hold of Object.values(state.holds)) console.log(`  ${hold.id} ${hold.status} object=${hold.objectId} reviewAt=${hold.reviewAt}`);
  for (const request of Object.values(state.erasures)) console.log(`  ${request.id} subject=${request.subjectRef} status=${erasureStatus(state, request.id)}`);
  console.log(`  approvals=${Object.keys(state.approvals).length} manifests=${Object.keys(state.manifests).length} purgeReceipts=${Object.keys(state.receipts).length}`);
  console.log(`${bold}LAST EVENTS${reset}`);
  for (const entry of journal.slice(-6)) console.log(`  #${entry.seq} ${entry.type} actor=${entry.actor.role}`);
  console.log(`\n${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [S] support [I] investment [[]/[]] object [1] Context [2] Workroom [3] Sponsor [4] Console [5] A2A');
  console.log('  [e] evaluate [x] trusted transform [a] exact approval [m] materialize [h] hold [r] release');
  console.log('  [E] erasure [t] +5 [p] lifecycle plan [g] confirm purge [R] replay [q] quit');
}
