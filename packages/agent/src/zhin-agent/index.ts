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

import { Logger, getPlugin } from '@zhin.js/core';
import type { AIProvider, AgentTool, ChatMessage, ContentPart } from '@zhin.js/ai';
import type { Tool, ToolContext } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import { createAgent } from '@zhin.js/ai';
import { SessionManager, createMemorySessionManager } from '@zhin.js/ai';
import type { ContextManager } from '@zhin.js/ai';
import { ConversationMemory } from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import { parseOutput } from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import { UserProfileStore } from '../user-profile.js';
import {
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  normalizeWebSearchLocaleHint,
} from '../builtin/web-search-locale.js';
import { RateLimiter } from '@zhin.js/ai';
import { detectTone } from '@zhin.js/ai';
import { SubagentManager, type SubagentResultSender } from '../subagent.js';
import { triggerAIHook, createAIHookEvent } from '../hooks.js';

// ── Sub-modules ─────────────────────────────────────────────────────
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
} from './config.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import {
  buildEnhancedPersona,
  buildContextHint,
  buildRichSystemPrompt,
  buildUserMessageWithHistory,
  FIXED_DISCIPLINE_RULES,
} from './prompt.js';
import {
  buildPreExecFastPathPrompt,
  collectRuntimeTools,
  planToolRun,
} from './tool-runtime.js';
import { stripHallucinatedToolCalls, stripThinkBlocks } from './text-sanitize.js';
import { pruneHistoryWithBudget } from './context-budget.js';
import { resolveModelHarness } from './model-harness.js';
import { RESERVED_TOOL_NAMES, RESERVED_TOOL_NAME_PREFIXES } from '../reserved-tools.js';
import { createOwnerOrchestratedToolResultTransform } from '../orchestrator/owner-confirm-orchestration.js';

export type { ZhinAgentConfig, OnChunkCallback } from './config.js';

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

// ============================================================================
// ZhinAgent
// ============================================================================

export class ZhinAgent {
  private provider: AIProvider;
  private config: Required<ZhinAgentConfig>;
  private skillRegistry: SkillRegistry | null = null;
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

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.phaseTraceEnabled = isPhaseTraceEnabled(this.config);
    this.sessions = createMemorySessionManager();
    this.memory = new ConversationMemory({
      minTopicRounds: this.config.minTopicRounds,
      slidingWindowSize: this.config.slidingWindowSize,
      topicChangeThreshold: this.config.topicChangeThreshold,
    });
    this.memory.setProvider(provider);
    this.userProfiles = new UserProfileStore();
    this.rateLimiter = new RateLimiter(this.config.rateLimit);
  }

  // ── DI setters ──────────────────────────────────────────────────────

  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
    logger.debug(`SkillRegistry connected (${registry.size} skills)`);
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

  /** 根据任务类型选择最合适的模型，优先使用 config 显式指定，其次 ModelRegistry，回退到 provider.models[0] */
  private resolveModel(task: 'chat' | 'vision' | 'tool_call' | 'summary' = 'chat', preferred?: string): string {
    return this.resolveModelCandidates(task, preferred)[0];
  }

  /**
   * 返回按优先级排序的候选模型列表（用于自动降级）。
   * 第一个是最优选择，失败后依次尝试后续模型。
   */
  private resolveModelCandidates(task: 'chat' | 'vision' | 'tool_call' | 'summary' = 'chat', preferred?: string): string[] {
    const candidates: string[] = [];

    // 1. 用户显式指定 / 配置指定优先
    if (preferred) candidates.push(preferred);
    if (task === 'chat' && this.config.chatModel && !candidates.includes(this.config.chatModel)) {
      candidates.push(this.config.chatModel);
    }
    if (task === 'vision' && this.config.visionModel && !candidates.includes(this.config.visionModel)) {
      candidates.push(this.config.visionModel);
    }

    // 2. ModelRegistry 自动排序的候选列表
    if (this.modelRegistry) {
      for (const id of this.modelRegistry.selectModels(this.provider.name, task, 5)) {
        if (!candidates.includes(id)) candidates.push(id);
      }
    }

    // 3. 兜底: provider.models[0]
    const fallback = this.provider.models[0];
    if (fallback && !candidates.includes(fallback)) candidates.push(fallback);

    return candidates;
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

  // ── Core processing ─────────────────────────────────────────────────

  async process(
    content: string,
    context: ToolContext,
    externalTools: Tool[] = [],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const t0 = now();
    const { senderId, sceneId, platform } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const userId = senderId || 'unknown';
    this.logPhase('turn.start', sessionId, {
      mode: 'text',
      provider: this.provider.name,
    });

    // 0. Rate limit
    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      this.logPhase('turn.rate_limited', sessionId, { userId });
      logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // 0.5 工具上下文：web_search 语言（档案 preferred_language / language，否则默认中文）
    const contextForTools = await this.attachWebSearchLocale(context, userId);

    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      userId,
      content,
      platform: platform || '',
    })).catch(() => {});

    // 1. Collect tools
    const tFilter = now();
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
    });

    const filterMs = (now() - tFilter).toFixed(0);
    this.logPhase('tools.collected', sessionId, { count: allTools.length });

    logger.info(`[工具过滤] ${allTools.length} 个工具: ${allTools.map(t => t.name).join(', ') || '(无)'}`);

    // 2. History + profile (parallel)
    const tMem = now();
    const [rawHistoryMessages, profileSummary] = await Promise.all([
      this.buildHistoryMessages(sessionId),
      this.userProfiles.buildProfileSummary(userId),
    ]);

    const chatCandidates = this.resolveModelCandidates('chat');
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
    this.logPhase('context.ready', sessionId, { historyCount: historyMessages.length });

    // 2.5 Tone + persona
    const toneHint = this.config.toneAwareness ? detectTone(content).hint : '';
    const personaEnhanced = buildEnhancedPersona(this.config, profileSummary, toneHint);

    // 3. No tools → chat path (prefer per-session model, then lightweight model)
    if (allTools.length === 0) {
      this.logPhase('path.chat', sessionId, { toolCount: 0 });
      const liteModel = this.config.chatLiteModel || undefined;
      const chatSystemPrompt = this.buildDisciplinedPrompt(personaEnhanced);
      logger.info(`[System Prompt] chat-path: ${chatSystemPrompt.length} chars${liteModel ? `, model=${liteModel}` : ''}`);
      logger.debug(`[闲聊路径] 过滤=${filterMs}ms, 记忆=${memMs}ms (${historyMessages.length}条), 0 工具`);
      const tLLM = now();
      this.logPhase('chat.llm.start', sessionId, { model: liteModel || chatCandidates[0] || '' });
      let reply = await this.streamChatWithHistory(content, chatSystemPrompt, historyMessages, onChunk, liteModel);
      reply = stripHallucinatedToolCalls(reply);
      const llmMs = (now() - tLLM).toFixed(0);
      this.logPhase('chat.llm.end', sessionId, { durationMs: Number(llmMs) });
      logger.info(`[闲聊路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${llmMs}ms, 总=${(now() - t0).toFixed(0)}ms`);
      await this.saveToSession(sessionId, content, reply, sceneId);
      this.logPhase('turn.end', sessionId, { path: 'chat' });
      return parseOutput(reply);
    }

    logger.debug(`[工具路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, ${allTools.length} 工具 (${allTools.map(t => t.name).join(', ')})`);

    // 4. Pre-executable tools
    const preExecCandidates = allTools.filter(tool => tool.preExecutable);
    const tPre = preExecCandidates.length > 0 ? now() : 0;
    if (preExecCandidates.length > 0) {
      logger.debug(`预执行: ${preExecCandidates.map(t => t.name).join(', ')}`);
    }
    const toolRun = await planToolRun(allTools, this.config.preExecTimeout);
    this.logPhase('preexec.done', sessionId, {
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
      this.logPhase('path.pre_exec_fast', sessionId, { toolCount: allTools.length });
      // Fast path
      const tLLM = now();
      const prompt = this.buildDisciplinedPrompt(buildPreExecFastPathPrompt(personaEnhanced, preData));
      logger.info(`[System Prompt] fast-path: ${prompt.length} chars`);
      this.logPhase('fast.llm.start', sessionId, { model: chatCandidates[0] || '' });
      reply = await this.streamChatWithHistory(content, prompt, historyMessages, onChunk);
      this.logPhase('fast.llm.end', sessionId, { durationMs: Math.round(now() - tLLM) });
      logger.info(`[快速路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${(now() - tLLM).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    } else {
      this.logPhase('path.agent', sessionId, { toolCount: allTools.length });
      const tAgent = now();
      logger.debug(`Agent 路径: ${allTools.length} 个工具`);
      const contextHint = buildContextHint(context, content);

      const richPrompt = buildRichSystemPrompt({
        config: this.config,
        skillRegistry: this.skillRegistry,
        skillsSummaryXML: this.skillsSummaryXML,
        activeSkillsContext: this.activeSkillsContext,
        bootstrapContext: this.bootstrapContext,
      });
      const systemPrompt = `${richPrompt}
${contextHint}
${preData ? `\nPre-fetched data:\n${preData}\n` : ''}`;

      logger.info(`[System Prompt] ${systemPrompt.length} chars`);
      logger.debug(`[System Prompt Full]\n${systemPrompt}\n---END---`);

      const agentTools = applyExecPolicyToTools(this.config, allTools);

      // Adaptive maxIterations: boost when skills are active (multi-step skill flows)
      const SKILL_ITERATION_BOOST = 3;
      const hasSkillActivation = agentTools.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
      const harness = resolveModelHarness(this.provider.name, chatCandidates[0] || '', this.config.modelHarness);
      const baseIterations = harness.maxIterations ?? this.config.maxIterations;
      const effectiveMaxIterations = hasSkillActivation
        ? baseIterations + SKILL_ITERATION_BOOST
        : baseIterations;
      this.logPhase('harness.resolved', sessionId, {
        model: chatCandidates[0] || '',
        harnessMaxIterations: harness.maxIterations ?? null,
        effectiveMaxIterations,
      });

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
          plugin: getPlugin(),
        }),
      });

      const userMessageWithHistory = buildUserMessageWithHistory(historyMessages, content);
      let result;
      try {
        this.logPhase('agent.run.start', sessionId, { model: chatCandidates[0] || '' });
        result = await agent.run(userMessageWithHistory, []);
        this.logPhase('agent.run.end', sessionId, { iterations: result.iterations });
      } finally {
        agent.dispose();
      }
      reply = stripHallucinatedToolCalls(stripThinkBlocks(result.content)) || this.fallbackFormat(result.toolCalls);
      logger.info(`[Agent 路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, Agent=${(now() - tAgent).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    }

    await this.saveToSession(sessionId, content, reply, sceneId);

    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
      userId,
      content: reply,
      platform: platform || '',
    })).catch(() => {});

    this.logPhase('turn.end', sessionId, { path: toolRun.mode === 'pre-exec-fast-path' ? 'fast' : 'agent' });
    return parseOutput(reply);
  }

  private buildDisciplinedPrompt(basePrompt: string): string {
    const discipline = `# Discipline\n${FIXED_DISCIPLINE_RULES.map(rule => `- ${rule}`).join('\n')}`;
    return `${discipline}\n\n${basePrompt}`;
  }

  private logPhase(phase: string, sessionId: string, extra: Record<string, unknown> = {}): void {
    if (!this.phaseTraceEnabled) return;
    logger.info({ phase, sessionId, ...extra }, '[AGENT_PHASE]');
  }

  async processMultimodal(
    parts: ContentPart[],
    context: ToolContext,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const { senderId, sceneId, platform } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const userId = senderId || 'unknown';

    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    const rawHistoryMessages = await this.buildHistoryMessages(sessionId);
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
    const visionCandidates = this.resolveModelCandidates('vision');
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
      { role: 'system', content: personaEnhanced },
      ...historyMessages,
      { role: 'user', content: llmParts },
    ];

    let reply = '';
    for (let i = 0; i < visionCandidates.length; i++) {
      const visionModel = visionCandidates[i];
      try {
        reply = '';
        for await (const chunk of this.provider.chatStream({ model: visionModel, messages })) {
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
          logger.warn(`[processMultimodal] ${visionModel} 流式为空，尝试非流式`);
          const response = await this.provider.chat({ model: visionModel, messages });
          const msg = response.choices[0]?.message?.content;
          reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
        }
        if (reply) break; // 成功，退出循环
      } catch (err) {
        const isLast = i === visionCandidates.length - 1;
        if (isLast) {
          try {
            const response = await this.provider.chat({ model: visionModel, messages });
            const msg = response.choices[0]?.message?.content;
            reply = stripThinkBlocks(typeof msg === 'string' ? msg : '');
          } catch { /* all candidates exhausted */ }
        } else {
          logger.warn(`[processMultimodal] ${visionModel} 失败，降级到 ${visionCandidates[i + 1]}: ${(err as Error).message}`);
        }
      }
    }

    if (!reply) reply = '抱歉，我无法理解这条消息。';
    reply = stripHallucinatedToolCalls(reply);
    await this.saveToSession(sessionId, textContent, reply, sceneId);
    return parseOutput(reply);
  }

  // ── Internal helpers ────────────────────────────────────────────────

  /**
   * 为内置工具注入 `extra.web_search_locale`：
   * - 若调用方已在 `context.extra.web_search_locale` 中设置，则规范化后沿用；
   * - 否则读取用户档案 `preferred_language` / `language`；
   * - 均未设置时不在 extra 中写入，web_search 默认使用中文市场。
   */
  private async attachWebSearchLocale(context: ToolContext, userId: string): Promise<ToolContext> {
    const extra: Record<string, unknown> = { ...(context.extra ?? {}) };
    const existing = extra[WEB_SEARCH_LOCALE_EXTRA_KEY];
    if (typeof existing === 'string' && existing.trim()) {
      extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(existing);
      return { ...context, extra };
    }
    const [preferred, language] = await Promise.all([
      this.userProfiles.get(userId, 'preferred_language'),
      this.userProfiles.get(userId, 'language'),
    ]);
    const hint = (preferred ?? language)?.trim();
    if (hint) {
      extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(hint);
    }
    return { ...context, extra };
  }

  private async buildHistoryMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.memory.buildContext(sessionId);
  }

  private async streamChatWithHistory(
    content: string,
    systemPrompt: string,
    history: ChatMessage[],
    onChunk?: OnChunkCallback,
    preferredModel?: string,
  ): Promise<string> {
    const candidates = this.resolveModelCandidates('chat', preferredModel);
    const turnTimeout = this.config.timeout;
    const userContent = history.length > 0
      ? buildUserMessageWithHistory(history, content)
      : content;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const withTurnTimeout = <T>(promise: Promise<T>): Promise<T> =>
      turnTimeout
        ? Promise.race([
            promise,
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error(`LLM 单轮响应超时 (${turnTimeout}ms)`)), turnTimeout),
            ),
          ])
        : promise;

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        let result = '';
        let lastUsage: any = null;
        // 对整个流式消费过程应用超时
        await withTurnTimeout((async () => {
          for await (const chunk of this.provider.chatStream({ model, messages })) {
            if (chunk.usage) lastUsage = chunk.usage;
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            const text = typeof delta.content === 'string' ? delta.content : '';
            if (text) {
              result += text;
              if (onChunk) onChunk(text, result);
            }
          }
        })());
        if (lastUsage) {
          logger.info(`[闲聊] token 用量: prompt=${lastUsage.prompt_tokens}, completion=${lastUsage.completion_tokens}, total=${lastUsage.total_tokens} (model=${model})`);
        }
        result = stripThinkBlocks(result);
        if (result) return result;
        // Streaming returned empty content — try non-streaming with same model
        logger.warn(`[streamChat] ${model} 流式响应为空，尝试非流式`);
        const response = await withTurnTimeout(this.provider.chat({ model, messages }));
        const msg = response.choices?.[0]?.message?.content;
        result = stripThinkBlocks(typeof msg === 'string' ? msg : '');
        if (result) {
          if (onChunk) onChunk(result, result);
          return result;
        }
      } catch (err) {
        const isLast = i === candidates.length - 1;
        if (isLast) {
          // No more candidates — try non-streaming as final attempt
          try {
            const response = await withTurnTimeout(this.provider.chat({ model, messages }));
            const msg = response.choices?.[0]?.message?.content;
            let result = stripThinkBlocks(typeof msg === 'string' ? msg : '');
            if (onChunk && result) onChunk(result, result);
            return result;
          } catch {
            return '';
          }
        }
        logger.warn(`[streamChat] ${model} 失败，降级到 ${candidates[i + 1]}: ${(err as Error).message}`);
      }
    }
    return '';
  }

  private async saveToSession(
    sessionId: string,
    userContent: string,
    assistantContent: string,
    sceneId?: string,
  ): Promise<void> {
    await this.memory.saveRound(sessionId, userContent, assistantContent);
    await this.sessions.addMessage(sessionId, { role: 'user', content: userContent });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: assistantContent });
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }
  }

  private fallbackFormat(toolCalls: { tool: string; args: any; result: any }[]): string {
    if (toolCalls.length === 0) return 'Done.';
    const userFacing = toolCalls.filter(tc => tc.tool !== 'activate_skill');
    if (userFacing.length === 0) {
      return '技能已激活但未能完成后续操作，请重试或换一种方式描述你的需求。';
    }
    return userFacing.map(tc => {
      const s = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
      return `【${tc.tool}】\n${s}`;
    }).join('\n\n');
  }

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
