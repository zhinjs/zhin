import { getPlugin, type Plugin } from '@zhin.js/core';
import { formatCompact, truncatePreview, Logger } from '@zhin.js/logger';
import type { AgentTool, ChatMessage, ContentPart, Usage } from '@zhin.js/ai';
import { createAgent } from '@zhin.js/ai';
import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import { parseOutput } from '@zhin.js/ai';
import { detectTone } from '@zhin.js/ai';
import { ensureMcpConnections } from '../orchestrator/mcp-lifecycle.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { runWithBashToolContext } from '../security/bash-tool-context.js';
import { triggerAIHook, createAIHookEvent } from '../hooks.js';
import { resolveModelCandidates } from './model-resolver.js';
import { streamChatWithHistory } from './llm-runner.js';
import {
  buildSessionCreateInput,
  touchSession,
  buildHistoryMessages,
  formatUserContentForSession,
  resolveSessionIsNewBeforeCreate,
  type SessionIODeps,
} from './session-io.js';
import { buildEnhancedPersona } from './prompt.js';
import { collectRuntimeTools, planToolRun } from './tool-runtime.js';
import { sanitizeAssistantReply, stripThinkBlocks } from './text-sanitize.js';
import { pruneHistoryWithBudget } from './context-budget.js';
import { buildMultimodalVisionSystemPrompt } from './prompt-assembly.js';
import { formatToolCallsForUser } from './tool-calls-user-format.js';
import { resolveModelHarness } from './model-harness.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from '../reserved-tools.js';
import { createOwnerOrchestratedToolResultTransform } from '../orchestrator/owner-confirm-orchestration.js';
import { logPhase, usageLogFields } from './phase-trace.js';
import { attachWebSearchLocale } from './web-search-locale-attach.js';
import { EMPTY_USAGE } from './turn-metrics.js';
import { resolveAgentToolsForTurn } from './tool-orchestration.js';
import {
  buildAgentPathSystemPrompt,
  buildChatPathSystemPrompt,
  buildFastPathSystemPrompt,
  buildAgentUserMessage,
} from './prompt-assembly.js';
import type {
  ZhinAgentPrivate,
  OnChunkCallback,
  OutputElement,
  Tool,
  ToolContext,
} from './zhin-agent-private.js';

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

function sessionDeps(host: ZhinAgentPrivate): SessionIODeps {
  return { chatHistory: host.chatHistory, imSessionStore: host.imSessionStore };
}

async function beginTurnSession(host: ZhinAgentPrivate, context: ToolContext) {
  const sessionKey = resolveIMSessionIdFromToolContext({
    platform: context.platform,
    botId: context.botId,
    scope: context.scope,
    sceneId: context.sceneId,
    senderId: context.senderId,
  });
  const imSession = await host.imSessionStore.getOrCreateActive(
    buildSessionCreateInput(sessionKey, context),
  );
  return { sessionKey, sessionId: imSession.session_id };
}

export async function processTextTurn(
  host: ZhinAgentPrivate,
  content: string,
  context: ToolContext,
  externalTools: Tool[] = [],
  onChunk?: OnChunkCallback,
): Promise<OutputElement[]> {
    const t0 = now();
    const { senderId, sceneId, platform, botId, messageId } = context;
    const sessionUserContent = formatUserContentForSession(context, content);
    const userId = senderId || 'unknown';
    const sessionKey = resolveIMSessionIdFromToolContext({
      platform,
      botId,
      scope: context.scope,
      sceneId,
      senderId,
    });
    const isNewSession = await resolveSessionIsNewBeforeCreate(
      sessionDeps(host),
      sessionKey,
      context,
    );
    await host.waitForMemoryPersistence();
    const { sessionId } = await beginTurnSession(host, context);
    await host.emitter.dispatch('ai.processing.start', host.emitter.createPayload(sessionId, context, 'text', {
      content,
    }));
    logPhase(host.phaseConfig, 'turn.start', sessionId, {
      mode: 'text',
      provider: host.provider.name,
    });

    // 0. Rate limit
    const rateCheck = host.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      logPhase(host.phaseConfig, 'turn.rate_limited', sessionId, { userId });
      logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
      await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, context, 'text', {
        path: 'rate_limited',
        reply: rateCheck.message || '请稍后再试',
        reason: 'rate_limited',
      }));
      await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // 0.1 发射 typing 事件，由适配器插件自行决定如何响应
    host.emitter.emit('ai.typing.start', host.emitter.createPayload(sessionId, context, 'text', {
      reason: 'processing',
    }));

    host.beginActiveTurn();

    // 0.5 工具上下文：web_search 语言（档案 preferred_language / language，否则默认中文）
    const contextForTools = await attachWebSearchLocale(context, userId, host.userProfiles);

    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      userId,
      content,
      platform: platform || '',
    })).catch(() => {});

    // 0.9 Lazy-connect configured MCP servers before tool collection
    if (host.orchestrator) {
      await ensureMcpConnections(host.orchestrator.mcps, (event) => {
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

    // 1. Collect tools
    const tFilter = now();
    const mcpTools = host.orchestrator?.mcps.getAllMcpTools() ?? [];
    const allTools = collectRuntimeTools({
      content,
      context: contextForTools,
      externalTools,
      config: host.config,
      skillRegistry: host.skillRegistry,
      externalRegistered: host.externalTools,
      sessionId,
      userId,
      chatHistory: host.chatHistory,
      userProfiles: host.userProfiles,
      subagentManager: host.subagentManager,
      mcpTools,
    });

    const { tools: resolvedTools, deferredStats } = resolveAgentToolsForTurn(host, 
      allTools,
      contextForTools,
    );
    host.lastToolSearchDeferredStats = deferredStats;

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(host.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact( {
      tools: resolvedTools.length,
      tool_search: host.config.toolSearch || undefined,
      names: resolvedTools.map(t => t.name).join(',') || '(none)',
    }));

    // 2. History + profile (parallel)
    const tMem = now();
    const [rawHistoryMessages, profileSummary] = await Promise.all([
      buildHistoryMessages(sessionDeps(host), sessionId, context, sessionUserContent),
      host.userProfiles.buildProfileSummary(userId),
    ]);

    const chatCandidates = resolveModelCandidates(host.provider.models, host.modelRegistry, host.provider.name, host.config, 'chat');
    const {
      messages: historyMessages,
      result: pruneResult,
      budget: contextBudget,
    } = pruneHistoryWithBudget({
      messages: rawHistoryMessages,
      config: host.config,
      provider: host.provider,
      modelRegistry: host.modelRegistry,
      model: chatCandidates[0],
    });
    if (pruneResult.droppedCount > 0) {
      logger.debug(`[上下文窗口] 丢弃 ${pruneResult.droppedCount} 条历史消息 (${pruneResult.droppedTokens} tokens)`);
    }

    const memMs = (now() - tMem).toFixed(0);
    logPhase(host.phaseConfig, 'context.ready', sessionId, { historyCount: historyMessages.length });

    // 2.5 Tone + persona
    const toneHint = host.config.toneAwareness ? detectTone(content).hint : '';
    const personaEnhanced = buildEnhancedPersona(host.config, profileSummary, toneHint);

    // 3. No tools → chat path (prefer per-session model, then lightweight model)
    if (allTools.length === 0) {
      logPhase(host.phaseConfig, 'path.chat', sessionId, { toolCount: 0 });
      const liteModel = host.config.chatLiteModel || undefined;
      const chatSystemPrompt = buildChatPathSystemPrompt(host, personaEnhanced, contextForTools);
      logger.debug(formatCompact( {
        mode: 'chat',
        prompt_chars: chatSystemPrompt.length,
        model: liteModel || chatCandidates[0] || undefined,
      }));
      const tLLM = now();
      logPhase(host.phaseConfig, 'chat.llm.start', sessionId, { model: liteModel || chatCandidates[0] || '' });
      const chatResult = await streamChatWithHistory(
        { provider: host.provider, modelRegistry: host.modelRegistry, config: host.config },
        sessionUserContent, chatSystemPrompt, historyMessages, onChunk, liteModel,
      );
      let reply = sanitizeAssistantReply(chatResult.content);
      await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, context, 'text', {
        path: 'chat',
        model: chatResult.model,
        reply,
      }));
      const llmMs = (now() - tLLM).toFixed(0);
      logPhase(host.phaseConfig, 'chat.llm.end', sessionId, {
        durationMs: Number(llmMs),
        ...usageLogFields(chatResult.usage ?? undefined),
      });
      logger.debug(formatCompact( {
        mode: 'chat',
        filter_ms: filterMs,
        mem_ms: memMs,
        llm_ms: llmMs,
        total_ms: Math.round(now() - t0),
      }));
      await touchSession(sessionDeps(host), sessionId);
      if (isNewSession) {
        host.emitSessionNewEvent(sessionId, context, 'text', sessionUserContent, reply);
      }
      await host.finalizeActiveTurn({
        usage: chatResult.usage ?? EMPTY_USAGE,
        path: 'chat',
        model: chatResult.model,
      });
      await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, context, 'text', {
        path: 'chat',
        model: chatResult.model,
        reply,
      }));
      host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, context, 'text', {
        reason: 'processing_complete',
      }));
      logPhase(host.phaseConfig, 'turn.end', sessionId, { path: 'chat' });

      return parseOutput(reply);
    }

    logger.debug(`[工具路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, ${allTools.length} 工具 (${allTools.map(t => t.name).join(', ')})`);

    // 4. Pre-executable tools
    const preExecCandidates = allTools.filter(tool => tool.preExecutable);
    const tPre = preExecCandidates.length > 0 ? now() : 0;
    if (preExecCandidates.length > 0) {
      logger.debug(`预执行: ${preExecCandidates.map(t => t.name).join(', ')}`);
    }
    const toolRun = await planToolRun(resolvedTools, host.config.preExecTimeout);
    logPhase(host.phaseConfig, 'preexec.done', sessionId, {
      mode: toolRun.mode,
      preExecutedTools: toolRun.preExecution.tools.length,
    });
    const preData = toolRun.preExecution.data;
    if (tPre > 0) {
      logger.debug(`预执行耗时: ${(now() - tPre).toFixed(0)}ms`);
    }

    // 6. Path selection
    let reply: string;

    if (toolRun.mode === 'pre-exec-fast-path') {
      logPhase(host.phaseConfig, 'path.pre_exec_fast', sessionId, { toolCount: allTools.length });
      // Fast path
      const tLLM = now();
      const prompt = buildFastPathSystemPrompt(host, personaEnhanced, preData, contextForTools);
      logger.debug(formatCompact( { mode: 'fast', prompt_chars: prompt.length }));
      logPhase(host.phaseConfig, 'fast.llm.start', sessionId, { model: chatCandidates[0] || '' });
      const fastResult = await streamChatWithHistory(
        { provider: host.provider, modelRegistry: host.modelRegistry, config: host.config },
        sessionUserContent, prompt, historyMessages, onChunk,
      );
      reply = sanitizeAssistantReply(fastResult.content);
      logPhase(host.phaseConfig, 'fast.llm.end', sessionId, {
        durationMs: Math.round(now() - tLLM),
        ...usageLogFields(fastResult.usage ?? undefined),
      });
      logger.debug(`[快速路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${(now() - tLLM).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
      await host.finalizeActiveTurn({
        usage: fastResult.usage ?? EMPTY_USAGE,
        path: 'fast',
        model: fastResult.model,
      });
    } else {
      logPhase(host.phaseConfig, 'path.agent', sessionId, { toolCount: allTools.length });
      const tAgent = now();
      logger.debug(`Agent 路径: ${allTools.length} 个工具`);
      const systemPrompt = await buildAgentPathSystemPrompt(host, {
        content,
        context: contextForTools,
        sessionId,
        personaEnhanced,
        preData,
        deferredStats,
      });

      logger.debug(formatCompact( { mode: 'agent', prompt_chars: systemPrompt.length }));
      logger.debug(`[System Prompt Full]\n${systemPrompt}\n---END---`);

      const agentTools = applyExecPolicyToTools(host.config, resolvedTools, {
        approvalMode: host.config.execApprovalMode,
      });

      // Adaptive maxIterations: boost when skills are active (multi-step skill flows)
      const SKILL_ITERATION_BOOST = 3;
      const hasSkillActivation = agentTools.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
      const harness = resolveModelHarness(host.provider.name, chatCandidates[0] || '', host.config.modelHarness);
      const baseIterations = harness.maxIterations ?? host.config.maxIterations;
      const effectiveMaxIterations = hasSkillActivation
        ? baseIterations + SKILL_ITERATION_BOOST
        : baseIterations;
      logPhase(host.phaseConfig, 'harness.resolved', sessionId, {
        model: chatCandidates[0] || '',
        harnessMaxIterations: harness.maxIterations ?? null,
        effectiveMaxIterations,
      });

      let orchestrationPlugin: Plugin | undefined = host.emitter.getHostPlugin() ?? undefined;
      if (!orchestrationPlugin) {
        try {
          orchestrationPlugin = getPlugin().root ?? getPlugin();
        } catch {
          logger.warn(formatCompact( { warn: 'no_host_plugin' }));
        }
      }

      const llmAgent = createAgent(host.provider, {
        model: chatCandidates[0],
        modelFallbacks: chatCandidates.slice(1),
        systemPrompt,
        tools: agentTools,
        maxIterations: effectiveMaxIterations,
        turnTimeout: host.config.timeout,
        contextWindow: contextBudget.contextWindow,
        reservedToolNames: RESERVED_TOOL_NAMES,
        reservedToolNamePrefixes: RESERVED_TOOL_NAME_PREFIXES,
        transformToolResult: createOwnerOrchestratedToolResultTransform({
          toolContext: contextForTools,
          disableHardOrchestration: false,
          plugin: orchestrationPlugin,
        }),
        policyDenialStopAfter: host.config.policyDenialStopAfter,
      });

      llmAgent.on('thinking', (message) => {
        host.emitter.emit('ai.thinking', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          thinking: message,
        }));
      });

      llmAgent.on('tool_call', (toolName, args) => {
        host.emitter.emit('ai.tool.call', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName,
          args,
        }));
      });

      llmAgent.on('tool_result', (toolName, result) => {
        host.emitter.emit('ai.tool.result', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName,
          result,
        }));
      });

      llmAgent.on('compaction', (info) => {
        host.emitSessionCompactEvent(sessionId, contextForTools, 'text', info);
      });

      const userMessageWithHistory = buildAgentUserMessage(historyMessages, sessionUserContent);
      let result;
      try {
        await host.emitter.dispatch('ai.agent.start', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          model: chatCandidates[0] || undefined,
        }));
        logPhase(host.phaseConfig, 'agent.run.start', sessionId, { model: chatCandidates[0] || '' });
        result = await runWithBashToolContext(contextForTools, () => llmAgent.run(userMessageWithHistory, []));
        logPhase(host.phaseConfig, 'agent.run.end', sessionId, {
          iterations: result.iterations,
          durationMs: Math.round(now() - tAgent),
          ...usageLogFields(result.usage),
        });
        await host.emitter.dispatch('ai.agent.finish', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          model: result.model ?? (chatCandidates[0] || undefined),
          iterations: result.iterations,
        }));
      } catch (error) {
        await host.emitter.dispatch('ai.processing.error', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      } finally {
        llmAgent.dispose();
      }
      reply = sanitizeAssistantReply(result.content, {
        toolSummary: formatToolCallsForUser(result.toolCalls),
      });
      await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, contextForTools, 'text', {
        path: 'agent',
        model: result.model ?? (chatCandidates[0] || undefined),
        iterations: result.iterations,
        reply,
      }));
      logger.debug(formatCompact( {
        agent_answer: truncatePreview(reply, 480),
        tool_calls: result.toolCalls.length,
        ...(result.toolCalls.length
          ? { tools: result.toolCalls.map(tc => tc.tool).join(',') }
          : {}),
      }));
      for (const tc of result.toolCalls) {
        logger.debug(formatCompact( {
          tool_result: tc.tool,
          preview: truncatePreview(
            typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result),
            480,
          ),
        }));
      }
      logger.debug(
        `[Agent 路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, Agent=${(now() - tAgent).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`,
      );
      await host.finalizeActiveTurn({
        usage: result.usage,
        path: 'agent',
        iterations: result.iterations,
        model: result.model ?? (chatCandidates[0] || undefined),
      });
    }

    await touchSession(sessionDeps(host), sessionId);
    if (isNewSession) {
      host.emitSessionNewEvent(sessionId, context, 'text', sessionUserContent, reply);
    }

    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
      userId,
      content: reply,
      platform: platform || '',
    })).catch(() => {});

    await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, context, 'text', {
      path: toolRun.mode === 'pre-exec-fast-path' ? 'fast' : 'agent',
      reply,
    }));

    logPhase(host.phaseConfig, 'turn.end', sessionId, { path: toolRun.mode === 'pre-exec-fast-path' ? 'fast' : 'agent' });

    host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, context, 'text', {
      reason: 'processing_complete',
    }));

    return parseOutput(reply);
}

/** Full multimodal ContentPart union (core/ai may export a narrower type in some builds) */
type MultimodalPart =
  | ContentPart
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'face'; face: { id: string; text?: string } };

export async function processMultimodalTurn(
  host: ZhinAgentPrivate,
  parts: ContentPart[],
  context: ToolContext,
  onChunk?: OnChunkCallback,
): Promise<OutputElement[]> {
  const { senderId, sceneId, platform, botId } = context;
  const userId = senderId || 'unknown';
  const sessionKey = resolveIMSessionIdFromToolContext({
    platform,
    botId,
    scope: context.scope,
    sceneId,
    senderId,
  });
  const isNewSession = await resolveSessionIsNewBeforeCreate(
    sessionDeps(host),
    sessionKey,
    context,
  );
  await host.waitForMemoryPersistence();
  const { sessionId } = await beginTurnSession(host, context);
  await host.emitter.dispatch('ai.processing.start', host.emitter.createPayload(sessionId, context, 'multimodal'));

  const rateCheck = host.rateLimiter.check(userId);
  if (!rateCheck.allowed) {
    await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, context, 'multimodal', {
      path: 'rate_limited',
      reply: rateCheck.message || '请稍后再试',
      reason: 'rate_limited',
    }));
    await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
    return parseOutput(rateCheck.message || '请稍后再试');
  }

  host.emitter.emit('ai.typing.start', host.emitter.createPayload(sessionId, context, 'multimodal', {
    reason: 'processing',
  }));

  host.beginActiveTurn();

  const textFragmentsEarly: string[] = [];
  for (const p of parts as MultimodalPart[]) {
    if (p.type === 'text') textFragmentsEarly.push(p.text);
  }
  const textContentEarly = textFragmentsEarly.join(' ') || '[多模态消息]';
  const sessionUserContentEarly = formatUserContentForSession(context, textContentEarly);

  const rawHistoryMessages = await buildHistoryMessages(
    sessionDeps(host),
    sessionId,
    context,
    sessionUserContentEarly,
  );
  const profileSummary = await host.userProfiles.buildProfileSummary(userId);
  const personaEnhanced = host.buildDisciplinedPrompt(
    buildEnhancedPersona(host.config, profileSummary, ''),
  );

  const textFragments: string[] = [];
  const llmParts: ContentPart[] = [];

  for (const p of parts as MultimodalPart[]) {
    switch (p.type) {
      case 'text':
        textFragments.push(p.text);
        llmParts.push(p);
        break;
      case 'image_url':
        textFragments.push('[图片]');
        llmParts.push(p);
        break;
      case 'video_url':
        textFragments.push('[视频]');
        llmParts.push({ type: 'text', text: `[用户发送了一个视频: ${p.video_url.url}]` });
        break;
      case 'audio':
        textFragments.push('[音频]');
        llmParts.push(p);
        break;
      case 'face':
        textFragments.push(p.face.text || `[表情:${p.face.id}]`);
        llmParts.push({
          type: 'text',
          text: p.face.text ? `[表情: ${p.face.text}]` : `[表情ID: ${p.face.id}]`,
        });
        break;
    }
  }

  const textContent = textFragments.join(' ') || '[多模态消息]';
  const sessionUserContent = formatUserContentForSession(context, textContent);
  const visionSystemPrompt = await buildMultimodalVisionSystemPrompt(host, {
    context,
    sessionId,
    textContent,
    personaEnhanced,
  });
  const visionCandidates = resolveModelCandidates(
    host.provider.models,
    host.modelRegistry,
    host.provider.name,
    host.config,
    'vision',
  );
  const { messages: historyMessages, result: pruneResult } = pruneHistoryWithBudget({
    messages: rawHistoryMessages,
    config: host.config,
    provider: host.provider,
    modelRegistry: host.modelRegistry,
    model: visionCandidates[0],
  });
  if (pruneResult.droppedCount > 0) {
    logger.debug(
      `[多模态上下文窗口] 丢弃 ${pruneResult.droppedCount} 条历史消息 (${pruneResult.droppedTokens} tokens)`,
    );
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: visionSystemPrompt },
    ...historyMessages,
    { role: 'user', content: llmParts },
  ];

  let reply = '';
  let lastUsage: Usage | null = null;
  let usedVisionModel = visionCandidates[0] || '';
  for (let i = 0; i < visionCandidates.length; i++) {
    const visionModel = visionCandidates[i];
    usedVisionModel = visionModel;
    try {
      reply = '';
      for await (const chunk of host.provider.chatStream({ model: visionModel, messages })) {
        if (chunk.usage) lastUsage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        const text = typeof delta.content === 'string' ? delta.content : '';
        if (text) {
          reply += text;
          if (onChunk) onChunk(text, reply);
        }
      }
      reply = stripThinkBlocks(reply);
      if (!reply) {
        logger.warn(formatCompact({ mode: 'multimodal', fallback: visionModel, reason: 'empty_stream' }));
        const response = await host.provider.chat({ model: visionModel, messages });
        if (response.usage) lastUsage = response.usage;
        const msg = response.choices[0]?.message?.content;
        reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
      }
      if (reply) break;
    } catch (err) {
      const isLast = i === visionCandidates.length - 1;
      if (isLast) {
        try {
          const response = await host.provider.chat({ model: visionModel, messages });
          if (response.usage) lastUsage = response.usage;
          const msg = response.choices[0]?.message?.content;
          reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
        } catch { /* all candidates exhausted */ }
      } else {
        logger.warn(formatCompact({
          mode: 'multimodal',
          fallback: `${visionModel}→${visionCandidates[i + 1]}`,
          error: truncatePreview((err as Error).message),
        }));
      }
    }
  }

  if (!reply) reply = '抱歉，我无法理解这条消息。';
  reply = sanitizeAssistantReply(reply);
  await host.emitter.dispatch('ai.response', host.emitter.createPayload(sessionId, context, 'multimodal', {
    path: 'multimodal',
    model: usedVisionModel,
    reply,
  }));
  await touchSession(sessionDeps(host), sessionId);
  if (isNewSession) {
    host.emitSessionNewEvent(sessionId, context, 'multimodal', sessionUserContent, reply);
  }
  await host.finalizeActiveTurn({
    usage: lastUsage ?? EMPTY_USAGE,
    path: 'multimodal',
    model: usedVisionModel,
  });
  await host.emitter.dispatch('ai.processing.finish', host.emitter.createPayload(sessionId, context, 'multimodal', {
    path: 'multimodal',
    model: usedVisionModel,
    reply,
  }));

  host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, context, 'multimodal', {
    reason: 'processing_complete',
  }));

  return parseOutput(reply);
}
