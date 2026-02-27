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
 *  11. 主动跟进：schedule_followup 定时回查
 *  12. 多模态输入：图片/音频直接传给视觉模型
 */

import { Logger } from '@zhin.js/logger';
import type { Tool, ToolContext } from '../types.js';
import type { SkillFeature } from '../built/skill.js';
import type {
  AIProvider,
  AgentTool,
  ChatMessage,
  ContentPart,
} from './types.js';
import { createAgent } from './agent.js';
import { SessionManager, createMemorySessionManager } from './session.js';
import type { ContextManager } from './context-manager.js';
import { ConversationMemory } from './conversation-memory.js';
import type { OutputElement } from './output.js';
import { parseOutput } from './output.js';
import { UserProfileStore } from './user-profile.js';
import { RateLimiter } from './rate-limiter.js';
import { detectTone } from './tone-detector.js';
import { FollowUpManager, type FollowUpSender } from './follow-up.js';
import { SubagentManager, type SubagentResultSender } from './subagent.js';
import {
  pruneHistoryForContext,
  DEFAULT_CONTEXT_TOKENS,
} from './compaction.js';
import { triggerAIHook, createAIHookEvent } from './hooks.js';

// ── Extracted modules ───────────────────────────────────────────────
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  DEFAULT_CONFIG,
} from './zhin-agent-config.js';
import { applyExecPolicyToTools } from './zhin-agent-exec-policy.js';
import { collectRelevantTools } from './zhin-agent-tool-collector.js';
import {
  buildEnhancedPersona,
  buildContextHint,
  buildRichSystemPrompt,
  buildUserMessageWithHistory,
} from './zhin-agent-prompt.js';
import {
  createChatHistoryTool,
  createUserProfileTool,
  createScheduleFollowUpTool,
  createSpawnTaskTool,
} from './zhin-agent-builtin-tools.js';

// Re-export public types for backward compat
export type { ZhinAgentConfig, OnChunkCallback } from './zhin-agent-config.js';

const logger = new Logger(null, 'ZhinAgent');
const now = () => performance.now();

// ============================================================================
// ZhinAgent
// ============================================================================

export class ZhinAgent {
  private provider: AIProvider;
  private config: Required<ZhinAgentConfig>;
  private skillRegistry: SkillFeature | null = null;
  private sessions: SessionManager;
  private contextManager: ContextManager | null = null;
  private memory: ConversationMemory;
  private externalTools: Map<string, AgentTool> = new Map();
  private userProfiles: UserProfileStore;
  private rateLimiter: RateLimiter;
  private followUps: FollowUpManager;
  private subagentManager: SubagentManager | null = null;
  private bootstrapContext: string = '';
  private activeSkillsContext: string = '';
  private skillsSummaryXML: string = '';

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.sessions = createMemorySessionManager();
    this.memory = new ConversationMemory({
      minTopicRounds: this.config.minTopicRounds,
      slidingWindowSize: this.config.slidingWindowSize,
      topicChangeThreshold: this.config.topicChangeThreshold,
    });
    this.memory.setProvider(provider);
    this.userProfiles = new UserProfileStore();
    this.rateLimiter = new RateLimiter(this.config.rateLimit);
    this.followUps = new FollowUpManager();
  }

  // ── DI setters ──────────────────────────────────────────────────────

  setSkillRegistry(registry: SkillFeature): void {
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

  upgradeMemoryToDatabase(msgModel: any, sumModel: any): void {
    this.memory.upgradeToDatabase(msgModel, sumModel);
  }

  upgradeProfilesToDatabase(model: any): void {
    this.userProfiles.upgradeToDatabase(model);
  }

  upgradeFollowUpsToDatabase(model: any): void {
    this.followUps.upgradeToDatabase(model);
  }

  setFollowUpSender(sender: FollowUpSender): void {
    this.followUps.setSender(sender);
  }

  async restoreFollowUps(): Promise<number> {
    return this.followUps.restore();
  }

  initSubagentManager(createTools: () => AgentTool[]): void {
    this.subagentManager = new SubagentManager({
      provider: this.provider,
      workspace: process.cwd(),
      createTools,
      maxIterations: this.config.maxSubagentIterations,
      execPolicyConfig: this.config,
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

    // 0. Rate limit
    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      userId,
      content,
      platform: platform || '',
    })).catch(() => {});

    // 1. Collect tools
    const tFilter = now();
    const allTools = collectRelevantTools(content, context, externalTools, {
      config: this.config,
      skillRegistry: this.skillRegistry,
      externalRegistered: this.externalTools,
    });

    // Inject context-aware built-in tools on keyword match
    if (/之前|上次|历史|回忆|聊过|记录|还记得|曾经/i.test(content)) {
      allTools.push(createChatHistoryTool(sessionId, this.memory));
    }
    if (/偏好|设置|配置|档案|资料|时区|timezone|profile|喜好|我叫|叫我|记住我/i.test(content)) {
      allTools.push(createUserProfileTool(userId, this.userProfiles));
    }
    if (/提醒|定时|过一会|跟进|别忘|取消提醒|reminder|分钟后|小时后/i.test(content)) {
      allTools.push(createScheduleFollowUpTool(sessionId, context, this.followUps));
    }
    if (this.subagentManager && /后台|子任务|spawn|异步|background|并行|独立处理/i.test(content)) {
      allTools.push(createSpawnTaskTool(context, this.subagentManager));
    }

    const filterMs = (now() - tFilter).toFixed(0);

    // 2. History + profile
    const tMem = now();
    let historyMessages = await this.buildHistoryMessages(sessionId);

    const contextTokens = this.config.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
    const maxHistoryShare = this.config.maxHistoryShare ?? 0.5;
    const pruneResult = pruneHistoryForContext({
      messages: historyMessages,
      maxContextTokens: contextTokens,
      maxHistoryShare,
    });
    historyMessages = pruneResult.messages;
    if (pruneResult.droppedCount > 0) {
      logger.debug(`[上下文窗口] 丢弃 ${pruneResult.droppedCount} 条历史消息 (${pruneResult.droppedTokens} tokens)`);
    }

    const memMs = (now() - tMem).toFixed(0);

    // 2.5 Profile + tone
    const profileSummary = await this.userProfiles.buildProfileSummary(userId);
    const toneHint = this.config.toneAwareness ? detectTone(content).hint : '';
    const personaEnhanced = buildEnhancedPersona(this.config, profileSummary, toneHint);

    // 3. No tools → chat path
    if (allTools.length === 0) {
      logger.debug(`[闲聊路径] 过滤=${filterMs}ms, 记忆=${memMs}ms (${historyMessages.length}条), 0 工具`);
      const tLLM = now();
      const reply = await this.streamChatWithHistory(content, personaEnhanced, historyMessages, onChunk);
      const llmMs = (now() - tLLM).toFixed(0);
      logger.info(`[闲聊路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${llmMs}ms, 总=${(now() - t0).toFixed(0)}ms`);
      await this.saveToSession(sessionId, content, reply, sceneId);
      return parseOutput(reply);
    }

    logger.debug(`[工具路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, ${allTools.length} 工具 (${allTools.map(t => t.name).join(', ')})`);

    // 4. Pre-executable tools
    const preExecTools: AgentTool[] = [];
    for (const tool of allTools) {
      if (tool.preExecutable) preExecTools.push(tool);
    }

    // 5. Pre-execution
    let preData = '';
    if (preExecTools.length > 0) {
      const tPre = now();
      logger.debug(`预执行: ${preExecTools.map(t => t.name).join(', ')}`);
      const results = await Promise.allSettled(
        preExecTools.map(async (tool) => {
          const result = await Promise.race([
            tool.execute({}),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('超时')), this.config.preExecTimeout)),
          ]);
          return { name: tool.name, result };
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          let s = typeof r.value.result === 'string' ? r.value.result : JSON.stringify(r.value.result);
          if (s.length > 500) {
            s = s.slice(0, 500) + `\n... (truncated, ${s.length} chars total)`;
          }
          preData += `\n【${r.value.name}】${s}`;
        }
      }
      logger.debug(`预执行耗时: ${(now() - tPre).toFixed(0)}ms`);
    }

    // 6. Path selection
    let reply: string;
    const hasNonPreExecTools = allTools.some(t => !t.preExecutable);

    if (!hasNonPreExecTools && preData) {
      // Fast path
      const tLLM = now();
      const prompt = `${personaEnhanced}

以下是根据用户问题自动获取的实时数据：
${preData}

请基于以上数据，用自然流畅的中文回答用户问题。突出重点，适当使用 emoji。`;
      reply = await this.streamChatWithHistory(content, prompt, historyMessages, onChunk);
      logger.info(`[快速路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${(now() - tLLM).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    } else {
      // Agent path
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
${preData ? `\n已获取数据：${preData}\n` : ''}`;

      const agentTools = applyExecPolicyToTools(this.config, allTools);

      // Adaptive maxIterations: boost when skills are active (multi-step skill flows)
      const SKILL_ITERATION_BOOST = 3;
      const hasSkillActivation = agentTools.some(t => t.name === 'activate_skill' || t.name === 'install_skill');
      const effectiveMaxIterations = hasSkillActivation
        ? this.config.maxIterations + SKILL_ITERATION_BOOST
        : this.config.maxIterations;

      const agent = createAgent(this.provider, {
        systemPrompt,
        tools: agentTools,
        maxIterations: effectiveMaxIterations,
      });

      const userMessageWithHistory = buildUserMessageWithHistory(historyMessages, content);
      const result = await agent.run(userMessageWithHistory, []);
      reply = result.content || this.fallbackFormat(result.toolCalls);
      logger.info(`[Agent 路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, Agent=${(now() - tAgent).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    }

    await this.saveToSession(sessionId, content, reply, sceneId);

    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
      userId,
      content: reply,
      platform: platform || '',
    })).catch(() => {});

    return parseOutput(reply);
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

    const historyMessages = await this.buildHistoryMessages(sessionId);
    const profileSummary = await this.userProfiles.buildProfileSummary(userId);
    const personaEnhanced = buildEnhancedPersona(this.config, profileSummary, '');

    const textContent = parts
      .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join(' ') || '[多模态消息]';

    const visionModel = this.config.visionModel || this.provider.models[0];

    const messages: ChatMessage[] = [
      { role: 'system', content: personaEnhanced },
      ...historyMessages,
      { role: 'user', content: parts },
    ];

    let reply = '';
    try {
      for await (const chunk of this.provider.chatStream({ model: visionModel, messages })) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta && typeof delta === 'string') {
          reply += delta;
          if (onChunk) onChunk(delta, reply);
        }
      }
    } catch {
      const response = await this.provider.chat({ model: visionModel, messages });
      const msg = response.choices[0]?.message?.content;
      reply = typeof msg === 'string' ? msg : '';
    }

    if (!reply) reply = '抱歉，我无法理解这张图片。';
    await this.saveToSession(sessionId, textContent, reply, sceneId);
    return parseOutput(reply);
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private async buildHistoryMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.memory.buildContext(sessionId);
  }

  private async streamChatWithHistory(
    content: string,
    systemPrompt: string,
    history: ChatMessage[],
    onChunk?: OnChunkCallback,
  ): Promise<string> {
    const model = this.provider.models[0];
    const userContent = history.length > 0
      ? buildUserMessageWithHistory(history, content)
      : content;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    try {
      let result = '';
      for await (const chunk of this.provider.chatStream({ model, messages })) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta && typeof delta === 'string') {
          result += delta;
          if (onChunk) onChunk(delta, result);
        }
      }
      return result;
    } catch {
      const response = await this.provider.chat({ model, messages });
      const msg = response.choices[0]?.message?.content;
      const result = typeof msg === 'string' ? msg : '';
      if (onChunk && result) onChunk(result, result);
      return result;
    }
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
    if (toolCalls.length === 0) return '处理完成。';
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
    this.followUps.dispose();
    if (this.subagentManager) {
      this.subagentManager.dispose();
      this.subagentManager = null;
    }
  }
}

