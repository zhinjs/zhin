#!/usr/bin/env node
/** PROTOTYPE TUI — decision-map ticket #5. */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  applyDeliveryResult,
  initialiseProjectionState,
  projectObservableFacts,
  retryDelivery,
  routeInbound,
  type IngressDecision,
} from './workroom-projection.ts';
import {
  architect,
  bindings,
  chatConversation,
  facts,
  orchestrator,
  secondArchitect,
  sponsorConversation,
  workroomConversation,
} from './fixtures.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const rl = createInterface({ input, output });
const items = projectObservableFacts(facts, bindings, { progressWindowSeconds: 15 }, 50);
let projection = initialiseProjectionState(items);
let lastDecision: IngressDecision | undefined;
let lastMessage = 'Kernel facts are projected; no IM delivery has changed Kernel state.';

while (true) {
  render();
  const answer = (await rl.question(`${bold}action>${reset} `)).trim();
  if (answer === 'q') break;
  try {
    if (answer === 'd') deliverMilestone();
    else if (answer === 'f') failAndRetryApproval();
    else if (answer === 'e') routeEcho();
    else if (answer === 'r') routeReply();
    else if (answer === 'm') routeMention(false);
    else if (answer === 'a') routeMention(true);
    else if (answer === 'u') routeUnaddressed();
    else if (answer === 's') routeSponsor(false);
    else if (answer === 'p') routeSponsor(true);
    else if (answer === 'c') routeChat();
    else lastMessage = `Unknown action: ${answer || '(empty)'}`;
  } catch (error) {
    lastMessage = `REJECTED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
rl.close();

function deliverMilestone(): void {
  const item = Object.values(projection.items).find((candidate) => candidate.sourceFactIds.includes('f6'));
  if (!item) throw new Error('milestone projection missing');
  projection = applyDeliveryResult(projection, item.id, { status: 'sent', platformMessageId: 'platform-milestone-1' });
  lastMessage = 'Delivered named Architect milestone and indexed reply provenance.';
}

function failAndRetryApproval(): void {
  const item = Object.values(projection.items).find((candidate) => candidate.sink === 'sponsor_im' && candidate.sourceFactIds.includes('f7'));
  if (!item) throw new Error('approval projection missing');
  if (item.deliveryStatus === 'pending') {
    projection = applyDeliveryResult(projection, item.id, { status: 'failed', code: 'rate_limited' });
    lastMessage = 'Delivery failed; Kernel approval fact remains unchanged. Press [f] again to retry.';
  } else if (item.deliveryStatus === 'failed') {
    projection = retryDelivery(projection, item.id);
    projection = applyDeliveryResult(projection, item.id, { status: 'sent', platformMessageId: 'platform-approval-1' });
    lastMessage = 'Retried the same idempotent outbox item and indexed the receipt.';
  } else lastMessage = 'Approval card is already delivered.';
}

function routeEcho(): void {
  ensureMilestoneDelivered();
  lastDecision = routeInbound(bindings, {}, projection, workroomInput({
    messageId: 'platform-milestone-1',
    fromEndpointSelf: true,
  }));
  lastMessage = 'Projected bot echo is ignored before Workroom ingress.';
}

function routeReply(): void {
  ensureMilestoneDelivered();
  lastDecision = routeInbound(bindings, { 'project-zhin': [architect, orchestrator] }, projection, workroomInput({
    messageId: 'human-reply',
    replyToMessageId: 'platform-milestone-1',
  }));
  lastMessage = 'Reply resolves exact assignment provenance but enters Orchestrator, not an Executor Turn.';
}

function routeMention(ambiguous: boolean): void {
  lastDecision = routeInbound(bindings, {
    'project-zhin': ambiguous ? [architect, secondArchitect] : [architect, orchestrator],
  }, projection, workroomInput({
    messageId: ambiguous ? 'ambiguous-mention' : 'exact-mention',
    logicalMention: ambiguous ? '@architect' : '@架构师',
  }));
  lastMessage = ambiguous ? 'Duplicate alias requires clarification.' : 'Project Agent Directory resolves the logical alias.';
}

function routeUnaddressed(): void {
  lastDecision = routeInbound(bindings, {}, projection, workroomInput({ messageId: 'unaddressed' }));
  lastMessage = 'Unaddressed Workroom input enters only the Orchestrator inbox.';
}

function routeSponsor(withTarget: boolean): void {
  if (withTarget) ensureApprovalDelivered();
  lastDecision = routeInbound(bindings, {}, projection, {
    conversation: sponsorConversation,
    conversationSequence: 51,
    messageId: withTarget ? 'sponsor-targeted' : 'sponsor-ambiguous',
    actorId: 'alice',
    actorName: 'Alice',
    actorRoles: ['sponsor'],
    text: '暂停这个项目',
    intent: 'control',
    ...(withTarget ? { replyToMessageId: 'platform-approval-1' } : {}),
  });
  lastMessage = withTarget ? 'Reply-derived Project target creates a control proposal.' : 'Untargeted Sponsor write requires clarification.';
}

function routeChat(): void {
  lastDecision = routeInbound(bindings, {}, projection, {
    ...workroomInput({ messageId: 'ordinary-chat' }),
    conversation: chatConversation,
  });
  lastMessage = 'Unbound address remains ordinary chat.';
}

function workroomInput(overrides: Record<string, unknown>) {
  return {
    conversation: workroomConversation,
    conversationSequence: 101,
    messageId: 'workroom-input',
    actorId: 'bob',
    actorName: 'Bob',
    actorRoles: ['participant'],
    text: '请补充兼容性证据',
    intent: 'discussion' as const,
    ...overrides,
  };
}

function ensureMilestoneDelivered(): void {
  if (!projection.messageIndex[Object.keys(projection.messageIndex).find((key) => key.endsWith('\0platform-milestone-1')) ?? '']) {
    deliverMilestone();
  }
}

function ensureApprovalDelivered(): void {
  const existing = Object.values(projection.items).find((item) => item.sourceFactIds.includes('f7') && item.sink === 'sponsor_im');
  if (!existing) throw new Error('approval projection missing');
  if (existing.deliveryStatus === 'pending') {
    projection = applyDeliveryResult(projection, existing.id, { status: 'sent', platformMessageId: 'platform-approval-1' });
  } else if (existing.deliveryStatus === 'failed') {
    projection = retryDelivery(projection, existing.id);
    projection = applyDeliveryResult(projection, existing.id, { status: 'sent', platformMessageId: 'platform-approval-1' });
  }
}

function render(): void {
  console.clear();
  const all = Object.values(projection.items);
  console.log(`${bold}Workroom / Sponsor Projection — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Kernel facts are authority. IM and Console are independently rebuildable projections.${reset}\n`);
  console.log(`${bold}SPACE BINDINGS${reset}`);
  for (const binding of bindings) console.log(`  ${binding.conversation.id} → ${binding.space} rev=${binding.revision} project=${binding.projectId ?? binding.projectIds?.join(',')}`);
  console.log(`${bold}PROJECTIONS${reset} console=${all.filter((item) => item.sink === 'console').length} workroom=${all.filter((item) => item.sink === 'workroom_im').length} sponsor=${all.filter((item) => item.sink === 'sponsor_im').length}`);
  for (const item of all.filter((candidate) => candidate.sink !== 'console')) {
    console.log(`  ${item.sink} ${item.kind} status=${item.deliveryStatus} attempts=${item.attempts} sources=[${item.sourceFactIds.join(',')}]`);
    console.log(`    ${item.content}`);
  }
  console.log(`${bold}MESSAGE INDEX${reset} ${Object.keys(projection.messageIndex).length} delivered messages with durable target provenance`);
  console.log(`${bold}LAST INGRESS DECISION${reset} ${lastDecision ? JSON.stringify(lastDecision) : '-'}`);
  console.log(`${bold}RESULT${reset} ${lastMessage}`);
  console.log(`\n${bold}COMMANDS${reset}`);
  console.log('  [d] deliver milestone [f] fail/retry Sponsor card [e] echo [r] reply');
  console.log('  [m] exact @Agent [a] ambiguous alias [u] unaddressed Workroom');
  console.log('  [s] untargeted Sponsor control [p] reply-targeted Sponsor control [c] ordinary chat [q] quit');
}
