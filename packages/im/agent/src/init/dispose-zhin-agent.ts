import type { AgentTool } from '@zhin.js/ai';
import type { ConversationMemory } from '@zhin.js/ai';
import type { RateLimiter } from '@zhin.js/ai';
import type { UserProfileStore } from '../user-profile.js';
import type { SubagentSystem } from '../subagent/index.js';
import type { PromptController } from '../turn/prompt-controller.js';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { Disposable } from '../types/disposable.js';

export interface DisposeZhinAgentTarget {
  memory: ConversationMemory;
  externalTools: Map<string, AgentTool>;
  userProfiles: UserProfileStore;
  rateLimiter: RateLimiter;
  subagentSystem: SubagentSystem | null;
  promptController: PromptController;
  inboundTurnQueue: InboundTurnQueue;
  imSessionStore: unknown;
  agentSessionStore: unknown;
  contextRepository: unknown;
  imTranscriptStore: unknown;
  deferredAutoContinueDepthBySession: Map<string, number>;
  deferredCatalog: AgentTool[];
  lastTurnMetrics: unknown;
  provider: import('@zhin.js/ai').AIProvider | null;
  providerResolver: ((alias: string) => import('@zhin.js/ai').AIProvider) | null;
  skillRegistry: unknown;
  skillSystem: unknown;
  orchestrator: unknown;
}

export function disposeZhinAgentResources(target: DisposeZhinAgentTarget): void {
  target.memory.dispose();
  target.externalTools.clear();
  target.userProfiles.dispose();
  target.rateLimiter.dispose();
  if (target.subagentSystem) {
    target.subagentSystem.dispose();
    target.subagentSystem = null;
  }
  target.promptController.abort();
  target.inboundTurnQueue.dispose();
  const tryDispose = (obj: unknown) => {
    if (obj && typeof (obj as Disposable).dispose === 'function') {
      (obj as Disposable).dispose?.();
    }
  };
  tryDispose(target.imSessionStore);
  tryDispose(target.agentSessionStore);
  tryDispose(target.contextRepository);
  tryDispose(target.imTranscriptStore);
  target.deferredAutoContinueDepthBySession.clear();
  target.deferredCatalog.length = 0;
  target.lastTurnMetrics = null;
}
