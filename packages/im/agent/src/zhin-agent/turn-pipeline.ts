import { formatCompact, Logger } from '@zhin.js/logger';
import type { ContentPart } from '@zhin.js/ai';
import { userMessagePlainText } from '@zhin.js/ai';
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import { parseOutput } from '@zhin.js/ai';
import { detectTone } from '@zhin.js/ai';
import {
  ensureMcpConnectionsForBinding,
  getMcpToolsForBinding,
} from '../orchestrator/mcp-lifecycle.js';
import { triggerAIHook, createAIHookEvent } from '../hooks.js';
import { resolveModelCandidates } from './model-resolver.js';
import { mergeToolOutboundElements } from '../media/media-tool-bridge.js';
import { providerSupportsVision } from '../media/vision-capability.js';
import {
  touchSession,
  resolveSessionIsNewBeforeCreate,
  beginTurnSession as beginTurnSessionIO,
  type SessionIODeps,
} from './session-io.js';
import { buildTurnUserMessages, applyTurnContextToUserMessages, prependEnvelopeToFirstUserText } from './turn-user-message.js';
import { runAgentLoopTextTurn, runAgentLoopVisionTurn } from './agent-loop-turn.js';
import { buildTurnContextEnvelope, resolveQuoteSystemHint } from './prompt.js';
import { buildAgentsEnvelopeContext } from './agents-instruction.js';
import { getModel } from '@zhin.js/ai';
import { collectRuntimeTools } from './tool-runtime.js';
import { buildMultimodalVisionSystemPrompt } from './prompt-assembly.js';
import { attachWebSearchLocale } from './web-search-locale-attach.js';
import { EMPTY_USAGE } from './turn-metrics.js';
import { resolveAgentToolsForTurn } from './tool-orchestration.js';
import { logPhase } from './phase-trace.js';
import { buildVisionUserMessage, summarizeMultimodalParts } from './multimodal-message.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';
import type {
  ZhinAgentPrivate,
  OnChunkCallback,
  OutputElement,
  Tool,
} from './zhin-agent-private.js';
import type { Message } from '@zhin.js/core';

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

export interface ProcessTextTurnOptions {
  prebuiltMessages?: import('@zhin.js/ai').AgentMessage[];
  /** Deferred worker 完成后的内部自动续聊 turn（跳过速率限制、不重置续聊深度） */
  deferredAutoContinue?: boolean;
}

function sessionDeps(host: ZhinAgentPrivate): SessionIODeps {
  return {
    imSessionStore: host.imSessionStore,
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
}

async function beginTurnSession(host: ZhinAgentPrivate, commMessage: Message) {
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  return beginTurnSessionIO(sessionDeps(host), sessionKey, commMessage);
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
    const userId = commMessage.$sender.id || 'unknown';
    const turnUser = buildTurnUserMessages(commMessage, content);
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    const isNewSession = await resolveSessionIsNewBeforeCreate(
      sessionDeps(host),
      sessionKey,
    );
    if (extras?.deferredAutoContinue) {
      logPhase(host.phaseConfig, 'turn.deferred_auto_continue', sessionKey, {});
    } else {
      host.resetDeferredAutoContinueDepth(sessionKey);
    }
    await host.waitForMemoryPersistence();
    const { sessionId } = await beginTurnSession(host, commMessage);
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

    const contextForTools = await attachWebSearchLocale(commMessage, userId, host.userProfiles);

    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      commMessage: contextForTools,
      content,
    })).catch(() => {});

    const turnBinding = host.activeBinding;
    const mcpServerNames = turnBinding?.mcpServers ?? [];

    if (host.orchestrator && mcpServerNames.length > 0) {
      await ensureMcpConnectionsForBinding(host.orchestrator.mcps, mcpServerNames, (event) => {
        const payload = host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          serverName: event.serverName,
          loadedToolNames: event.toolNames,
          reason: event.connected === false ? 'disconnected' : undefined,
          error: event.error,
        });
        if (event.phase === 'start') {
          host.emitter.emit('ai.mcp.connect.start', payload);
        } else if (event.phase === 'finish') {
          host.emitter.emit('ai.mcp.connect.finish', payload);
        } else {
          host.emitter.emit('ai.mcp.connect.error', payload);
        }
      });
    }

    const tFilter = now();
    const mcpTools = host.orchestrator && mcpServerNames.length > 0
      ? getMcpToolsForBinding(host.orchestrator.mcps, mcpServerNames)
      : [];
    const allTools = collectRuntimeTools({
      content,
      commMessage: contextForTools,
      externalTools,
      config: host.config,
      skillRegistry: host.skillRegistry,
      externalRegistered: host.externalTools,
      sessionId,
      userId,
      imTranscriptStore: host.imTranscriptStore,
      userProfiles: host.userProfiles,
      mcpTools,
    });

    const { tools: resolvedTools, deferredStats } = resolveAgentToolsForTurn(host,
      allTools,
      contextForTools,
    );
    host.lastToolSearchDeferredStats = deferredStats;

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(host.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact({
      tools: resolvedTools.length,
      tool_search: true,
      names: resolvedTools.map(t => t.name).join(',') || '(none)',
    }));

    const profileSummary = await host.userProfiles.buildProfileSummary(userId);
    const toneHint = host.config.toneAwareness ? detectTone(content).hint : '';
    const personaForChat = host.buildDisciplinedPrompt(host.config.persona);

    const chatCandidates = resolveModelCandidates(
      host.getTurnProvider().models,
      host.modelRegistry,
      host.getTurnProvider().name,
      host.config,
      'chat',
    );
    const modelId = chatCandidates[0] || host.getTurnProvider().models[0] || 'gpt-4o-mini';
    const providerAlias = host.getTurnProvider().name;
    const llmModel = getModel(providerAlias, modelId);
    const agentsContext = await buildAgentsEnvelopeContext();

    const turnEnvelope = buildTurnContextEnvelope({
      commMessage,
      profileSummary,
      toneHint,
      deferredStats,
      activeSkillsContext: host.activeSkillsContext || undefined,
      quoteSystemHint: resolveQuoteSystemHint(commMessage),
      modelLine: `${providerAlias}/${modelId}`,
      sdk: llmModel.sdk,
      agentsContext: agentsContext ?? undefined,
    });
    const userMessages = extras?.prebuiltMessages?.length
      ? prependEnvelopeToFirstUserText(extras.prebuiltMessages, turnEnvelope)
      : applyTurnContextToUserMessages(turnUser.promptMessages, turnEnvelope);

    logPhase(host.phaseConfig, 'path.agent_loop', sessionId, { toolCount: allTools.length });
    const loopResult = await host.promptController.schedule({
      sessionKey,
      sessionId,
      userMessages,
      commMessage,
      onChunk,
      execute: (initialMessages, hooks, signal, _turnId) => runAgentLoopTextTurn({
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
      }),
    });
    const reply = loopResult.reply;

    await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, commMessage, 'text', {
      path: loopResult.path,
      model: loopResult.model,
      iterations: loopResult.iterations,
      reply,
    }));
    await touchSession(sessionDeps(host), sessionId);
    if (isNewSession) {
      host.emitSessionNewEvent(sessionId, commMessage, 'text', turnUser.rawContent, reply);
    }
    await host.finalizeActiveTurn({
      usage: loopResult.usage,
      path: loopResult.path,
      iterations: loopResult.iterations,
      model: loopResult.model,
    });

    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
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

/** @deprecated 仅保留类型引用；多模态 turn 已统一 agentLoop */

export async function processMultimodalTurn(
  host: ZhinAgentPrivate,
  parts: ContentPart[],
  commMessage: Message,
  onChunk?: OnChunkCallback,
): Promise<OutputElement[]> {
  const userId = commMessage.$sender?.id || 'unknown';
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  const isNewSession = await resolveSessionIsNewBeforeCreate(
    sessionDeps(host),
    sessionKey,
  );
  await host.waitForMemoryPersistence();
  const { sessionId } = await beginTurnSession(host, commMessage);
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
  const textContent = summarizeMultimodalParts(parts, supportsVision);
  const turnUser = buildTurnUserMessages(commMessage, textContent);
  const profileSummary = await host.userProfiles.buildProfileSummary(userId);
  const toneHint = host.config.toneAwareness ? detectTone(textContent).hint : '';
  const personaForVision = host.buildDisciplinedPrompt(host.config.persona);
  const visionSystemPrompt = await buildMultimodalVisionSystemPrompt(host, {
    commMessage,
    sessionId,
    textContent,
    personaEnhanced: personaForVision,
  });
  const visionCandidates = resolveModelCandidates(
    host.getTurnProvider().models,
    host.modelRegistry,
    host.getTurnProvider().name,
    host.config,
    'vision',
  );
  const visionModelId = visionCandidates[0] || host.getTurnProvider().models[0] || 'gpt-4o-mini';
  const visionProviderAlias = host.getTurnProvider().name;
  const visionLlmModel = getModel(visionProviderAlias, visionModelId);
  const agentsContext = await buildAgentsEnvelopeContext();

  logPhase(host.phaseConfig, 'path.agent_loop', sessionId, { mode: 'multimodal' });

  const turnEnvelope = buildTurnContextEnvelope({
    commMessage,
    profileSummary,
    toneHint,
    activeSkillsContext: host.activeSkillsContext || undefined,
    quoteSystemHint: resolveQuoteSystemHint(commMessage),
    modelLine: `${visionProviderAlias}/${visionModelId}`,
    sdk: visionLlmModel.sdk,
    agentsContext: agentsContext ?? undefined,
  });

  const userMessage = await buildVisionUserMessage(
    userMessagePlainText(turnUser.promptMessages[0]!),
    parts,
    supportsVision,
    DEFAULT_MULTIMODAL_CONFIG.maxFileBytes,
  );
  const userMessages = prependEnvelopeToFirstUserText([userMessage], turnEnvelope);

  let loopResult;
  try {
    loopResult = await host.promptController.schedule({
      sessionKey,
      sessionId,
      userMessages,
      commMessage,
      onChunk,
      execute: (initialMessages, hooks, signal, _turnId) => runAgentLoopVisionTurn({
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
  } catch {
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
  await touchSession(sessionDeps(host), sessionId);
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
