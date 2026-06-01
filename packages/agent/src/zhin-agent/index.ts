/**
 * ZhinAgent — 全局持久 AI 大脑
 *
 * 核心能力：
 *   1. 全局单例，应用生命周期内常驻
 *   2. Skill 感知：两级过滤 Skill → Tool
 *   3. 双层记忆：per-scene（对话上下文）+ per-user（长期偏好）
 *   4. 任务规划：复杂请求自动分解为子步骤
 *   5. 多模态输出：结构化 OutputElement[]
 *   6. 智能路径选择：纯闲聊走轻量路径，工具请求走完整路径
 *   7. 用户画像：跨会话个性化记忆
 *   8. 速率限制：防止单用户过度消耗资源
 *   9. 流式输出：onChunk 回调实时推送部分文本
 *  10. 情绪感知：根据用户语气调整回复风格
 *  11. 定时任务：cron_add 持久化定时任务
 *  12. 多模态输入：图片/音频直接传给视觉模型
 */

import { getPlugin, type Plugin } from '@zhin.js/core';
import { formatCompact, truncatePreview, Logger } from '@zhin.js/logger';
import type { AIProvider, AgentTool, ChatMessage, ContentPart, Usage } from '@zhin.js/ai';
import type { Tool, ToolContext } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import { ensureMcpConnections } from '../orchestrator/mcp-lifecycle.js';
import { createAgent } from '@zhin.js/ai';
import { SessionManager, createMemorySessionManager } from '@zhin.js/ai';
import type { ContextManager } from '@zhin.js/ai';
import { ConversationMemory } from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import { parseOutput } from '@zhin.js/ai';
import {
  EMPTY_USAGE,
  type ZhinAgentTurnMetrics,
} from './turn-metrics.js';
import { TurnTracker } from './turn-tracker.js';
import { ZhinAgentEventEmitter } from './event-emitter.js';
import { logPhase, usageLogFields, type PhaseTraceConfig } from './phase-trace.js';
import { attachWebSearchLocale } from './web-search-locale-attach.js';

import type { ModelRegistry } from '@zhin.js/ai';
import { resolveModelCandidates } from './model-resolver.js';
import { streamChatWithHistory, type StreamChatResult } from './llm-runner.js';
import { saveToSession, buildHistoryMessages } from './session-io.js';
import { UserProfileStore } from '../user-profile.js';
import { RateLimiter } from '@zhin.js/ai';
import { detectTone } from '@zhin.js/ai';
import { notifySubagentGoal } from '../subagent-goal-notify.js';
import { SubagentManager, type SubagentResultSender } from '../subagent.js';
import { triggerAIHook, createAIHookEvent } from '../hooks.js';
import { resolveAgentPromptMarkdown } from '../agent-prompt/index.js';

// ── Sub-modules ─────────────────────────────────────────────────────
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
} from './config.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { runWithBashToolContext } from '../security/bash-tool-context.js';
import {
  buildEnhancedPersona,
  buildContextHint,
  appendQuoteContextSystemHint,
  buildRichSystemPrompt,
  buildLiteSystemPromptWithPlatform,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
} from './prompt.js';
import {
  buildPreExecFastPathPrompt,
  collectRuntimeTools,
  planToolRun,
} from './tool-runtime.js';
import { DeferredWorkerRunner } from '../deferred-worker-runner.js';
import { buildOrchestratorAgentTools } from './tool-search-orchestrator.js';
import { filterToolsForToolSearchCatalog } from './tool-catalog.js';
import { sanitizeAssistantReply, stripThinkBlocks } from './text-sanitize.js';
import { formatToolCallsForUser } from './tool-calls-user-format.js';
import { pruneHistoryWithBudget } from './context-budget.js';
import { resolveModelHarness } from './model-harness.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from '../reserved-tools.js';
import { createOwnerOrchestratedToolResultTransform } from '../orchestrator/owner-confirm-orchestration.js';

export type { ZhinAgentConfig, OnChunkCallback } from './config.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';
export { formatAiHandlerCompleteLog, formatZhinAgentTurnUsage } from './turn-metrics.js';
export * from './prompt-builder.js';
export * from './prompt-templates.js';
export * from './task-continuation.js';

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

// ============================================================================
// ZhinAgent
// ============================================================================

export class ZhinAgent {
  private provider: AIProvider;
  private config: Required<ZhinAgentConfig>;
  private skillRegistry: SkillRegistry | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  private sessions: SessionManager;
  private contextManager: ContextManager | null = null;
  private memory: ConversationMemory;
  private externalTools: Map<string, AgentTool> = new Map();
  private userProfiles: UserProfileStore;
  private rateLimiter: RateLimiter;
  private subagentManager: SubagentManager | null = null;
  private bootstrapContext: string = '';
  private activeSkillsContext: string = '';
  private skillsSummaryXML: string = '';
  private modelRegistry: ModelRegistry | null = null;
  private phaseTraceEnabled: boolean;
  private readonly emitter = new ZhinAgentEventEmitter();
  private deferredCatalog: AgentTool[] = [];
  private readonly deferredWorkerRunner = new DeferredWorkerRunner();
  private lastToolSearchDeferredStats?: string;
  private readonly turnTracker: TurnTracker;
  private get phaseConfig(): PhaseTraceConfig {
    return { phaseTraceEnabled: this.phaseTraceEnabled, onPhaseTrace: this.config.onPhaseTrace };
  }

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.phaseTraceEnabled = isPhaseTraceEnabled(this.config);
    this.sessions = createMemorySessionManager();
    this.memory = new ConversationMemory({
      minTopicRounds: this.config.minTopicRounds,
      slidingWindowSize: this.config.slidingWindowSize,
      topicChangeThreshold: this.config.topicChangeThreshold,
      topicDetectModel: this.config.chatLiteModel || undefined,
    });
    this.memory.setProvider(provider);
    this.userProfiles = new UserProfileStore();
    this.rateLimiter = new RateLimiter(this.config.rateLimit);
    this.turnTracker = new TurnTracker(this.config.subagentTurnWaitMs);
  }

  // ── DI setters ──────────────────────────────────────────────────────

  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
    logger.debug(`SkillRegistry connected (${registry.size} skills)`);
  }

  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
    logger.debug('AgentOrchestrator connected for MCP and resources');
  }

  setSessionManager(manager: SessionManager): void {
    this.sessions.dispose();
    this.sessions = manager;
  }

  setContextManager(manager: ContextManager): void {
    this.contextManager = manager;
    manager.setAIProvider(this.provider);
  }

  setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry;
    this.subagentManager?.setModelRegistry(registry);
  }

  setHostPlugin(plugin: Plugin): void {
    this.emitter.setHostPlugin(plugin);
  }

  upgradeMemoryToDatabase(msgModel: any, sumModel: any): void {
    this.memory.upgradeToDatabase(msgModel, sumModel);
  }

  upgradeProfilesToDatabase(model: any): void {
    this.userProfiles.upgradeToDatabase(model);
  }

  initSubagentManager(createTools: () => AgentTool[]): void {
    this.subagentManager = new SubagentManager({
      provider: this.provider,
      workspace: process.cwd(),
      createTools,
      subagentTools: this.config.subagentTools,
      maxIterations: this.config.maxSubagentIterations,
      execPolicyConfig: this.config,
      modelRegistry: this.modelRegistry,
      onSubagentUsage: (usage) => this.turnTracker.addSubagentUsage(usage),
      registerSubagentTask: (done) => this.turnTracker.trackSubagent(done),
      onEvent: (event) => {
        const sessionId = SessionManager.generateId(
          event.origin.platform || '',
          event.origin.senderId || '',
          event.origin.sceneId,
        );
        const payload = this.emitter.createPayload(sessionId, {
          platform: event.origin.platform,
          botId: event.origin.botId,
          sceneId: event.origin.sceneId,
          senderId: event.origin.senderId,
          scope: event.origin.sceneType === 'group' ? 'group' : 'private',
        }, 'text', {
          path: 'agent',
          taskId: event.taskId,
          label: event.label,
          content: event.task,
          status: event.status,
          error: event.error,
          reply: event.result,
        });
        if (event.phase === 'spawn') {
          this.emitter.emit('ai.subagent.spawn', payload);
        } else if (event.phase === 'start') {
          this.emitter.emit('ai.subagent.start', payload);
        } else {
          this.emitter.emit('ai.subagent.finish', payload);
        }
      },
    });
    logger.debug('SubagentManager initialized');
  }

  setSubagentSender(sender: SubagentResultSender): void {
    if (this.subagentManager) {
      this.subagentManager.setSender(sender);
    }
  }

  getSubagentManager(): SubagentManager | null {
    return this.subagentManager;
  }

  getUserProfiles(): UserProfileStore {
    return this.userProfiles;
  }

  registerTool(tool: AgentTool): () => void {
    this.externalTools.set(tool.name, tool);
    return () => { this.externalTools.delete(tool.name); };
  }

  setBootstrapContext(context: string): void {
    this.bootstrapContext = context;
    logger.debug(`Bootstrap context set (${context.length} chars)`);
  }

  setActiveSkillsContext(content: string): void {
    this.activeSkillsContext = content || '';
  }

  setSkillsSummaryXML(xml: string): void {
    this.skillsSummaryXML = xml || '';
  }

  getLastTurnMetrics(): ZhinAgentTurnMetrics | null {
    return this.turnTracker.lastMetrics;
  }

  private beginActiveTurn(): void {
    this.turnTracker.begin();
  }

  private async finalizeActiveTurn(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void> {
    await this.turnTracker.finalize(partial);
  }

  private emitSessionNewEvent(
    sessionId: string,
    context: ToolContext,
    mode: 'text' | 'multimodal',
    content: string,
    reply: string,
  ): void {
    this.emitter.emit('ai.session.new', this.emitter.createPayload(sessionId, context, mode, {
      reason: 'first_message',
      content,
      reply,
    }));
  }

  private emitSessionCompactEvent(
    sessionId: string,
    context: ToolContext,
    mode: 'text' | 'multimodal',
    info: {
      microSavedTokens: number;
      autoSavedTokens: number;
      totalTokensBefore: number;
      totalTokensAfter: number;
    },
  ): void {
    this.emitter.emit('ai.session.compact', this.emitter.createPayload(sessionId, context, mode, {
      path: 'agent',
      compactedCount: 1,
      savedTokens: info.microSavedTokens + info.autoSavedTokens,
      totalTokensBefore: info.totalTokensBefore,
      totalTokensAfter: info.totalTokensAfter,
      result: info,
    }));
  }

  // ── Core processing ─────────────────────────────────────────────────

  async process(
    content: string,
    context: ToolContext,
    externalTools: Tool[] = [],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const t0 = now();
    const { senderId, sceneId, platform, botId, messageId } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const userId = senderId || 'unknown';
    await this.emitter.dispatch('ai.processing.start', this.emitter.createPayload(sessionId, context, 'text', {
      content,
    }));
    logPhase(this.phaseConfig, 'turn.start', sessionId, {
      mode: 'text',
      provider: this.provider.name,
    });

    // 0. Rate limit
    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      logPhase(this.phaseConfig, 'turn.rate_limited', sessionId, { userId });
      logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
      await this.emitter.dispatch('ai.processing.finish', this.emitter.createPayload(sessionId, context, 'text', {
        path: 'rate_limited',
        reply: rateCheck.message || '请稍后再试',
        reason: 'rate_limited',
      }));
      await this.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // 0.1 发射 typing 事件，由适配器插件自行决定如何响应
    this.emitter.emit('ai.typing.start', this.emitter.createPayload(sessionId, context, 'text', {
      reason: 'processing',
    }));

    this.beginActiveTurn();

    // 0.5 工具上下文：web_search 语言（档案 preferred_language / language，否则默认中文）
    const contextForTools = await attachWebSearchLocale(context, userId, this.userProfiles);

    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      userId,
      content,
      platform: platform || '',
    })).catch(() => {});

    // 0.9 Lazy-connect configured MCP servers before tool collection
    if (this.orchestrator) {
      await ensureMcpConnections(this.orchestrator.mcps, (event) => {
        const payload = this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          serverName: event.serverName,
          loadedToolNames: event.toolNames,
          reason: event.connected === false ? 'disconnected' : undefined,
          error: event.error,
        });
        if (event.phase === 'start') {
          this.emitter.emit('ai.mcp.connect.start', payload);
        } else if (event.phase === 'finish') {
          this.emitter.emit('ai.mcp.connect.finish', payload);
        } else {
          this.emitter.emit('ai.mcp.connect.error', payload);
        }
      });
    }

    // 1. Collect tools
    const tFilter = now();
    const mcpTools = this.orchestrator?.mcps.getAllMcpTools() ?? [];
    const allTools = collectRuntimeTools({
      content,
      context: contextForTools,
      externalTools,
      config: this.config,
      skillRegistry: this.skillRegistry,
      externalRegistered: this.externalTools,
      sessionId,
      userId,
      memory: this.memory,
      userProfiles: this.userProfiles,
      subagentManager: this.subagentManager,
      mcpTools,
    });

    const { tools: resolvedTools, deferredStats } = this.resolveAgentToolsForTurn(
      allTools,
      contextForTools,
    );
    this.lastToolSearchDeferredStats = deferredStats;

    const filterMs = (now() - tFilter).toFixed(0);
    logPhase(this.phaseConfig, 'tools.collected', sessionId, { count: resolvedTools.length });

    logger.debug(formatCompact( {
      tools: resolvedTools.length,
      tool_search: this.config.toolSearch || undefined,
      names: resolvedTools.map(t => t.name).join(',') || '(none)',
    }));

    // 2. History + profile (parallel)
    const tMem = now();
    const [rawHistoryMessages, profileSummary] = await Promise.all([
      buildHistoryMessages(this.memory, sessionId),
      this.userProfiles.buildProfileSummary(userId),
    ]);

    const chatCandidates = resolveModelCandidates(this.provider.models, this.modelRegistry, this.provider.name, this.config, 'chat');
    const {
      messages: historyMessages,
      result: pruneResult,
      budget: contextBudget,
    } = pruneHistoryWithBudget({
      messages: rawHistoryMessages,
      config: this.config,
      provider: this.provider,
      modelRegistry: this.modelRegistry,
      model: chatCandidates[0],
    });
    if (pruneResult.droppedCount > 0) {
      logger.debug(`[上下文窗口] 丢弃 ${pruneResult.droppedCount} 条历史消息 (${pruneResult.droppedTokens} tokens)`);
    }

    const memMs = (now() - tMem).toFixed(0);
    logPhase(this.phaseConfig, 'context.ready', sessionId, { historyCount: historyMessages.length });

    // 2.5 Tone + persona
    const toneHint = this.config.toneAwareness ? detectTone(content).hint : '';
    const personaEnhanced = buildEnhancedPersona(this.config, profileSummary, toneHint);

    // 3. No tools → chat path (prefer per-session model, then lightweight model)
    if (allTools.length === 0) {
      logPhase(this.phaseConfig, 'path.chat', sessionId, { toolCount: 0 });
      const liteModel = this.config.chatLiteModel || undefined;
      const chatSystemPrompt = appendQuoteContextSystemHint(
        this.buildDisciplinedPrompt(personaEnhanced),
        contextForTools,
      );
      logger.debug(formatCompact( {
        mode: 'chat',
        prompt_chars: chatSystemPrompt.length,
        model: liteModel || chatCandidates[0] || undefined,
      }));
      const tLLM = now();
      logPhase(this.phaseConfig, 'chat.llm.start', sessionId, { model: liteModel || chatCandidates[0] || '' });
      const chatResult = await streamChatWithHistory(
        { provider: this.provider, modelRegistry: this.modelRegistry, config: this.config },
        content, chatSystemPrompt, historyMessages, onChunk, liteModel,
      );
      let reply = sanitizeAssistantReply(chatResult.content);
      await this.emitter.dispatch('ai.response', this.emitter.createPayload(sessionId, context, 'text', {
        path: 'chat',
        model: chatResult.model,
        reply,
      }));
      const llmMs = (now() - tLLM).toFixed(0);
      logPhase(this.phaseConfig, 'chat.llm.end', sessionId, {
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
const isNewSession = !(await this.sessions.has(sessionId));
      await saveToSession(
        { memory: this.memory, sessions: this.sessions, contextManager: this.contextManager },
        sessionId, content, reply, sceneId,
      );
      if (isNewSession) {
        this.emitSessionNewEvent(sessionId, context, 'text', content, reply);
      }
      await this.finalizeActiveTurn({
        usage: chatResult.usage ?? EMPTY_USAGE,
        path: 'chat',
        model: chatResult.model,
      });
      await this.emitter.dispatch('ai.processing.finish', this.emitter.createPayload(sessionId, context, 'text', {
        path: 'chat',
        model: chatResult.model,
        reply,
      }));
      this.emitter.emit('ai.typing.stop', this.emitter.createPayload(sessionId, context, 'text', {
        reason: 'processing_complete',
      }));
      logPhase(this.phaseConfig, 'turn.end', sessionId, { path: 'chat' });

      return parseOutput(reply);
    }

    logger.debug(`[工具路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, ${allTools.length} 工具 (${allTools.map(t => t.name).join(', ')})`);

    // 4. Pre-executable tools
    const preExecCandidates = allTools.filter(tool => tool.preExecutable);
    const tPre = preExecCandidates.length > 0 ? now() : 0;
    if (preExecCandidates.length > 0) {
      logger.debug(`预执行: ${preExecCandidates.map(t => t.name).join(', ')}`);
    }
    const toolRun = await planToolRun(resolvedTools, this.config.preExecTimeout);
    logPhase(this.phaseConfig, 'preexec.done', sessionId, {
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
      logPhase(this.phaseConfig, 'path.pre_exec_fast', sessionId, { toolCount: allTools.length });
      // Fast path
      const tLLM = now();
      const prompt = appendQuoteContextSystemHint(
        this.buildDisciplinedPrompt(buildPreExecFastPathPrompt(personaEnhanced, preData)),
        contextForTools,
      );
      logger.debug(formatCompact( { mode: 'fast', prompt_chars: prompt.length }));
      logPhase(this.phaseConfig, 'fast.llm.start', sessionId, { model: chatCandidates[0] || '' });
      const fastResult = await streamChatWithHistory(
        { provider: this.provider, modelRegistry: this.modelRegistry, config: this.config },
        content, prompt, historyMessages, onChunk,
      );
      reply = sanitizeAssistantReply(fastResult.content);
      logPhase(this.phaseConfig, 'fast.llm.end', sessionId, {
        durationMs: Math.round(now() - tLLM),
        ...usageLogFields(fastResult.usage ?? undefined),
      });
      logger.debug(`[快速路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${(now() - tLLM).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
      await this.finalizeActiveTurn({
        usage: fastResult.usage ?? EMPTY_USAGE,
        path: 'fast',
        model: fastResult.model,
      });
    } else {
      logPhase(this.phaseConfig, 'path.agent', sessionId, { toolCount: allTools.length });
      const tAgent = now();
      logger.debug(`Agent 路径: ${allTools.length} 个工具`);
      const contextHint = buildContextHint(context, content);

      const platformMarkdown = await resolveAgentPromptMarkdown({
        ctx: {
          slot: 'orchestrator',
          toolContext: context,
          toolSearch: !!this.config.toolSearch,
          userMessagePreview: content.slice(0, 500),
          deferred: deferredStats ? { goal: content, domainStats: deferredStats } : undefined,
        },
        config: this.config,
        sessionId,
      });

      const richPrompt = buildRichSystemPrompt({
        config: this.config,
        skillRegistry: this.skillRegistry,
        skillsSummaryXML: this.skillsSummaryXML,
        activeSkillsContext: this.activeSkillsContext,
        bootstrapContext: this.bootstrapContext,
        toolSearchDeferredStats: deferredStats,
        platformSections: platformMarkdown,
        fileRole: contextForTools.fileRole,
      });
      const systemPrompt = appendQuoteContextSystemHint(
        `${richPrompt}
${contextHint}
${preData ? `\nPre-fetched data:\n${preData}\n` : ''}`,
        contextForTools,
      );

      logger.debug(formatCompact( { mode: 'agent', prompt_chars: systemPrompt.length }));
      logger.debug(`[System Prompt Full]\n${systemPrompt}\n---END---`);

      const agentTools = applyExecPolicyToTools(this.config, resolvedTools, {
        approvalMode: this.config.execApprovalMode,
      });

      // Adaptive maxIterations: boost when skills are active (multi-step skill flows)
      const SKILL_ITERATION_BOOST = 3;
      const hasSkillActivation = agentTools.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
      const harness = resolveModelHarness(this.provider.name, chatCandidates[0] || '', this.config.modelHarness);
      const baseIterations = harness.maxIterations ?? this.config.maxIterations;
      const effectiveMaxIterations = hasSkillActivation
        ? baseIterations + SKILL_ITERATION_BOOST
        : baseIterations;
      logPhase(this.phaseConfig, 'harness.resolved', sessionId, {
        model: chatCandidates[0] || '',
        harnessMaxIterations: harness.maxIterations ?? null,
        effectiveMaxIterations,
      });

      let orchestrationPlugin: Plugin | undefined = this.emitter.getHostPlugin() ?? undefined;
      if (!orchestrationPlugin) {
        try {
          orchestrationPlugin = getPlugin().root ?? getPlugin();
        } catch {
          logger.warn(formatCompact( { warn: 'no_host_plugin' }));
        }
      }

      const agent = createAgent(this.provider, {
        model: chatCandidates[0],
        modelFallbacks: chatCandidates.slice(1),
        systemPrompt,
        tools: agentTools,
        maxIterations: effectiveMaxIterations,
        turnTimeout: this.config.timeout,
        contextWindow: contextBudget.contextWindow,
        reservedToolNames: RESERVED_TOOL_NAMES,
        reservedToolNamePrefixes: RESERVED_TOOL_NAME_PREFIXES,
        transformToolResult: createOwnerOrchestratedToolResultTransform({
          toolContext: contextForTools,
          disableHardOrchestration: false,
          plugin: orchestrationPlugin,
        }),
        policyDenialStopAfter: this.config.policyDenialStopAfter,
      });

      agent.on('thinking', (message) => {
        this.emitter.emit('ai.thinking', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          thinking: message,
        }));
      });

      agent.on('tool_call', (toolName, args) => {
        this.emitter.emit('ai.tool.call', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName,
          args,
        }));
      });

      agent.on('tool_result', (toolName, result) => {
        this.emitter.emit('ai.tool.result', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName,
          result,
        }));
      });

      agent.on('compaction', (info) => {
        this.emitSessionCompactEvent(sessionId, contextForTools, 'text', info);
      });

      const userMessageWithHistory = buildUserMessageWithHistory(historyMessages, content);
      let result;
      try {
        await this.emitter.dispatch('ai.agent.start', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          model: chatCandidates[0] || undefined,
        }));
        logPhase(this.phaseConfig, 'agent.run.start', sessionId, { model: chatCandidates[0] || '' });
        result = await runWithBashToolContext(contextForTools, () => agent.run(userMessageWithHistory, []));
        logPhase(this.phaseConfig, 'agent.run.end', sessionId, {
          iterations: result.iterations,
          durationMs: Math.round(now() - tAgent),
          ...usageLogFields(result.usage),
        });
        await this.emitter.dispatch('ai.agent.finish', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          model: result.model ?? (chatCandidates[0] || undefined),
          iterations: result.iterations,
        }));
      } catch (error) {
        await this.emitter.dispatch('ai.processing.error', this.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      } finally {
        agent.dispose();
      }
      reply = sanitizeAssistantReply(result.content, {
        toolSummary: formatToolCallsForUser(result.toolCalls),
      });
      await this.emitter.dispatch('ai.response', this.emitter.createPayload(sessionId, contextForTools, 'text', {
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
      await this.finalizeActiveTurn({
        usage: result.usage,
        path: 'agent',
        iterations: result.iterations,
        model: result.model ?? (chatCandidates[0] || undefined),
      });
    }

          const isNewSession = !(await this.sessions.has(sessionId));
    await saveToSession(
      { memory: this.memory, sessions: this.sessions, contextManager: this.contextManager },
      sessionId, content, reply, sceneId,
    );
    if (isNewSession) {
            this.emitSessionNewEvent(sessionId, context, 'text', content, reply);
    }

    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
      userId,
      content: reply,
      platform: platform || '',
    })).catch(() => {});

    await this.emitter.dispatch('ai.processing.finish', this.emitter.createPayload(sessionId, context, 'text', {
      path: toolRun.mode === 'pre-exec-fast-path' ? 'fast' : 'agent',
      reply,
    }));

    logPhase(this.phaseConfig, 'turn.end', sessionId, { path: toolRun.mode === 'pre-exec-fast-path' ? 'fast' : 'agent' });

    this.emitter.emit('ai.typing.stop', this.emitter.createPayload(sessionId, context, 'text', {
      reason: 'processing_complete',
    }));

    return parseOutput(reply);
  }

  private resolveAgentToolsForTurn(
    allTools: AgentTool[],
    context: ToolContext,
  ): { tools: AgentTool[]; deferredStats?: string } {
    if (!this.config.toolSearch) {
      return { tools: allTools };
    }
    const toolSearchPool = filterToolsForToolSearchCatalog(allTools);
    const built = buildOrchestratorAgentTools({
      allTools: toolSearchPool,
      config: this.config,
      context,
      getDeferredCatalog: () => this.deferredCatalog,
      runWorker: (goal, toolQuery) => this.runDeferredWorker(goal, toolQuery, context, toolSearchPool),
    });
    this.deferredCatalog = built.deferred;
    logger.debug(formatCompact( {
      tool_search: `${built.orchestratorTools.length}+${built.deferred.length}`,
      stats: built.domainStats,
    }));
    return { tools: built.orchestratorTools, deferredStats: built.domainStats };
  }

  private async runDeferredWorker(
    goal: string,
    toolQuery: string | undefined,
    context: ToolContext,
    allTools: AgentTool[],
  ): Promise<string> {
    await notifySubagentGoal(context, goal);
    const allByName = new Map(allTools.map(t => [t.name, t]));
    const workerBase: AgentTool[] = [];
    for (const name of this.config.toolSearchWorkerBaseTools) {
      const t = allByName.get(name);
      if (t) workerBase.push(t);
    }
    const result = await this.deferredWorkerRunner.runSync({
      goal,
      toolQuery,
      deferredCatalog: this.deferredCatalog,
      workerBaseTools: workerBase,
      allToolsByName: allByName,
      origin: context,
      maxToolResults: this.config.toolSearchMaxResults,
      execPolicyConfig: this.config,
      execApprovalMode: this.config.taskExecApprovalMode,
      modelRegistry: this.modelRegistry,
      provider: this.provider,
      maxIterations: this.config.maxSubagentIterations,
      onEvent: (event) => {
        const sessionId = SessionManager.generateId(
          context.platform || '',
          context.senderId || '',
          context.sceneId,
        );
        const payload = this.emitter.createPayload(sessionId, context, 'text', {
          path: 'agent',
          content: event.goal,
          loadedToolNames: event.loadedToolNames,
          status: event.status,
          iterations: event.iterations,
          error: event.error,
        });
        if (event.phase === 'start') {
          this.emitter.emit('ai.deferred.start', payload);
        } else {
          this.emitter.emit('ai.deferred.finish', payload);
        }
      },
    });
    return result.summary;
  }

  private buildDisciplinedPrompt(basePrompt: string): string {
    const guidance = [
      '# Style',
      '- Lead with the answer or result.',
      '- Be concise, direct, and useful.',
      '',
      '# Safety',
      ...FIXED_DISCIPLINE_RULES.map(rule => `- ${rule}`),
    ].join('\n');
    return `${basePrompt}\n\n${guidance}`;
  }

  async processMultimodal(
    parts: ContentPart[],
    context: ToolContext,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const { senderId, sceneId, platform, botId, messageId } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const userId = senderId || 'unknown';
    await this.emitter.dispatch('ai.processing.start', this.emitter.createPayload(sessionId, context, 'multimodal'));

    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      await this.emitter.dispatch('ai.processing.finish', this.emitter.createPayload(sessionId, context, 'multimodal', {
        path: 'rate_limited',
        reply: rateCheck.message || '请稍后再试',
        reason: 'rate_limited',
      }));
      await this.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'rate_limited' });
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // Typing Indicator：发射事件，由适配器插件自行决定如何响应
    this.emitter.emit('ai.typing.start', this.emitter.createPayload(sessionId, context, 'multimodal', {
      reason: 'processing',
    }));

    this.beginActiveTurn();

    const rawHistoryMessages = await buildHistoryMessages(this.memory, sessionId);
    const profileSummary = await this.userProfiles.buildProfileSummary(userId);
    const personaEnhanced = this.buildDisciplinedPrompt(buildEnhancedPersona(this.config, profileSummary, ''));

    // Build text summary describing the multimodal content
    const textFragments: string[] = [];
    const llmParts: ContentPart[] = [];

    /** Full multimodal ContentPart union (core/ai may export a narrower type in some builds) */
    type MultimodalPart =
      | ContentPart
      | { type: 'video_url'; video_url: { url: string } }
      | { type: 'face'; face: { id: string; text?: string } };

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
          // Most LLMs don't support video natively; describe it as a URL for context
          llmParts.push({ type: 'text', text: `[用户发送了一个视频: ${p.video_url.url}]` });
          break;
        case 'audio':
          textFragments.push('[音频]');
          llmParts.push(p);
          break;
        case 'face':
          textFragments.push(p.face.text || `[表情:${p.face.id}]`);
          llmParts.push({ type: 'text', text: p.face.text ? `[表情: ${p.face.text}]` : `[表情ID: ${p.face.id}]` });
          break;
      }
    }

    const textContent = textFragments.join(' ') || '[多模态消息]';
    const platformMarkdown = await resolveAgentPromptMarkdown({
      ctx: {
        slot: 'orchestrator',
        toolContext: context,
        toolSearch: !!this.config.toolSearch,
        userMessagePreview: textContent.slice(0, 500),
      },
      config: this.config,
      sessionId,
    });
    const visionSystemPrompt = appendQuoteContextSystemHint(
      buildLiteSystemPromptWithPlatform(
        personaEnhanced,
        platformMarkdown,
        buildContextHint(context, textContent),
      ),
      context,
    );
    const visionCandidates = resolveModelCandidates(this.provider.models, this.modelRegistry, this.provider.name, this.config, 'vision');
    const { messages: historyMessages, result: pruneResult } = pruneHistoryWithBudget({
      messages: rawHistoryMessages,
      config: this.config,
      provider: this.provider,
      modelRegistry: this.modelRegistry,
      model: visionCandidates[0],
    });
    if (pruneResult.droppedCount > 0) {
      logger.debug(`[多模态上下文窗口] 丢弃 ${pruneResult.droppedCount} 条历史消息 (${pruneResult.droppedTokens} tokens)`);
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
        for await (const chunk of this.provider.chatStream({ model: visionModel, messages })) {
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
          logger.warn(formatCompact( { mode: 'multimodal', fallback: visionModel, reason: 'empty_stream' }));
          const response = await this.provider.chat({ model: visionModel, messages });
          if (response.usage) lastUsage = response.usage;
          const msg = response.choices[0]?.message?.content;
          reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
        }
        if (reply) break; // 成功，退出循环
      } catch (err) {
        const isLast = i === visionCandidates.length - 1;
        if (isLast) {
          try {
            const response = await this.provider.chat({ model: visionModel, messages });
            if (response.usage) lastUsage = response.usage;
            const msg = response.choices[0]?.message?.content;
            reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
          } catch { /* all candidates exhausted */ }
        } else {
          logger.warn(formatCompact( {
            mode: 'multimodal',
            fallback: `${visionModel}→${visionCandidates[i + 1]}`,
            error: truncatePreview((err as Error).message),
          }));
        }
      }
    }

    if (!reply) reply = '抱歉，我无法理解这条消息。';
    reply = sanitizeAssistantReply(reply);
    await this.emitter.dispatch('ai.response', this.emitter.createPayload(sessionId, context, 'multimodal', {
      path: 'multimodal',
      model: usedVisionModel,
      reply,
    }));
    const isMultimodalNewSession = !(await this.sessions.has(sessionId));
    await saveToSession(
      { memory: this.memory, sessions: this.sessions, contextManager: this.contextManager },
      sessionId, textContent, reply, sceneId,
    );
    if (isMultimodalNewSession) {
      this.emitSessionNewEvent(sessionId, context, 'multimodal', textContent, reply);
    }
    await this.finalizeActiveTurn({
      usage: lastUsage ?? EMPTY_USAGE,
      path: 'multimodal',
      model: usedVisionModel,
    });
    await this.emitter.dispatch('ai.processing.finish', this.emitter.createPayload(sessionId, context, 'multimodal', {
      path: 'multimodal',
      model: usedVisionModel,
      reply,
    }));

    this.emitter.emit('ai.typing.stop', this.emitter.createPayload(sessionId, context, 'multimodal', {
      reason: 'processing_complete',
    }));

    return parseOutput(reply);
  }

  // ── Internal helpers ────────────────────────────────────────────────

  // ── Lifecycle ───────────────────────────────────────────────────────

  isReady(): boolean {
    return true;
  }

  dispose(): void {
    this.memory.dispose();
    this.sessions.dispose();
    this.externalTools.clear();
    this.userProfiles.dispose();
    this.rateLimiter.dispose();
    if (this.subagentManager) {
      this.subagentManager.dispose();
      this.subagentManager = null;
    }
  }
}
