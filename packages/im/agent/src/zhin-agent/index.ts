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

import type { Plugin } from '@zhin.js/core';
import { Logger } from '@zhin.js/logger';
import type { AIProvider, AgentTool, ContentPart, Usage } from '@zhin.js/ai';
import type { Tool, ToolContext } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import {
  createMemorySessionManager,
  resolveIMSessionIdFromToolContext,
  type SessionManager,
} from '@zhin.js/ai';
import type { ChatHistoryContext } from '@zhin.js/ai';
import {
  ConversationMemory,
  MemoryIMSessionStore,
  type IMSessionStore,
} from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import { type ZhinAgentTurnMetrics } from './turn-metrics.js';
import { TurnTracker } from './turn-tracker.js';
import { ZhinAgentEventEmitter } from './event-emitter.js';
import { type PhaseTraceConfig } from './phase-trace.js';

import type { ModelRegistry } from '@zhin.js/ai';
import { UserProfileStore } from '../user-profile.js';
import { RateLimiter } from '@zhin.js/ai';
import { SubagentManager, type SubagentResultSender } from '../subagent.js';
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
} from './config.js';
import { DeferredWorkerRunner } from '../deferred-worker-runner.js';
import { processTextTurn, processMultimodalTurn } from './turn-pipeline.js';
import { formatUserContentForSession } from './session-io.js';
import { asPrivate } from './zhin-agent-private.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { bindingToModelConfig } from '../routing/runtime-binding.js';
import { buildDisciplinedPrompt as assembleDisciplinedPrompt } from './prompt-assembly.js';
import {
  resolveAgentToolsForTurn as resolveToolsForTurn,
  runDeferredWorker as runDeferredWorkerTurn,
} from './tool-orchestration.js';

export type { ZhinAgentConfig, OnChunkCallback } from './config.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';
export { formatAiHandlerCompleteLog, formatZhinAgentTurnUsage } from './turn-metrics.js';
export * from './prompt-builder.js';
export * from './prompt-templates.js';
export * from './task-continuation.js';

const logger = new Logger(null, 'ZhinAgent');

// ============================================================================
// ZhinAgent
// ============================================================================

export class ZhinAgent {
  private provider: AIProvider;
  private providerResolver: ((alias: string) => AIProvider) | null = null;
  private activeBinding: ResolvedAgentBinding | null = null;
  private config: Required<ZhinAgentConfig>;
  private skillRegistry: SkillRegistry | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  private sessions: SessionManager;
  private chatHistory: ChatHistoryContext | null = null;
  private imSessionStore: IMSessionStore | MemoryIMSessionStore = new MemoryIMSessionStore();
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
  private memoryPersistenceReady: Promise<void>;
  private resolveMemoryPersistenceReady!: () => void;
  private memoryPersistenceDone = false;
  private get phaseConfig(): PhaseTraceConfig {
    return { phaseTraceEnabled: this.phaseTraceEnabled, onPhaseTrace: this.config.onPhaseTrace };
  }

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.phaseTraceEnabled = isPhaseTraceEnabled(this.config);
    this.memoryPersistenceReady = new Promise<void>((resolve) => {
      this.resolveMemoryPersistenceReady = resolve;
    });
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
    // 默认可用内存会话；DB 注入后由 bootstrap 覆盖 store，不阻塞单测与首条消息
    this.markMemoryPersistenceReady();
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

  setChatHistory(history: ChatHistoryContext): void {
    this.chatHistory = history;
  }

  setIMSessionStore(store: IMSessionStore): void {
    this.imSessionStore = store;
  }

  setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry;
    this.subagentManager?.setModelRegistry(registry);
  }

  setHostPlugin(plugin: Plugin): void {
    this.emitter.setHostPlugin(plugin);
  }

  setProviderResolver(resolver: (alias: string) => AIProvider): void {
    this.providerResolver = resolver;
  }

  /** 入站回合注入 ai.agents.<name> 绑定（zhin 或其它 route 摘要路径） */
  setActiveBinding(binding: ResolvedAgentBinding | null): void {
    this.activeBinding = binding;
    if (binding) {
      const patch = bindingToModelConfig(binding);
      this.config = {
        ...this.config,
        ...patch,
      };
    }
  }

  getActiveBinding(): ResolvedAgentBinding | null {
    return this.activeBinding;
  }

  getTurnProvider(): AIProvider {
    const alias = this.activeBinding?.providerAlias;
    if (alias && this.providerResolver) {
      try {
        return this.providerResolver(alias);
      } catch {
        return this.provider;
      }
    }
    return this.provider;
  }

  /** @deprecated 消息事实源已迁至 chat_messages，保留空实现以兼容旧 bootstrap */
  async upgradeMemoryToDatabase(_msgModel: unknown, _sumModel: unknown): Promise<void> {
    return;
  }

  /** 等待 DB store 注入（bootstrap 会 mark；已 mark 时立即返回） */
  async waitForMemoryPersistence(): Promise<void> {
    if (this.memoryPersistenceDone) return;
    const timeoutMs = process.env.NODE_ENV === 'test' ? 50 : 5_000;
    await Promise.race([
      this.memoryPersistenceReady,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!this.memoryPersistenceDone) {
            logger.warn(
              'waitForMemoryPersistence: timeout, proceeding with in-memory session/history',
            );
            this.markMemoryPersistenceReady();
          }
          resolve();
        }, timeoutMs);
      }),
    ]);
  }

  markMemoryPersistenceReady(): void {
    if (this.memoryPersistenceDone) return;
    this.memoryPersistenceDone = true;
    this.resolveMemoryPersistenceReady?.();
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
      eventEmitter: this.emitter,
      onEvent: (event) => {
        const sessionId = resolveIMSessionIdFromToolContext({
          platform: event.origin.platform,
          botId: event.origin.botId,
          scope: event.origin.sceneType === 'group' || event.origin.sceneType === 'channel'
            ? event.origin.sceneType
            : 'private',
          sceneId: event.origin.sceneId,
          senderId: event.origin.senderId,
        });
        const payload = this.emitter.createPayload(sessionId, {
          platform: event.origin.platform,
          botId: event.origin.botId,
          sceneId: event.origin.sceneId,
          senderId: event.origin.senderId,
          messageId: event.origin.messageId,
          scope: event.origin.sceneType === 'group' ? 'group' : 'private',
        }, 'text', {
          source: 'subagent',
          path: 'agent',
          taskId: event.taskId,
          label: event.label,
          content: event.task,
          status: event.status,
          error: event.error,
          reply: event.result,
          agentId: event.agent,
          hookContext: {
            subagentAgent: event.agent,
          },
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

  getEventEmitter(): ZhinAgentEventEmitter {
    return this.emitter;
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

  /** 旁听由 zhin `message.receive` 写入 chat_messages，此处保留空实现 */
  async appendPassiveGroupChatter(_context: ToolContext, _rawContent: string): Promise<void> {
    return;
  }

  /** 归档当前场景 active 会话（/new、ai.clear）；下次 @ 将创建新 session 纪元 */
  async archiveSessionForContext(context: ToolContext): Promise<boolean> {
    const sessionKey = resolveIMSessionIdFromToolContext({
      platform: context.platform,
      botId: context.botId,
      scope: context.scope,
      sceneId: context.sceneId,
      senderId: context.senderId,
    });
    return this.imSessionStore.archiveByKey(sessionKey);
  }

  async process(
    content: string,
    context: ToolContext,
    externalTools: Tool[] = [],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    return processTextTurn(asPrivate(this), content, context, externalTools, onChunk);
  }
  private resolveAgentToolsForTurn(
    allTools: AgentTool[],
    context: ToolContext,
  ): { tools: AgentTool[]; deferredStats?: string } {
    return resolveToolsForTurn(asPrivate(this), allTools, context);
  }

  private async runDeferredWorker(
    goal: string,
    toolQuery: string | undefined,
    context: ToolContext,
    allTools: AgentTool[],
  ): Promise<string> {
    return runDeferredWorkerTurn(asPrivate(this), goal, toolQuery, context, allTools);
  }

  private buildDisciplinedPrompt(basePrompt: string): string {
    return assembleDisciplinedPrompt(asPrivate(this), basePrompt);
  }

  async processMultimodal(
    parts: ContentPart[],
    context: ToolContext,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    return processMultimodalTurn(asPrivate(this), parts, context, onChunk);
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
