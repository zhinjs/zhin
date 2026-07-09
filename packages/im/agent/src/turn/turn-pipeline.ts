import { formatCompact, Logger } from '@zhin.js/logger';
import type { ContentPart } from '@zhin.js/ai';
import { userMessagePlainText } from '@zhin.js/ai';
import { parseOutput } from '@zhin.js/ai';
import { createAIHookEvent } from '../orchestrator/hook-registry.js';
import { mergeToolOutboundElements } from '../media/media-tool-bridge.js';
import { providerSupportsVision } from '../media/vision-capability.js';
import { touchSession } from '../session/session-io.js';
import { buildMultimodalVisionSystemPrompt } from '../prompt/assembly.js';
import { TurnSupersededError } from './prompt-controller.js';
import { buildVisionUserMessage, summarizeMultimodalParts } from './multimodal-message.js';
import { EMPTY_USAGE } from './turn-metrics.js';
import { logPhase } from '../internal/phase-trace.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';
import type { SessionSystem } from '../session/session-system.js';
import { prepareTurnTools } from '../tool/prepare-turn-tools.js';
import { defaultAgentCore } from '../core/agent-core.js';
import type { ContextSystem } from '../context/context-system.js';
import type { AgentLoopTurnResult } from '../core/agent-loop-turn.js';
import type { TurnEvent } from '../event/turn-event.js';
import type {
  ZhinAgentPrivate,
  OnChunkCallback,
  OutputElement,
  Tool,
} from '../internal/agent-host.js';
import type { Message } from '@zhin.js/core';

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

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

export interface ProcessTextTurnOptions {
  prebuiltMessages?: import('@zhin.js/ai').AgentMessage[];
  /** Deferred worker 完成后的内部自动续聊 turn（跳过速率限制、不重置续聊深度） */
  deferredAutoContinue?: boolean;
  /** Tap AgentCore.runText TurnEvent stream (processMessageStream) */
  onTurnEvent?: (event: TurnEvent) => void;
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
    const prep = await requireSessionSystem(host).prepareTextTurn(host, commMessage, content, {
      deferredAutoContinue: extras?.deferredAutoContinue,
    });
    const { sessionKey, userId, sessionId, isNewSession, turnUser } = prep;

    await host.emitter.dispatch('ai.processing.start', host.emitter.createPayload(sessionId, commMessage, 'text', {
      content,
    }));
    logPhase(host.phaseConfig, 'turn.start', sessionId, {
      mode: 'text',
      provider: host.getTurnProvider().name,
    });

    if (!extras?.deferredAutoContinue) {
      const rateCheck = host.rateLimiter.check(userId);
      if (!rateCheck.allowed) {
        logPhase(host.phaseConfig, 'turn.rate_limited', sessionId, { userId });
        logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
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

    host.orchestrator?.hooks.trigger(createAIHookEvent('message', 'received', sessionId, {
      commMessage: contextForTools,
      content,
    })).catch(() => {});

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(host.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact({
      tools: resolvedTools.length,
      tool_search: true,
      names: resolvedTools.map(t => t.name).join(',') || '(none)',
    }));

    const turnCtx = await requireContextSystem(host).buildTextTurnContext({
      host,
      commMessage,
      content,
      turnUser,
      deferredStats,
      prebuiltMessages: extras?.prebuiltMessages,
    });
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
        execute: (initialMessages, hooks, signal, _turnId) => (host.agentCore ?? defaultAgentCore).runTextTurn({
          host,
          sessionId,
          userMessageExtra: turnUser.userMessageExtra,
          rawContent: turnUser.rawContent,
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
          onTurnEvent: extras?.onTurnEvent,
        }),
      });
    } catch (err) {
      if (err instanceof TurnSupersededError) {
        logPhase(host.phaseConfig, 'turn.superseded', sessionId, { sessionKey: err.sessionKey });
        host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, commMessage, 'text', {
          reason: 'superseded',
        }));
        await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'superseded' });
        return [];
      }
      throw err;
    }
    const reply = loopResult.reply;

    await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, commMessage, 'text', {
      path: loopResult.path,
      model: loopResult.model,
      iterations: loopResult.iterations,
      reply,
    }));
    await requireSessionSystem(host).touchAfterTurn(host, sessionId);
    if (isNewSession) {
      host.emitSessionNewEvent(sessionId, commMessage, 'text', turnUser.rawContent, reply);
    }
    await host.finalizeActiveTurn({
      usage: loopResult.usage,
      path: loopResult.path,
      iterations: loopResult.iterations,
      model: loopResult.model,
    });

    host.orchestrator?.hooks.trigger(createAIHookEvent('message', 'sent', sessionId, {
      commMessage,
      content: reply,
    })).catch(() => {});

    await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, commMessage, 'text', {
      path: loopResult.path,
      model: loopResult.model,
      reply,
    }));
    host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, commMessage, 'text', {
      reason: 'processing_complete',
    }));
    logPhase(host.phaseConfig, 'turn.end', sessionId, {
      path: loopResult.path,
      filter_ms: filterMs,
      total_ms: Math.round(now() - t0),
    });

    const outbound = mergeToolOutboundElements(parseOutput(reply), loopResult.toolCalls);
    if (!reply.trim() && outbound.length === 0) return [];
    return outbound;
}

export async function processMultimodalTurn(
  host: ZhinAgentPrivate,
  parts: ContentPart[],
  commMessage: Message,
  onChunk?: OnChunkCallback,
): Promise<OutputElement[]> {
  const textContent = summarizeMultimodalParts(parts, providerSupportsVision(host.getTurnProvider()));
  const prep = await requireSessionSystem(host).prepareTextTurn(host, commMessage, textContent);
  const { sessionKey, userId, sessionId, isNewSession, turnUser } = prep;

  await host.emitter.dispatch('ai.processing.start', host.emitter.createPayload(sessionId, commMessage, 'multimodal'));

  const rateCheck = host.rateLimiter.check(userId);
  if (!rateCheck.allowed) {
    await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
      path: 'rate_limited',
      reply: rateCheck.message || '请稍后再试',
      reason: 'rate_limited',
    }));
    await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
    return parseOutput(rateCheck.message || '请稍后再试');
  }

  host.emitter.emit('ai.typing.start', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
    reason: 'processing',
  }));

  host.beginActiveTurn();

  const supportsVision = providerSupportsVision(host.getTurnProvider());
  const personaForVision = host.buildDisciplinedPrompt(host.config.persona);
  const visionSystemPrompt = await buildMultimodalVisionSystemPrompt(host, {
    commMessage,
    sessionId,
    textContent,
    personaEnhanced: personaForVision,
  });
  const turnCtx = await requireContextSystem(host).buildTextTurnContext({
    host,
    commMessage,
    content: textContent,
    turnUser,
    mode: 'vision',
  });
  const { modelCandidates: visionCandidates } = turnCtx;

  logPhase(host.phaseConfig, 'path.agent_loop', sessionId, { mode: 'multimodal' });

  const userMessage = await buildVisionUserMessage(
    userMessagePlainText(turnUser.promptMessages[0]!),
    parts,
    supportsVision,
    DEFAULT_MULTIMODAL_CONFIG.maxFileBytes,
  );
  const { userMessages } = await requireContextSystem(host).buildTextTurnContext({
    host,
    commMessage,
    content: textContent,
    turnUser,
    mode: 'vision',
    prebuiltMessages: [userMessage],
  });

  let loopResult: AgentLoopTurnResult;
  try {
    loopResult = await host.promptController.schedule({
      sessionKey,
      sessionId,
      userMessages,
      commMessage,
      onChunk,
      execute: (initialMessages, hooks, signal, _turnId) => (host.agentCore ?? defaultAgentCore).runVisionTurn({
        host,
        sessionId,
        commMessage,
        visionSystemPrompt,
        userMessages: initialMessages,
        modelCandidates: visionCandidates,
        onChunk,
        promptHooks: hooks,
        signal,
      }),
    });
  } catch (err) {
    if (err instanceof TurnSupersededError) {
      host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
        reason: 'superseded',
      }));
      await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'superseded' });
      return [];
    }
    loopResult = {
      reply: '抱歉，我无法理解这条消息。',
      usage: EMPTY_USAGE,
      path: 'multimodal' as const,
      iterations: 0,
      model: visionCandidates[0] || '',
      toolCalls: [],
    };
  }

  const reply = loopResult.reply;
  await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
    path: 'multimodal',
    model: loopResult.model,
    reply,
  }));
  await requireSessionSystem(host).touchAfterTurn(host, sessionId);
  if (isNewSession) {
    host.emitSessionNewEvent(sessionId, commMessage, 'multimodal', turnUser.rawContent, reply);
  }
  await host.finalizeActiveTurn({
    usage: loopResult.usage,
    path: 'multimodal',
    model: loopResult.model,
    iterations: loopResult.iterations,
  });
  await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
    path: 'multimodal',
    model: loopResult.model,
    reply,
  }));

  host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, commMessage, 'multimodal', {
    reason: 'processing_complete',
  }));

  return parseOutput(reply);
}
