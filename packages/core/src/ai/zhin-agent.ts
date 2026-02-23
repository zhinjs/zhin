/**
 * ZhinAgent — 全局持久 AI 大脑
 *
 * 取代旧的 AIService.process() 临时创建 Agent 的方式。
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
import { Agent, createAgent } from './agent.js';
import { SessionManager, createMemorySessionManager } from './session.js';
import type { ContextManager } from './context-manager.js';
import { ConversationMemory } from './conversation-memory.js';
import type { OutputElement } from './output.js';
import { parseOutput } from './output.js';
import { UserProfileStore } from './user-profile.js';
import { RateLimiter, type RateLimitConfig } from './rate-limiter.js';
import { detectTone } from './tone-detector.js';
import { FollowUpManager, type FollowUpSender } from './follow-up.js';
import {
  compactSession,
  estimateMessagesTokens,
  pruneHistoryForContext,
  resolveContextWindowTokens,
  evaluateContextWindowGuard,
  DEFAULT_CONTEXT_TOKENS,
} from './compaction.js';
import { triggerAIHook, createAIHookEvent } from './hooks.js';

const logger = new Logger(null, 'ZhinAgent');

/** 高精度计时 */
const now = () => performance.now();

// ============================================================================
// 配置
// ============================================================================

export interface ZhinAgentConfig {
  /** 默认系统人格 */
  persona?: string;
  /** 最大工具调用轮数 */
  maxIterations?: number;
  /** 单次请求超时 (ms) */
  timeout?: number;
  /** 预执行超时 (ms) */
  preExecTimeout?: number;
  /** Skill 选择最大数量 */
  maxSkills?: number;
  /** Tool 选择最大数量 */
  maxTools?: number;
  /** 一个话题至少持续多少轮才触发摘要（默认 5） */
  minTopicRounds?: number;
  /** 滑动窗口大小：最近 N 轮消息（默认 5） */
  slidingWindowSize?: number;
  /** 话题切换检测阈值（0-1，值越低越敏感，默认 0.15） */
  topicChangeThreshold?: number;
  /** 速率限制配置 */
  rateLimit?: RateLimitConfig;
  /** 是否启用情绪感知（默认 true） */
  toneAwareness?: boolean;
  /** 视觉模型名称（如 llava, bakllava），留空则不启用视觉 */
  visionModel?: string;
  /** 上下文窗口 token 数（默认 128000） */
  contextTokens?: number;
  /** 历史记录最大占比（默认 0.5 = 50%） */
  maxHistoryShare?: number;
}

const DEFAULT_CONFIG: Required<ZhinAgentConfig> = {
  persona: '你是一个友好的中文 AI 助手，擅长使用工具帮助用户解决问题。',
  maxIterations: 5,
  timeout: 60_000,
  preExecTimeout: 10_000,
  maxSkills: 3,
  maxTools: 8,
  minTopicRounds: 5,
  slidingWindowSize: 5,
  topicChangeThreshold: 0.15,
  rateLimit: {},
  toneAwareness: true,
  visionModel: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  maxHistoryShare: 0.5,
};

// ============================================================================
// 流式回调
// ============================================================================

/**
 * 流式输出回调 — 适配器可通过此回调实时更新消息
 *
 * @param chunk  增量文本片段
 * @param full   到目前为止的完整文本
 */
export type OnChunkCallback = (chunk: string, full: string) => void;

// ============================================================================
// 权限映射
// ============================================================================

const PERM_MAP: Record<string, number> = {
  user: 0,
  group_admin: 1,
  group_owner: 2,
  bot_admin: 3,
  owner: 4,
};

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
  /** 引导文件上下文（SOUL.md + TOOLS.md + AGENTS.md） */
  private bootstrapContext: string = '';

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

  // ── 依赖注入 ─────────────────────────────────────────────────────────

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

  /** 将 ConversationMemory 升级为数据库存储 */
  upgradeMemoryToDatabase(msgModel: any, sumModel: any): void {
    this.memory.upgradeToDatabase(msgModel, sumModel);
  }

  /** 将 UserProfileStore 升级为数据库存储 */
  upgradeProfilesToDatabase(model: any): void {
    this.userProfiles.upgradeToDatabase(model);
  }

  /** 将 FollowUpManager 升级为数据库存储 */
  upgradeFollowUpsToDatabase(model: any): void {
    this.followUps.upgradeToDatabase(model);
  }

  /** 注入提醒消息发送回调（由 init.ts 在适配器就绪后调用） */
  setFollowUpSender(sender: FollowUpSender): void {
    this.followUps.setSender(sender);
  }

  /**
   * 从数据库恢复未完成的跟进任务（启动时调用）
   * @returns 恢复的任务数量
   */
  async restoreFollowUps(): Promise<number> {
    return this.followUps.restore();
  }

  /** 获取 UserProfileStore（用于外部注册） */
  getUserProfiles(): UserProfileStore {
    return this.userProfiles;
  }

  registerTool(tool: AgentTool): () => void {
    this.externalTools.set(tool.name, tool);
    return () => { this.externalTools.delete(tool.name); };
  }

  /**
   * 注入引导文件上下文（SOUL.md + TOOLS.md + AGENTS.md 的合并内容）
   * 由 init.ts 在加载引导文件后调用
   */
  setBootstrapContext(context: string): void {
    this.bootstrapContext = context;
    logger.debug(`Bootstrap context set (${context.length} chars)`);
  }

  // ── 核心处理入口 ─────────────────────────────────────────────────────

  /**
   * 处理用户消息 — 唯一的公开入口
   *
   * @param content       用户消息文本
   * @param context       工具上下文（平台、发送者、权限等）
   * @param externalTools 外部传入的工具列表
   * @param onChunk       流式输出回调（可选，适配器支持时传入）
   *
   * 路径选择策略（按开销从低到高）：
   *
   *   ┌─ 闲聊路径（最快）────────────────────────────────────────────┐
   *   │  工具过滤 = 0 → 仅 persona prompt → 流式 1 次 LLM 调用      │
   *   └──────────────────────────────────────────────────────────────┘
   *   ┌─ 快速路径（1 轮 LLM）───────────────────────────────────────┐
   *   │  全部命中无参数工具 → 预执行 → 数据注入 prompt → 1 次 LLM    │
   *   └──────────────────────────────────────────────────────────────┘
   *   ┌─ Agent 路径（多轮 LLM）─────────────────────────────────────┐
   *   │  存在需参数工具 → Agent tool-calling → 多轮 LLM              │
   *   └──────────────────────────────────────────────────────────────┘
   */
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

    // ══════ 0. 速率限制检查 ══════
    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      logger.debug(`[速率限制] 用户 ${userId} 被限制: ${rateCheck.message}`);
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // 触发 message:received hook
    triggerAIHook(createAIHookEvent('message', 'received', sessionId, {
      userId,
      content,
      platform: platform || '',
    })).catch(() => {});

    // ══════ 1. 收集工具 — 两级过滤 ══════
    const tFilter = now();
    const allTools = this.collectTools(content, context, externalTools);

    // 按需注入内置工具 — 只在消息匹配关键词时注入，避免污染小模型的上下文
    if (/之前|上次|历史|回忆|聊过|记录|还记得|曾经/i.test(content)) {
      allTools.push(this.createChatHistoryTool(sessionId));
    }
    if (/偏好|设置|配置|档案|资料|时区|timezone|profile|喜好|我叫|叫我|记住我/i.test(content)) {
      allTools.push(this.createUserProfileTool(userId));
    }
    if (/提醒|定时|过一会|跟进|别忘|取消提醒|reminder|分钟后|小时后/i.test(content)) {
      allTools.push(this.createScheduleFollowUpTool(sessionId, context));
    }

    const filterMs = (now() - tFilter).toFixed(0);

    // ══════ 2. 构建会话记忆 + 用户画像 ══════
    const tMem = now();
    let historyMessages = await this.buildHistoryMessages(sessionId);

    // 上下文窗口保护：按 token 预算修剪历史（借鉴 OpenClaw context-window-guard）
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

    // ══════ 2.5 用户画像 & 情绪感知 ══════
    const profileSummary = await this.userProfiles.buildProfileSummary(userId);
    const toneHint = this.config.toneAwareness ? detectTone(content).hint : '';
    const personaEnhanced = this.buildEnhancedPersona(profileSummary, toneHint);

    // ══════ 3. 无工具 → 闲聊路径 (轻量 prompt + 历史) ══════
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

    // ══════ 4. 拆分可预执行 / 普通工具 ══════
    // 只有显式标记 preExecutable=true 的工具才会被预执行（opt-in 模式）
    const preExecTools: AgentTool[] = [];
    for (const tool of allTools) {
      if (tool.preExecutable) preExecTools.push(tool);
    }

    // ══════ 5. 预执行标记的工具 ══════
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
          // 限制单条预执行结果的长度，防止注入过多数据干扰模型
          if (s.length > 500) {
            s = s.slice(0, 500) + `\n... (truncated, ${s.length} chars total)`;
          }
          preData += `\n【${r.value.name}】${s}`;
        }
      }
      logger.debug(`预执行耗时: ${(now() - tPre).toFixed(0)}ms`);
    }

    // ══════ 6. 路径选择 ══════
    let reply: string;

    // 判断是否所有工具都已被预执行（即没有非预执行工具）
    const hasNonPreExecTools = allTools.some(t => !t.preExecutable);

    if (!hasNonPreExecTools && preData) {
      // ── 快速路径: 所有工具都已预执行 → 1 轮 AI ──
      const tLLM = now();
      const prompt = `${personaEnhanced}

以下是根据用户问题自动获取的实时数据：
${preData}

请基于以上数据，用自然流畅的中文回答用户问题。突出重点，适当使用 emoji。`;
      reply = await this.streamChatWithHistory(content, prompt, historyMessages, onChunk);
      logger.info(`[快速路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, LLM=${(now() - tLLM).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    } else {
      // ── Agent 路径: 需要 LLM 决策调用哪些工具 → 多轮 ──
      const tAgent = now();
      logger.debug(`Agent 路径: ${allTools.length} 个工具`);
      const contextHint = this.buildContextHint(context, content);
      
      // 使用结构化系统提示（包含时间、安全准则、技能列表等）
      const richPrompt = this.buildRichSystemPrompt();
      const systemPrompt = `${richPrompt}
${contextHint}
${preData ? `\n已获取数据：${preData}\n` : ''}`;

      // 始终传递所有工具给 Agent，因为 activate_skill 激活后可能需要调用
      // 之前被分类为 noParamTools 的工具（确保技能中引用的所有工具都可用）
      const agentTools = allTools;
      const agent = createAgent(this.provider, {
        systemPrompt,
        tools: agentTools,
        maxIterations: this.config.maxIterations,
      });

      // Agent 路径也注入历史上下文
      const result = await agent.run(content, historyMessages);
      reply = result.content || this.fallbackFormat(result.toolCalls);
      logger.info(`[Agent 路径] 过滤=${filterMs}ms, 记忆=${memMs}ms, Agent=${(now() - tAgent).toFixed(0)}ms, 总=${(now() - t0).toFixed(0)}ms`);
    }

    await this.saveToSession(sessionId, content, reply, sceneId);

    // 触发 message:sent hook
    triggerAIHook(createAIHookEvent('message', 'sent', sessionId, {
      userId,
      content: reply,
      platform: platform || '',
    })).catch(() => {});

    return parseOutput(reply);
  }

  /**
   * 处理多模态消息（图片+文字）
   *
   * 当用户发送图片时，走视觉模型路径。
   */
  async processMultimodal(
    parts: ContentPart[],
    context: ToolContext,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const { senderId, sceneId, platform } = context;
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);
    const userId = senderId || 'unknown';

    // 速率限制
    const rateCheck = this.rateLimiter.check(userId);
    if (!rateCheck.allowed) {
      return parseOutput(rateCheck.message || '请稍后再试');
    }

    // 构建记忆
    const historyMessages = await this.buildHistoryMessages(sessionId);
    const profileSummary = await this.userProfiles.buildProfileSummary(userId);
    const personaEnhanced = this.buildEnhancedPersona(profileSummary, '');

    // 提取文本部分用于保存
    const textContent = parts
      .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join(' ') || '[多模态消息]';

    // 选择模型：优先视觉模型
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
      // fallback 非流式
      const response = await this.provider.chat({ model: visionModel, messages });
      const msg = response.choices[0]?.message?.content;
      reply = typeof msg === 'string' ? msg : '';
    }

    if (!reply) reply = '抱歉，我无法理解这张图片。';
    await this.saveToSession(sessionId, textContent, reply, sceneId);
    return parseOutput(reply);
  }

  // ── 增强人格（注入画像 + 情绪 hint + 引导上下文） ──────────────────

  private buildEnhancedPersona(profileSummary: string, toneHint: string): string {
    let persona = this.config.persona;
    if (profileSummary) {
      persona += `\n\n${profileSummary}`;
    }
    if (toneHint) {
      persona += `\n\n[语气提示] ${toneHint}`;
    }
    // 注入当前时间（所有路径都需要，闲聊/快速/Agent 路径共用）
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: tz });
    persona += `\n\n当前时间: ${timeStr} (${tz})`;
    return persona;
  }

  /**
   * 构建上下文提示 — 告诉 AI 当前身份和场景，帮助工具参数填充
   */
  private buildContextHint(context: ToolContext, _content: string): string {
    const parts: string[] = [];
    if (context.platform) parts.push(`平台:${context.platform}`);
    if (context.botId) parts.push(`Bot:${context.botId}`);
    if (context.senderId) parts.push(`用户:${context.senderId}`);
    if (context.scope) parts.push(`场景类型:${context.scope}`);
    if (context.sceneId) parts.push(`场景ID:${context.sceneId}`);
    if (parts.length === 0) return '';
    return `\n上下文: ${parts.join(' | ')}`;
  }

  // ── 工具收集: 两级过滤 (Skill → Tool) ─────────────────────────────────

  private collectTools(
    message: string,
    context: ToolContext,
    externalTools: Tool[],
  ): AgentTool[] {
    const callerPerm = context.senderPermissionLevel
      ? (PERM_MAP[context.senderPermissionLevel] ?? 0)
      : (context.isOwner ? 4 : context.isBotAdmin ? 3 : context.isGroupOwner ? 2 : context.isGroupAdmin ? 1 : 0);

    const collected: AgentTool[] = [];
    const collectedNames = new Set<string>(); // 用 Set 加速去重

    // 0. 检测用户是否明确提到了已知技能名称
    // 若是，优先包含 activate_skill 以确保 Agent 可以激活该技能
    let mentionedSkill: string | null = null;
    if (this.skillRegistry && this.skillRegistry.size > 0) {
      const msgLower = message.toLowerCase();
      for (const skill of this.skillRegistry.getAll()) {
        // 检查用户消息是否包含技能名称（精确或模糊匹配）
        if (msgLower.includes(skill.name.toLowerCase())) {
          mentionedSkill = skill.name;
          logger.debug(`[技能检测] 用户提到技能: ${mentionedSkill}`);
          break; // 只检测第一个匹配的技能
        }
      }
    }

    // 如果检测到技能名称，从 externalTools 中找 activate_skill 并优先加入
    if (mentionedSkill) {
      const activateSkillTool = externalTools.find(t => t.name === 'activate_skill');
      if (activateSkillTool) {
        const toolPerm = activateSkillTool.permissionLevel ? (PERM_MAP[activateSkillTool.permissionLevel] ?? 0) : 0;
        if (toolPerm <= callerPerm) {
          collected.push(this.toAgentTool(activateSkillTool, context));
          collectedNames.add('activate_skill');
          logger.debug(`[技能激活] 已提前加入 activate_skill 工具（优先级最高）`);
        }
      }
    }

    // 1. 从 SkillRegistry 两级过滤（包含适配器通过 declareSkill 注册的 Skill）
    if (this.skillRegistry) {
      const skills = this.skillRegistry.search(message, { maxResults: this.config.maxSkills });
      const skillStr = skills.length > 0
        ? skills.map(s => `${s.name}(${s.tools?.length || 0}工具)`).join(', ')
        : '(无匹配技能)';
      logger.debug(`[Skill 匹配] ${skillStr}`);

      for (const skill of skills) {
        for (const tool of skill.tools) {
          // 平台过滤：确保 Skill 中的工具也只保留当前平台支持的
          if (tool.platforms?.length && context.platform && !tool.platforms.includes(context.platform)) continue;
          // 场景过滤
          if (tool.scopes?.length && context.scope && !tool.scopes.includes(context.scope)) continue;
          // 权限检查
          const toolPerm = tool.permissionLevel ? (PERM_MAP[tool.permissionLevel] ?? 0) : 0;
          if (toolPerm > callerPerm) continue;
          if (collectedNames.has(tool.name)) continue;
          collected.push(this.toAgentTool(tool, context));
          collectedNames.add(tool.name);
        }
      }
    }

    // 2. 外部传入的工具（ToolService 收集的），跳过已通过 Skill 收集的同名工具
    let deduped = 0;
    for (const tool of externalTools) {
      if (tool.name.startsWith('cmd_') || tool.name.startsWith('process_')) continue;
      const toolPerm = tool.permissionLevel ? (PERM_MAP[tool.permissionLevel] ?? 0) : 0;
      if (toolPerm > callerPerm) continue;
      if (collectedNames.has(tool.name)) {
        deduped++;
        continue;
      }
      collected.push(this.toAgentTool(tool, context));
      collectedNames.add(tool.name);
    }
    if (deduped > 0) {
      logger.debug(`externalTools 去重: 跳过 ${deduped} 个已由 Skill 提供的工具`);
    }

    // 3. 额外注册的工具
    for (const tool of this.externalTools.values()) {
      if (tool.permissionLevel != null && tool.permissionLevel > callerPerm) continue;
      if (collectedNames.has(tool.name)) continue;
      collected.push(tool);
      collectedNames.add(tool.name);
    }

    // 4. 用 Agent.filterTools 做最终相关性排序（阈值 0.3 减少噪音）
    const filtered = Agent.filterTools(message, collected, {
      callerPermissionLevel: callerPerm,
      maxTools: this.config.maxTools,
      minScore: 0.3,
    });

    // 特殊处理：如果检测到了技能名称，确保 activate_skill 排在最前面
    if (mentionedSkill && filtered.length > 0) {
      const activateSkillIdx = filtered.findIndex(t => t.name === 'activate_skill');
      if (activateSkillIdx > 0) {  // 若存在但不在最前
        // 将 activate_skill 移到最前面
        const activateSkillTool = filtered[activateSkillIdx];
        filtered.splice(activateSkillIdx, 1);
        filtered.unshift(activateSkillTool);
        logger.debug(`[工具排序] activate_skill 提升至首位（因检测到技能: ${mentionedSkill}）`);
      }
    }

    // 诊断日志：显示收集的工具总数、过滤后的数量、以及列表
    if (filtered.length > 0) {
      logger.debug(
        `[工具收集] 收集了 ${collected.length} 个工具，过滤后 ${filtered.length} 个，` +
        `用户消息相关性最高的: ${filtered.slice(0, 3).map(t => t.name).join(', ')}`
      );
    } else {
      logger.debug(`[工具收集] 收集了 ${collected.length} 个工具，但过滤后 0 个（没有超过相关性阈值的）`);
    }

    return filtered;
  }

  // ── 辅助方法 ─────────────────────────────────────────────────────────

  /**
   * 将 Tool 转为 AgentTool，注入 ToolContext 以确保执行时鉴权生效。
   *
   * 当参数定义了 contextKey 时：
   *   1. 从 AI 可见的 parameters 中移除该参数（减少 token、避免填错）
   *   2. 执行时自动从 ToolContext 注入对应值，并按声明类型做类型转换
   */
  private toAgentTool(tool: Tool, context?: ToolContext): AgentTool {
    const originalExecute = tool.execute;

    // ── 收集需要自动注入的参数 ──────────────────────────────────
    const contextInjections: Array<{
      paramName: string;
      contextKey: string;
      paramType: string; // 目标参数的 JSON Schema type，用于类型转换
    }> = [];
    let cleanParameters: any = tool.parameters;

    if (context && tool.parameters?.properties) {
      const props = tool.parameters.properties as Record<string, any>;
      const filteredProps: Record<string, any> = {};
      const filteredRequired: string[] = [];

      for (const [key, schema] of Object.entries(props)) {
        if (schema.contextKey && (context as any)[schema.contextKey] != null) {
          // 记录需要注入的映射
          contextInjections.push({
            paramName: key,
            contextKey: schema.contextKey,
            paramType: schema.type || 'string',
          });
        } else {
          // 保留给 AI 的参数
          filteredProps[key] = schema;
          if (tool.parameters.required?.includes(key)) {
            filteredRequired.push(key);
          }
        }
      }

      if (contextInjections.length > 0) {
        cleanParameters = {
          ...tool.parameters,
          properties: filteredProps,
          required: filteredRequired.length > 0 ? filteredRequired : undefined,
        };
      }
    }

    // ── 组装 AgentTool ──────────────────────────────────────────
    const at: AgentTool = {
      name: tool.name,
      description: tool.description,
      parameters: cleanParameters as any,
      execute: context
        ? (args: Record<string, any>) => {
            // 自动注入 context 值，按目标 type 做类型转换
            const enrichedArgs = { ...args };
            for (const { paramName, contextKey, paramType } of contextInjections) {
              let value = (context as any)[contextKey];
              if (paramType === 'number' && typeof value === 'string') {
                value = Number(value);
              } else if (paramType === 'string' && typeof value !== 'string') {
                value = String(value);
              }
              enrichedArgs[paramName] = value;
            }
            return originalExecute(enrichedArgs, context);
          }
        : originalExecute,
    };
    if (tool.tags?.length) at.tags = tool.tags;
    if (tool.keywords?.length) at.keywords = tool.keywords;
    if (tool.permissionLevel) at.permissionLevel = PERM_MAP[tool.permissionLevel] ?? 0;
    if (tool.preExecutable) at.preExecutable = true;
    return at;
  }

  /**
   * 构建结构化 System Prompt（借鉴 OpenClaw 的分段式设计）
   *
   * 段落结构：
   *   1. 身份 + 人格
   *   2. 安全准则
   *   3. 工具调用风格
   *   4. 技能列表（XML 格式）
   *   5. 当前时间
   *   6. 引导文件上下文（SOUL.md, TOOLS.md, AGENTS.md）
   */
  /**
   * 构建精简的 System Prompt — 专为小模型（8B/14B 级）优化
   *
   * 设计原则：
   *   - 控制在 300-500 token 内，为工具定义和历史留足空间
   *   - 规则用短句，不用段落
   *   - 不重复，不举例（模型能从工具定义中推断用法）
   */
  private buildRichSystemPrompt(): string {
    const lines: string[] = [];

    // §1 身份
    lines.push(this.config.persona);
    lines.push('');

    // §2 核心规则（精简为 6 条短句）
    lines.push('## 规则');
    lines.push('1. 直接调用工具执行操作，不要描述步骤或解释意图');
    lines.push('2. 时间/日期问题：直接用下方"当前时间"回答，不调工具');
    lines.push('3. 修改文件必须调用 edit_file/write_file，禁止给手动教程');
    lines.push('4. activate_skill 返回后，必须继续调用其中指导的工具，不要停');
    lines.push('5. 所有回答必须基于工具返回的实际数据');
    lines.push('6. 工具失败时尝试替代方案，不要直接把错误丢给用户');
    lines.push('');

    // §3 技能列表（紧凑格式）
    if (this.skillRegistry && this.skillRegistry.size > 0) {
      const skills = this.skillRegistry.getAll();
      lines.push('## 可用技能');
      for (const skill of skills) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
      lines.push('用户提到技能名 → 调用 activate_skill(name) → 按返回的指导执行工具');
      lines.push('');
    }

    // §4 当前时间
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = now.toLocaleString('zh-CN', { timeZone: tz });
    lines.push(`当前时间: ${timeStr} (${tz})`);
    lines.push('');

    // §5 引导文件上下文（SOUL.md, TOOLS.md, AGENTS.md）
    if (this.bootstrapContext) {
      lines.push(this.bootstrapContext);
    }

    return lines.filter(Boolean).join('\n');
  }

  // ── 内置工具 ─────────────────────────────────────────────────────────

  /**
   * 创建 chat_history 工具 — 让 AI 能主动搜索历史聊天记录
   */
  private createChatHistoryTool(sessionId: string): AgentTool {
    const memory = this.memory;

    return {
      name: 'chat_history',
      description: '搜索与用户的历史聊天记录。可以按关键词搜索，也可以按对话轮次范围查询。当用户问到"之前聊过什么""我们讨论过什么"等回忆类问题时使用。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词（模糊匹配消息内容和摘要）。留空则返回最近几轮记录',
          },
          from_round: {
            type: 'number',
            description: '起始轮次（与 to_round 配合使用，精确查询某段对话）',
          },
          to_round: {
            type: 'number',
            description: '结束轮次',
          },
        },
        required: ['keyword'],
      },
      tags: ['memory', 'history', '聊天记录', '回忆', '之前'],
      keywords: ['之前', '历史', '聊过', '讨论过', '记得', '上次', '以前', '回忆'],
      async execute(args: Record<string, any>) {
        const { keyword, from_round, to_round } = args;

        // 获取当前轮次用于提示
        const currentRound = await memory.getCurrentRound(sessionId);

        if (keyword) {
          const result = await memory.traceByKeyword(sessionId, keyword);
          const msgs = result.messages.map(m => {
            const role = m.role === 'user' ? '用户' : '助手';
            const time = new Date(m.time).toLocaleString('zh-CN');
            return `[第${m.round}轮 ${time}] ${role}: ${m.content}`;
          }).join('\n');

          let output = `当前是第 ${currentRound} 轮对话。\n\n`;
          if (result.summary) {
            output += `📋 找到相关摘要（覆盖第${result.summary.fromRound}-${result.summary.toRound}轮）：\n${result.summary.summary}\n\n`;
          }
          output += msgs ? `💬 相关聊天记录：\n${msgs}` : '未找到包含该关键词的聊天记录。';
          return output;
        }

        if (from_round != null && to_round != null) {
          const messages = await memory.getMessagesByRound(sessionId, from_round, to_round);
          if (messages.length === 0) {
            return `第 ${from_round}-${to_round} 轮没有聊天记录。当前是第 ${currentRound} 轮。`;
          }
          const msgs = messages.map(m => {
            const role = m.role === 'user' ? '用户' : '助手';
            const time = new Date(m.time).toLocaleString('zh-CN');
            return `[第${m.round}轮 ${time}] ${role}: ${m.content}`;
          }).join('\n');
          return `第 ${from_round}-${to_round} 轮聊天记录（当前第 ${currentRound} 轮）：\n${msgs}`;
        }

        // 无参数 → 返回最近几轮
        const messages = await memory.getMessagesByRound(
          sessionId,
          Math.max(1, currentRound - 4),
          currentRound,
        );
        if (messages.length === 0) {
          return '暂无聊天记录。';
        }
        const msgs = messages.map(m => {
          const role = m.role === 'user' ? '用户' : '助手';
          return `[第${m.round}轮] ${role}: ${m.content}`;
        }).join('\n');
        return `最近的聊天记录（当前第 ${currentRound} 轮）：\n${msgs}`;
      },
    };
  }

  /**
   * 创建 user_profile 工具 — 让 AI 读写用户画像
   */
  private createUserProfileTool(userId: string): AgentTool {
    const profiles = this.userProfiles;

    return {
      name: 'user_profile',
      description: '读取或保存用户的个人偏好和信息。当用户告诉你他的名字、偏好、兴趣、习惯等个人信息时，用 set 操作保存。当需要了解用户偏好时，用 get 操作读取。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型: get（读取所有偏好）, set（保存偏好）, delete（删除偏好）',
            enum: ['get', 'set', 'delete'],
          },
          key: {
            type: 'string',
            description: '偏好名称，如: name, style, interests, timezone, language 等',
          },
          value: {
            type: 'string',
            description: '偏好值（仅 set 操作需要）',
          },
        },
        required: ['action'],
      },
      tags: ['profile', '偏好', '用户', '个性化', '记住'],
      keywords: ['我叫', '我的名字', '记住我', '我喜欢', '我偏好', '我习惯', '叫我', '我是'],
      async execute(args: Record<string, any>) {
        const { action, key, value } = args;

        switch (action) {
          case 'get': {
            const all = await profiles.getAll(userId);
            const entries = Object.entries(all);
            if (entries.length === 0) return '暂无保存的用户偏好。';
            return '用户偏好：\n' + entries.map(([k, v]) => `  ${k}: ${v}`).join('\n');
          }
          case 'set': {
            if (!key || !value) return '需要提供 key 和 value';
            await profiles.set(userId, key, value);
            return `已保存: ${key} = ${value}`;
          }
          case 'delete': {
            if (!key) return '需要提供 key';
            const deleted = await profiles.delete(userId, key);
            return deleted ? `已删除: ${key}` : `未找到偏好: ${key}`;
          }
          default:
            return '不支持的操作，请使用 get/set/delete';
        }
      },
    };
  }

  /**
   * 创建 schedule_followup 工具 — 让 AI 主动安排跟进
   *
   * 任务持久化到数据库，机器人重启后自动恢复。
   * 同一会话创建新提醒时，旧的 pending 提醒会被自动取消。
   */
  private createScheduleFollowUpTool(sessionId: string, context: ToolContext): AgentTool {
    const followUps = this.followUps;
    const platform = context.platform || '';
    const botId = context.botId || '';
    const senderId = context.senderId || '';
    const sceneId = context.sceneId || '';
    const sceneType = (context.message as any)?.$channel?.type || 'private';

    return {
      name: 'schedule_followup',
      description: '安排或取消定时跟进提醒。创建新提醒会自动取消之前的提醒。提醒持久保存，重启不丢失。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型: create（创建提醒，默认）或 cancel（取消当前会话所有提醒）',
            enum: ['create', 'cancel'],
          },
          delay_minutes: {
            type: 'number',
            description: '延迟时间，单位是分钟。注意：3 就是 3 分钟，不是 3 小时。举例: 3 = 3分钟后, 60 = 1小时后, 1440 = 1天后',
          },
          message: {
            type: 'string',
            description: '提醒消息内容',
          },
        },
        required: ['action'],
      },
      tags: ['reminder', '提醒', '跟进', '定时'],
      keywords: ['提醒', '提醒我', '过一会', '过一小时', '明天', '跟进', '别忘了', '记得提醒', '取消提醒'],
      async execute(args: Record<string, any>) {
        const { action = 'create', delay_minutes, message: msg } = args;

        if (action === 'cancel') {
          const count = await followUps.cancelBySession(sessionId);
          return count > 0
            ? `✅ 已取消 ${count} 个待执行的提醒`
            : '当前没有待执行的提醒';
        }

        // create
        if (!delay_minutes || delay_minutes <= 0) return '延迟时间必须大于 0 分钟';
        if (!msg) return '请提供提醒内容';

        return followUps.schedule({
          sessionId,
          platform,
          botId,
          senderId,
          sceneId,
          sceneType,
          message: msg,
          delayMinutes: delay_minutes,
        });
      },
    };
  }

  // ── 会话记忆（基于 ConversationMemory） ─────────────────────────────

  /**
   * 从 ConversationMemory 构建上下文
   */
  private async buildHistoryMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.memory.buildContext(sessionId);
  }

  /**
   * 流式聊天（带历史记忆） — 利用 chatStream 减少 TTFT
   *
   * 新增 onChunk 回调：每收到一个 token 立即通知调用方，
   * 支持适配器（Telegram/Discord/Kook）实时编辑消息。
   */
  private async streamChatWithHistory(
    content: string,
    systemPrompt: string,
    history: ChatMessage[],
    onChunk?: OnChunkCallback,
  ): Promise<string> {
    const model = this.provider.models[0];
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content },
    ];

    // 优先流式（对 Ollama 等本地模型有明显提速）
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
      // fallback 非流式
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
    // 1. 保存到 ConversationMemory（含异步摘要判断）
    await this.memory.saveRound(sessionId, userContent, assistantContent);

    // 2. 保存到 SessionManager（兼容旧逻辑）
    await this.sessions.addMessage(sessionId, { role: 'user', content: userContent });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: assistantContent });

    // 3. ContextManager 场景摘要（如有）
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }
  }

  private fallbackFormat(toolCalls: { tool: string; args: any; result: any }[]): string {
    if (toolCalls.length === 0) return '处理完成。';
    // 过滤掉 activate_skill 的结果（是 SKILL.md 指令，不应暴露给用户）
    const userFacing = toolCalls.filter(tc => tc.tool !== 'activate_skill');
    if (userFacing.length === 0) {
      // 只有 activate_skill 被调用但后续工具未执行 — 说明技能激活后流程中断
      return '技能已激活但未能完成后续操作，请重试或换一种方式描述你的需求。';
    }
    return userFacing.map(tc => {
      const s = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
      return `【${tc.tool}】\n${s}`;
    }).join('\n\n');
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────

  isReady(): boolean {
    return true; // provider is required in constructor
  }

  dispose(): void {
    this.memory.dispose();
    this.sessions.dispose();
    this.externalTools.clear();
    this.userProfiles.dispose();
    this.rateLimiter.dispose();
    this.followUps.dispose();
  }
}
