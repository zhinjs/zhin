import type { Message } from '@zhin.js/core';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { buildTurnUserMessages } from '../context/turn-user-message.js';
import { logPhase } from '../internal/phase-trace.js';
import type { SessionStrategy, SessionSystemConfig } from './contracts.js';
import { type SessionIODeps, beginTurnSession, resolveSessionIsNewBeforeCreate, touchSession, archiveSessionByKey } from './session-io.js';
import { consumePassiveGroupContextForTurn } from './passive-group-session.js';
import { CollaborationSessionStrategy } from './strategies.js';
export type { SessionIODeps } from './session-io.js';

export interface TurnSessionPrep {
  sessionKey: string;
  userId: string;
  sessionId: string;
  isNewSession: boolean;
  passiveBlock: string | null;
  turnUser: ReturnType<typeof buildTurnUserMessages>;
}

export class SessionSystem {
  private readonly strategies = new Map<string, SessionStrategy>();

  constructor(private readonly _config: SessionSystemConfig = {}) {
    this.registerStrategy('collaboration', new CollaborationSessionStrategy());
  }

  registerStrategy(name: string, strategy: SessionStrategy): void {
    this.strategies.set(name, strategy);
  }

  resolveSessionKey(
    message: Message,
    strategyName: string = 'collaboration',
  ): string {
    const strategy = this.strategies.get(strategyName);
    if (strategy) return strategy.resolveSessionKey(message);
    return resolveAgentTurnSessionKey(message);
  }

  resolvePassiveBlock(message: Message): string | null {
    const channelScope = message.$channel?.type;
    if (channelScope !== 'group' && channelScope !== 'channel') return null;
    return consumePassiveGroupContextForTurn(message);
  }

  sessionDeps(host: ZhinAgentPrivate): SessionIODeps {
    return {
      imSessionStore: host.imSessionStore,
      agentSessionStore: host.agentSessionStore,
      contextRepository: host.contextRepository,
    };
  }

  async prepareTextTurn(
    host: ZhinAgentPrivate,
    commMessage: Message,
    content: string,
    options?: { deferredAutoContinue?: boolean; strategyName?: string },
  ): Promise<TurnSessionPrep> {
    const deps = this.sessionDeps(host);
    const sessionKey = this.resolveSessionKey(commMessage, options?.strategyName);
    const userId = commMessage.$sender.id || 'unknown';
    const passiveBlock = this.resolvePassiveBlock(commMessage);
    const turnUser = buildTurnUserMessages(commMessage, content, passiveBlock);
    const isNewSession = await resolveSessionIsNewBeforeCreate(deps, sessionKey);

    if (options?.deferredAutoContinue) {
      logPhase(host.phaseConfig, 'turn.deferred_auto_continue', sessionKey, {});
    } else {
      host.resetDeferredAutoContinueDepth(sessionKey);
    }

    await host.waitForMemoryPersistence();
    const { sessionId } = await beginTurnSession(deps, sessionKey, commMessage);

    return {
      sessionKey,
      userId,
      sessionId,
      isNewSession,
      passiveBlock,
      turnUser,
    };
  }

  async touchAfterTurn(host: ZhinAgentPrivate, sessionId: string): Promise<void> {
    await touchSession(this.sessionDeps(host), sessionId);
  }

  async archiveByKey(host: ZhinAgentPrivate, sessionKey: string): Promise<boolean> {
    return archiveSessionByKey(this.sessionDeps(host), sessionKey);
  }
}

export function createSessionSystem(config: SessionSystemConfig = {}): SessionSystem {
  return new SessionSystem(config);
}
