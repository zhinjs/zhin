import { workroomProjectionBindingKey } from '@zhin.js/workroom';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { WorkroomTurnContinuation } from '../agent/workroom-port.js';

export function resolveWorkroomOrchestratorConversation(
  bindings: Readonly<Record<string, Readonly<{ conversation: ConversationRef }>>>,
  continuation: Pick<WorkroomTurnContinuation, 'projectId' | 'space'>,
): ConversationRef | undefined {
  return bindings[workroomProjectionBindingKey(
    continuation.projectId,
    continuation.space,
  )]?.conversation;
}
