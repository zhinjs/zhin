import { formatCompact, getLogger } from '@zhin.js/logger';
import { AgentStreamEventType, type AgentRunJournal } from '@zhin.js/ai/agent-stream';
import { publishAgentStream } from '../event/publish-agent-stream.js';
import { parseOutput, type MediaContentBlock } from '@zhin.js/ai';
import { TurnSupersededError } from './prompt-controller.js';
import {
  applyInboundMediaInjection,
  resolveTurnMediaInjection,
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
import { resolveIMSessionIdFromMessage, type Message } from '@zhin.js/core';
import {
  turnMediaFromMessage,
  turnContextViewFromMessage,
} from '../context/im-turn-context-adapter.js';
import { createClassicToolExecutionAuthority } from '../tool/classic-tool-execution-authority.js';
import { createTurnActivityProjector } from '../activity-feedback/turn-event-projector.js';

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
  /**
   * Snapshot generation for ToolRuntime validation.
   * Plugin Runtime hosts pass AgentCapabilities.generation.
   */
  generation?: number;
}

export async function processTextTurn(
  host: ZhinAgentPrivate,
  content: string,
  commMessage: Message,
  externalTools: Tool[] = [],
  onChunk?: OnChunkCallback,
  extras?: ProcessTextTurnOptions,
): Promise<OutputElement[]> {
  try {
    return await processTextTurnInner(host, content, commMessage, externalTools, onChunk, extras);
  } catch (error) {
    const sessionId = resolveIMSessionIdFromMessage(commMessage);
    const payload = host.emitter.createPayload(sessionId, commMessage, 'text', {
      content,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await host.emitter.dispatch('ai.processing.error', payload);
    } catch {
      // Activity observers cannot replace the original turn failure.
    }
    try {
      await host.emitter.dispatch('ai.typing.stop', { ...payload, reason: 'processing_error' });
    } catch {
      // Activity observers cannot replace the original turn failure.
    }
    throw error;
  }
}

async function processTextTurnInner(
  host: ZhinAgentPrivate,
  content: string,
  commMessage: Message,
  externalTools: Tool[] = [],
  onChunk?: OnChunkCallback,
  extras?: ProcessTextTurnOptions,
): Promise<OutputElement[]> {
    const t0 = now();
    const sessionSystem = requireSessionSystem(host);
    const prep = await sessionSystem.prepareTextTurn(host, commMessage, content, {
      deferredAutoContinue: extras?.deferredAutoContinue,
    });
    const { sessionKey, userId, sessionId, isNewSession, turnUser } = prep;

    if (isNewSession) {
      publishAgentStream(host, {
        type: AgentStreamEventType.SESSION_STARTED,
        data: { sessionId },
      }, { sessionId });
    }

    const activityPayload = host.emitter.createPayload(sessionId, commMessage, 'text', {
      content,
    });
    await host.emitter.dispatch('ai.processing.start', activityPayload);
    const projectActivity = createTurnActivityProjector({
      payload: activityPayload,
      publish: (event, payload) => host.emitter.emit(event, payload),
      thinkingPreview: host.config.thinkingPreview === true,
      thinkingMaxLength: host.config.thinkingPreviewMaxLength ?? 200,
    });
    logPhase(host.phaseConfig, 'turn.start', sessionId, {
      mode: 'text',
      provider: host.getTurnProvider().name,
    });

    if (!extras?.deferredAutoContinue) {
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
    }, { sessionId });

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(host.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact({ op: 'tools_resolved', count: resolvedTools.length }));

    const turnMedia = turnMediaFromMessage(commMessage);
    const turnContext = turnContextViewFromMessage(commMessage);
    const turnCtx = await requireContextSystem(host).buildTextTurnContext({
      host,
      turn: turnContext,
      content,
      turnUser,
      deferredStats,
      prebuiltMessages: extras?.prebuiltMessages,
      mode: turnMedia.some((item) => item.kind === 'image') ? 'vision' : undefined,
    });
    const inboundMedia = await resolveTurnMediaInjection(
      turnMedia,
      undefined,
      extras?.signal ?? new AbortController().signal,
      turnCtx.modelInput,
    );
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
        intent: { kind: 'new' },
        sessionKey,
        sessionId,
        userMessages,
        onChunk,
        signal: extras?.signal,
        execute: (initialMessages, hooks, signal, _turnId) => {
          const toolExecution = createClassicToolExecutionAuthority({
            host,
            sessionId,
            message: contextForTools,
            signal,
            generation: extras?.generation ?? 0,
            rejectApproval: toolsPrep.resolved.deferred === false,
            plugin: host.emitter.getHostPlugin() ?? undefined,
            deferredController: toolsPrep.resolved.controller,
            journal: extras?.journal,
          });
          return (host.agentCore ?? defaultAgentCore).runTextTurn({
          host,
          sessionId,
          userMessageExtra: turnUser.userMessageExtra,
          rawContent: turnUser.rawContent,
          promptProfile: { kind: 'interactive' },
          turnContext,
          allTools,
          resolvedTools,
          toolExecution,
          personaEnhanced: personaForChat,
          modelId,
          modelCandidates: chatCandidates,
          onChunk,
          initialMessages,
          promptHooks: hooks,
          signal,
          deferredStats,
          deferredController: toolsPrep.resolved.controller,
          toolCatalog: toolsPrep.catalog,
          toolLoading: toolsPrep.resolved.deferred ? 'deferred' : 'direct',
          conversationPersistence: 'session',
          onTurnEvent: (event) => {
            extras?.onTurnEvent?.(event);
            projectActivity(event);
          },
          journal: extras?.journal,
          generation: extras?.generation,
          });
        },
      });
    } catch (err) {
      if (err instanceof TurnSupersededError) {
        return handleTurnSuperseded(host, sessionId, commMessage, 'text', err);
      }
      throw err;
    }

    const reply = loopResult.reply;
    await loopResult.projectConversation?.();
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
      persistSession: true,
    });

    return buildTextTurnOutbound(reply, loopResult);
}
