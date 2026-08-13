import type { Message } from '@zhin.js/core';
import { getLogger } from '@zhin.js/logger';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { buildTurnUserMessages } from '../context/turn-user-message.js';
import { logPhase } from '../internal/phase-trace.js';
import type { SessionStrategy, SessionSystemConfig } from './contracts.js';
import { type SessionIODeps, beginTurnSession, resolveSessionIsNewBeforeCreate, touchSession, archiveSessionByKey } from './session-io.js';
import { consumePassiveGroupContextForTurn } from './passive-group-session.js';
import { CollaborationSessionStrategy } from './strategies.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import {
  beginIngressTurnSession,
  resolveIngressUserMessage,
} from './turn-ingress-session.js';
export type { SessionIODeps } from './session-io.js';

const logger = getLogger('SessionSystem');

export interface TurnSessionPrep {
  sessionKey: string;
  userId: string;
  sessionId: string;
  isNewSession: boolean;
  passiveBlock: string | null;
  turnUser: ReturnType<typeof buildTurnUserMessages>;
}

export interface IngressTurnSessionPrep {
  sessionKey: string;
  userId: string;
  sessionId: string;
  isNewSession: boolean;
  turnUser: {
    rawContent: string;
    userMessageExtra?: import('@zhin.js/ai').AgentMessageExtra;
    promptMessages: import('@zhin.js/ai').UserMessage[];
  };
}

export class SessionSystem {
  private readonly strategies = new Map<string, SessionStrategy>();
  private persistenceReady: Promise<void>;
  private resolvePersistenceReady!: () => void;
  private persistenceDone = false;

  constructor(private readonly _config: SessionSystemConfig = {}) {
    this.registerStrategy('collaboration', new CollaborationSessionStrategy());
    this.persistenceReady = new Promise<void>((resolve) => {
      this.resolvePersistenceReady = resolve;
    });
  }

  async waitForPersistence(): Promise<void> {
    if (this.persistenceDone) return;
    const timeoutMs = process.env.NODE_ENV === 'test' ? 50 : 5_000;
    await Promise.race([
      this.persistenceReady,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!this.persistenceDone) {
            logger.warn('waitForPersistence: timeout, proceeding with in-memory session/history');
            this.markPersistenceReady();
          }
          resolve();
        }, timeoutMs);
      }),
    ]);
  }

  markPersistenceReady(): void {
    if (this.persistenceDone) return;
    this.persistenceDone = true;
    this.resolvePersistenceReady?.();
  }

  isPersistenceReady(): boolean {
    return this.persistenceDone;
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
      host.deferred.resetAutoContinueDepth(sessionKey);
    }

    await host.waitForMemoryPersistence();
    const { sessionId } = await beginTurnSession(deps, sessionKey);

    return {
      sessionKey,
      userId,
      sessionId,
      isNewSession,
      passiveBlock,
      turnUser,
    };
  }

  async prepareIngressTurn(
    host: ZhinAgentPrivate,
    turn: TurnIngress,
    options?: { deferredAutoContinue?: boolean },
  ): Promise<IngressTurnSessionPrep> {
    const deps = this.sessionDeps(host);
    const sessionKey = turn.session.key;
    const userId = turn.principal.subjectId;
    const resolved = resolveIngressUserMessage(turn);
    const isNewSession = await resolveSessionIsNewBeforeCreate(deps, sessionKey);

    if (options?.deferredAutoContinue) {
      logPhase(host.phaseConfig, 'turn.deferred_auto_continue', sessionKey, {});
    } else {
      host.deferred.resetAutoContinueDepth(sessionKey);
    }

    await host.waitForMemoryPersistence();
    const { sessionId } = await beginIngressTurnSession(deps, turn);
    return {
      sessionKey,
      userId,
      sessionId,
      isNewSession,
      turnUser: {
        rawContent: resolved.content,
        ...(resolved.extra ? { userMessageExtra: resolved.extra } : {}),
        promptMessages: [resolved.llmMessage],
      },
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
