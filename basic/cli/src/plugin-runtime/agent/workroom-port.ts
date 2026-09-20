import { workroomProjectionBindingKey } from '@zhin.js/agent';
import type { Message } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';

export interface WorkroomTurnContinuation {
  readonly projectId: string;
  readonly proposalId: string;
  readonly space: 'sponsor_room' | 'workroom';
  readonly agentDefinitionId: string;
}

/** Consumer-owned seam from Agent turn routing into the Workroom subsystem. */
export interface AgentWorkroomPort {
  preRoute(message: Message, conversationSequence: number | undefined): Promise<boolean>;
  hasAgentTurn(message: Message): boolean;
  takeAgentTurn(message: Message): WorkroomTurnContinuation | undefined;
  resolveOrchestratorConversation(
    continuation: WorkroomTurnContinuation,
  ): Promise<ConversationRef | undefined>;
}

export function resolveWorkroomOrchestratorConversation(
  bindings: Readonly<Record<string, Readonly<{ conversation: ConversationRef }>>>,
  continuation: Pick<WorkroomTurnContinuation, 'projectId' | 'space'>,
): ConversationRef | undefined {
  return bindings[workroomProjectionBindingKey(
    continuation.projectId,
    continuation.space,
  )]?.conversation;
}
