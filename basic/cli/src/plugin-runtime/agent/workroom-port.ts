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

/** Null object used when the optional Workroom package is not installed. */
export const NO_WORKROOM_PORT: AgentWorkroomPort = Object.freeze({
  preRoute: async () => false,
  hasAgentTurn: () => false,
  takeAgentTurn: () => undefined,
  resolveOrchestratorConversation: async () => undefined,
});
