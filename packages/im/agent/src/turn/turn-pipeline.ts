import { formatCompact, getLogger } from '@zhin.js/logger';
import { AgentStreamEventType, type AgentRunJournal } from '@zhin.js/ai/agent-stream';
import { publishAgentStream } from '../event/publish-agent-stream.js';
import { readHttpSessionId } from '../session/resolve-session-interaction-port.js';
import { parseOutput, type MediaContentBlock } from '@zhin.js/ai';
import { TurnSupersededError } from './prompt-controller.js';
import {
  applyInboundMediaInjection,
  resolveInboundMediaInjection,
} from './inbound-media.js';
import { EMPTY_USAGE } from './turn-metrics.js';
import { logPhase } from '../internal/phase-trace.js';
import type { SessionSystem } from '../session/session-system.js';
import { prepareTurnTools } from '../tool/prepare-turn-tools.js';
import { defaultAgentCore } from '../core/agent-core.js';
import type { ContextSystem } from '../context/context-system.js';
import type { AgentLoopTurnResult } from '../core/agent-loop-turn.js';
import type { TurnEvent } from '../event/turn-event.js';
import {
  buildTextTurnOutbound,
  finalizeTurnAfterAgentLoop,
  handleTurnSuperseded,
} from './turn-complete.js';
import type {
  ZhinAgentPrivate,
  OnChunkCallback,
  OutputElement,
  Tool,
} from '../internal/agent-host.js';
import type { Message } from '@zhin.js/core';
import { randomUUID } from 'node:crypto';
import { buildTurnUserMessages } from '../context/turn-user-message.js';
import {
  resolveQuoteSystemHint,
  turnContextViewFromMessage,
} from '../context/im-turn-context-adapter.js';
import { schedulePromptProfile, scheduleTurnContextView } from '../schedule-domain/turn-context.js';
import type { HostScheduleTurnContext } from '../internal/host-types.js';

function requireSessionSystem(host: ZhinAgentPrivate): SessionSystem {
  if (!host.sessionSystem) {
    throw new Error('ZhinAgent.sessionSystem is required');
  }
  return host.sessionSystem;
}

function requireContextSystem(host: ZhinAgentPrivate): ContextSystem {
  if (!host.contextSystem) {
    throw new Error('ZhinAgent.contextSystem is required');
  }
  return host.contextSystem;
}

const logger = getLogger('ZhinAgent');
const now = () => performance.now();

export interface ProcessTextTurnOptions {
  prebuiltMessages?: import('@zhin.js/ai').AgentMessage[];
  /** Deferred worker 完成后的内部自动续聊 turn（跳过速率限制、不重置续聊深度） */
  deferredAutoContinue?: boolean;
  /** Tap AgentCore.runText TurnEvent stream (processMessageStream) */
  onTurnEvent?: (event: TurnEvent) => void;
  /** Ordered wire-event journal owned by processTextTurnStream. */
  journal?: AgentRunJournal;
  /** Per-turn cancellation from an ingress owner such as the IM trigger host. */
  signal?: AbortSignal;
  /** Stateless execution: no conversation session/history and eager tools only. */
  isolated?: boolean;
  /**
   * Snapshot generation for ToolRuntime validation.
   * Plugin Runtime hosts pass AgentCapabilities.generation.
   */
  generation?: number;
  /** Explicit unattended Schedule authority; never discovered from ambient state. */
  scheduleContext?: HostScheduleTurnContext;
}

export async function processTextTurn(
  host: ZhinAgentPrivate,
  content: string,
  commMessage: Message,
  externalTools: Tool[] = [],
  onChunk?: OnChunkCallback,
  extras?: ProcessTextTurnOptions,
): Promise<OutputElement[]> {
    const t0 = now();
    const sessionSystem = requireSessionSystem(host);
    const prep = extras?.isolated
      ? {
          sessionKey: `isolated:${randomUUID()}`,
          sessionId: `isolated:${randomUUID()}`,
          userId: commMessage.$sender.id || 'unknown',
          isNewSession: false,
          passiveBlock: null,
          turnUser: buildTurnUserMessages(commMessage, content, null),
        }
      : await sessionSystem.prepareTextTurn(host, commMessage, content, {
          deferredAutoContinue: extras?.deferredAutoContinue,
        });
    const { sessionKey, userId, sessionId, isNewSession, turnUser } = prep;

    const httpSessionId = readHttpSessionId(commMessage);
    if (isNewSession && !httpSessionId) {
      publishAgentStream(host, {
        type: AgentStreamEventType.SESSION_STARTED,
        data: { sessionId },
      }, { sessionId, httpSessionId });
    }

    await host.emitter.dispatch('ai.processing.start', host.emitter.createPayload(sessionId, commMessage, 'text', {
      content,
    }));
    logPhase(host.phaseConfig, 'turn.start', sessionId, {
      mode: 'text',
      provider: host.getTurnProvider().name,
    });

    if (!extras?.deferredAutoContinue && !extras?.isolated) {
      const rateCheck = host.rateLimiter.check(userId);
      if (!rateCheck.allowed) {
        logPhase(host.phaseConfig, 'turn.rate_limited', sessionId, { userId });
        logger.debug(formatCompact({ op: 'rate_limited', user: userId }));
        await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, commMessage, 'text', {
          path: 'rate_limited',
          reply: rateCheck.message || '请稍后再试',
          reason: 'rate_limited',
        }));
        await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
        return parseOutput(rateCheck.message || '请稍后再试');
      }
    }

    host.emitter.emit('ai.typing.start', host.emitter.createPayload(sessionId, commMessage, 'text', {
      reason: 'processing',
    }));

    host.beginActiveTurn();

    const turnBinding = host.activeBinding;
    const mcpServerNames = turnBinding?.mcpServers ?? [];

    const tFilter = now();
    const toolsPrep = await prepareTurnTools(host, {
      content,
      commMessage,
      externalTools,
      sessionId,
      userId,
      mcpServerNames,
      scheduleContext: extras?.scheduleContext,
    });
    const {
      contextForTools,
      allTools,
      resolvedTools,
      deferredStats,
    } = toolsPrep;

    publishAgentStream(host, {
      type: AgentStreamEventType.MESSAGE_RECEIVED,
      data: { message: content },
    }, { sessionId, httpSessionId: readHttpSessionId(commMessage) });

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(host.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact({ op: 'tools_resolved', count: resolvedTools.length }));

    const inboundMedia = await resolveInboundMediaInjection(commMessage);
    const scheduleContext = extras?.scheduleContext;
    const turnCtx = await requireContextSystem(host).buildTextTurnContext({
      host,
      turn: scheduleContext
        ? scheduleTurnContextView(scheduleContext)
        : turnContextViewFromMessage(commMessage),
      content,
      turnUser,
      deferredStats,
      quoteSystemHint: scheduleContext ? undefined : resolveQuoteSystemHint(commMessage),
      prebuiltMessages: extras?.prebuiltMessages,
      mode: inboundMedia.blocks.length > 0 ? 'vision' : undefined,
    });
    turnCtx.userMessages = applyInboundMediaInjection(turnCtx.userMessages, inboundMedia);
    const {
      userMessages,
      personaEnhanced: personaForChat,
      modelCandidates: chatCandidates,
      modelId,
    } = turnCtx;

    logPhase(host.phaseConfig, 'path.agent_loop', sessionId, {
      toolCount: resolvedTools.length,
    });
    let loopResult: AgentLoopTurnResult;
    try {
      loopResult = await host.promptController.schedule({
        sessionKey,
        sessionId,
        userMessages,
      commMessage,
      onChunk,
      signal: extras?.signal,
      execute: (initialMessages, hooks, signal, _turnId) => (host.agentCore ?? defaultAgentCore).runTextTurn({
          host,
          sessionId,
          userMessageExtra: turnUser.userMessageExtra,
          rawContent: turnUser.rawContent,
          promptProfile: scheduleContext
            ? schedulePromptProfile(scheduleContext, content)
            : { kind: 'interactive' },
          commMessage,
          contextForTools,
          allTools,
          resolvedTools,
          personaEnhanced: personaForChat,
          modelId,
          modelCandidates: chatCandidates,
          onChunk,
          initialMessages,
          promptHooks: hooks,
          signal,
          deferredStats,
          toolLoading: toolsPrep.resolved.deferred ? 'deferred' : 'direct',
          conversationPersistence: extras?.isolated ? 'none' : 'session',
          onTurnEvent: extras?.onTurnEvent,
          journal: extras?.journal,
          generation: extras?.generation,
        }),
      });
    } catch (err) {
      if (err instanceof TurnSupersededError) {
        return handleTurnSuperseded(host, sessionId, commMessage, 'text', err);
      }
      throw err;
    }

    const reply = loopResult.reply;
    await finalizeTurnAfterAgentLoop({
      host,
      sessionSystem,
      sessionId,
      commMessage,
      mode: 'text',
      loopResult,
      isNewSession,
      rawContent: turnUser.rawContent,
      reply,
      filterMs,
      startedAt: t0,
      persistSession: !extras?.isolated,
    });

    return buildTextTurnOutbound(reply, loopResult);
}
