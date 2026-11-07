import type { HostMailbox } from '../collaboration/host-mailbox.js';
import type { Disposable } from '../utils/disposable.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

/** dispose 的读取目标：权威接口（ZhinAgentPrivate）Pick + 门面内部资源。 */
export type DisposeZhinAgentTarget = Pick<
  ZhinAgentPrivate,
  | 'externalTools' | 'userProfiles' | 'rateLimiter' | 'promptController'
  | 'agentSessionStore' | 'contextRepository'
  | 'deferred'
> & {
  /** 接口外的门面内部资源 */
  hostMailbox: HostMailbox;
  lastTurnMetrics: unknown;
};

export async function disposeZhinAgentResources(target: DisposeZhinAgentTarget): Promise<void> {
  target.externalTools.clear();
  target.userProfiles.dispose();
  target.rateLimiter.dispose();
  target.promptController.abort();
  target.hostMailbox.dispose();
  const tryDispose = (obj: unknown) => {
    if (obj && typeof (obj as Disposable).dispose === 'function') {
      (obj as Disposable).dispose?.();
    }
  };
  tryDispose(target.agentSessionStore);
  tryDispose(target.contextRepository);
  target.deferred.clear();
  target.lastTurnMetrics = null;
}
