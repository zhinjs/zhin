import type { ConversationMemory } from '@zhin.js/ai';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { Disposable } from '../types/disposable.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

/** dispose 的读取目标：权威接口（ZhinAgentPrivate）Pick + 门面内部资源。 */
export type DisposeZhinAgentTarget = Pick<
  ZhinAgentPrivate,
  | 'externalTools' | 'userProfiles' | 'rateLimiter' | 'subagentSystem' | 'promptController'
  | 'imSessionStore' | 'agentSessionStore' | 'contextRepository'
  | 'deferred'
> & {
  /** 接口外的门面内部资源 */
  memory: ConversationMemory;
  inboundTurnQueue: InboundTurnQueue;
  lastTurnMetrics: unknown;
};

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
  target.deferred.clear();
  target.lastTurnMetrics = null;
}
