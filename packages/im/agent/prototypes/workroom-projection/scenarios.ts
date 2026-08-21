/** Executable acceptance scenarios for decision-map ticket #5 (not production tests). */
import assert from 'node:assert/strict';
import {
  applyDeliveryResult,
  initialiseProjectionState,
  migrateBinding,
  projectObservableFacts,
  retryDelivery,
  routeInbound,
  validateBindings,
  type InboundMessage,
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

const items = projectObservableFacts(facts, bindings, { progressWindowSeconds: 15 }, 50);
const consoleItems = items.filter((item) => item.sink === 'console');
const workroomItems = items.filter((item) => item.sink === 'workroom_im');
const sponsorItems = items.filter((item) => item.sink === 'sponsor_im');
assert.equal(consoleItems.length, facts.length, 'Console timeline must retain every observable fact');
const progressDigests = workroomItems.filter((item) => item.kind === 'progress_digest');
assert.equal(progressDigests.some((item) => item.sourceFactIds.some((id) => ['f3', 'f4', 'f5'].includes(id))), false,
  'progress superseded by a later milestone must not flood IM');
assert.deepEqual(progressDigests.find((item) => item.sourceFactIds.includes('f11'))?.sourceFactIds, ['f10', 'f11'],
  'closed fixed windows must coalesce progress with stable provenance');
assert.equal(workroomItems.some((item) => item.sourceFactIds.includes('f6')), true);
assert.equal(sponsorItems.some((item) => item.targets[0]?.projectId === 'project-web'), true);
assert.equal(items.every((item) => item.sourceFactIds.length > 0), true);

let projection = initialiseProjectionState(items);
const architectMessage = workroomItems.find((item) => item.sourceFactIds.includes('f6'))!;
projection = applyDeliveryResult(projection, architectMessage.id, { status: 'sent', platformMessageId: 'platform-milestone-1' });
const approvalCard = sponsorItems.find((item) => item.sourceFactIds.includes('f7'))!;
projection = applyDeliveryResult(projection, approvalCard.id, { status: 'failed', code: 'rate_limited' });
assert.equal(projection.items[approvalCard.id]?.deliveryStatus, 'failed');
assert.equal(facts.find((fact) => fact.id === 'f7')?.type, 'approval.requested',
  'delivery failure must not rewrite Kernel facts');
projection = retryDelivery(projection, approvalCard.id);
projection = applyDeliveryResult(projection, approvalCard.id, { status: 'sent', platformMessageId: 'platform-approval-1' });
assert.equal(projection.items[approvalCard.id]?.attempts, 2);

const baseInput = {
  conversationSequence: 101,
  actorId: 'alice',
  actorName: 'Alice',
  actorRoles: ['sponsor'],
  text: '请把兼容性证据补上',
  intent: 'discussion',
} as const;

const chat = routeInbound(bindings, {}, projection, {
  ...baseInput,
  conversation: chatConversation,
  messageId: 'chat-1',
});
assert.equal(chat.route, 'chat');

const echo = routeInbound(bindings, {}, projection, {
  ...baseInput,
  conversation: workroomConversation,
  messageId: 'platform-milestone-1',
  fromEndpointSelf: true,
});
assert.deepEqual(echo, { route: 'ignored', reason: 'projection_echo' });

const reply = routeInbound(bindings, { 'project-zhin': [architect, orchestrator] }, projection, {
  ...baseInput,
  conversation: workroomConversation,
  messageId: 'human-reply-1',
  replyToMessageId: 'platform-milestone-1',
});
assert.equal(reply.route, 'workroom_orchestrator');
assert.equal(reply.route === 'workroom_orchestrator' ? 'assignmentId' in reply.target && reply.target.assignmentId : undefined,
  architect.assignmentId);
assert.equal(reply.route === 'workroom_orchestrator' ? reply.note.includes('no specialist Turn') : false, true);

const historicalReply = routeInbound(bindings, { 'project-zhin': [orchestrator] }, projection, {
  ...baseInput,
  conversation: workroomConversation,
  messageId: 'human-reply-old',
  replyToMessageId: 'platform-milestone-1',
});
assert.equal(historicalReply.route === 'workroom_orchestrator' ? historicalReply.disposition : undefined, 'discussion');
assert.equal(historicalReply.route === 'workroom_orchestrator' ? historicalReply.note.includes('historical') : false, true);

const mention = routeInbound(bindings, { 'project-zhin': [architect, orchestrator] }, projection, {
  ...baseInput,
  conversation: workroomConversation,
  messageId: 'human-mention-1',
  logicalMention: '@架构师',
});
assert.equal(mention.route, 'workroom_orchestrator');

const ambiguousMention = routeInbound(bindings, { 'project-zhin': [architect, secondArchitect] }, projection, {
  ...baseInput,
  conversation: workroomConversation,
  messageId: 'human-mention-2',
  logicalMention: '@architect',
});
assert.equal(ambiguousMention.route, 'needs_clarification');

const oldMessage = routeInbound(bindings, {}, projection, {
  ...baseInput,
  conversation: workroomConversation,
  conversationSequence: 99,
  messageId: 'old-before-bind',
});
assert.deepEqual(oldMessage, { route: 'ignored', reason: 'before_binding_anchor' });

const sponsorNoTarget = routeInbound(bindings, {}, projection, sponsorInput({
  messageId: 'sponsor-control-1',
  intent: 'control',
}));
assert.equal(sponsorNoTarget.route, 'needs_clarification');

const sponsorReply = routeInbound(bindings, {}, projection, sponsorInput({
  messageId: 'sponsor-control-2',
  intent: 'control',
  replyToMessageId: 'platform-approval-1',
}));
assert.equal(sponsorReply.route, 'sponsor_router');
assert.equal(sponsorReply.route === 'sponsor_router' ? sponsorReply.projectId : undefined, 'project-zhin');
assert.equal(sponsorReply.route === 'sponsor_router' ? sponsorReply.disposition : undefined, 'control_proposal');

const unauthorized = routeInbound(bindings, {}, projection, sponsorInput({
  messageId: 'sponsor-control-3',
  intent: 'control',
  explicitProjectId: 'project-zhin',
  actorRoles: ['participant'],
}));
assert.equal(unauthorized.route === 'sponsor_router' ? unauthorized.disposition : undefined, 'rejected');

const migrated = migrateBinding(bindings, workroomConversation, {
  space: 'chat',
  effectiveAfterConversationSequence: 200,
});
validateBindings(migrated);
const afterMigration = routeInbound(migrated, {}, projection, {
  ...baseInput,
  conversation: workroomConversation,
  conversationSequence: 201,
  messageId: 'chat-after-migration',
});
assert.equal(afterMigration.route, 'chat');
const beforeMigrationAnchor = routeInbound(migrated, {}, projection, {
  ...baseInput,
  conversation: workroomConversation,
  conversationSequence: 199,
  messageId: 'old-workroom-after-migration',
});
assert.deepEqual(beforeMigrationAnchor, { route: 'ignored', reason: 'before_binding_anchor' });

console.log('Workroom projection scenarios passed: space routing, curated/lossless projection, identity provenance, retry, echo suppression, exact reply/mention, Sponsor targeting and migration anchor.');

function sponsorInput(overrides: Partial<InboundMessage>): InboundMessage {
  return {
    conversation: sponsorConversation,
    conversationSequence: 51,
    messageId: 'sponsor-input',
    actorId: 'alice',
    actorName: 'Alice',
    actorRoles: ['sponsor'],
    text: '暂停这个项目',
    intent: 'discussion',
    ...overrides,
  };
}
