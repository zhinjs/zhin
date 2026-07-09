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

import { randomUUID } from 'node:crypto';
import type { Plugin } from '@zhin.js/core';
import { getHostRootPlugin, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { formatCompact, Logger } from '@zhin.js/logger';
import type {
  AIProvider,
  AgentTool,
  AgentMessage,
  ContentPart,
  ImageContent,
  Usage,
  UserMessage,
} from '@zhin.js/ai';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import {
  ConversationMemory,
  createMemoryContextRepository,
  MemoryAgentSessionStore,
  MemoryIMSessionStore,
  MemoryImTranscriptStore,
  getLlmTransportModel,
  registerLlmApiFromProviders,
  sdkEntryFromProvider,
  type AgentSessionStore,
  type ContextRepository,
  type IMSessionStore,
  type ImTranscriptStore,
} from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import { type ZhinAgentTurnMetrics } from './turn-metrics.js';
import { TurnTracker } from './turn-tracker.js';
import { ZhinAgentEventEmitter } from './event-emitter.js';
import { type PhaseTraceConfig } from './phase-trace.js';
import type { TurnEvent } from './turn-event.js';

import type { ModelRegistry } from '@zhin.js/ai';
import { UserProfileStore } from '../user-profile.js';
import { RateLimiter } from '@zhin.js/ai';
import { SubagentManager, type SubagentOrigin, type SubagentResultSender } from '../subagent.js';
import type { SubagentCompletePayload } from '../subagent.js';
import { buildParentContextPreamble } from '../subagent-parent-context.js';
import { getAgentDispatcher } from '../orchestrator/agent-dispatcher.js';
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  type ZhinAgentDependencies,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
  isPromptTraceEnabled,
  isPromptTraceVerbose,
} from './config.js';
import { DeferredWorkerRunner } from '../deferred-worker-runner.js';
import { deliverDeferredAutoContinueReply } from './deferred-delivery.js';
import { processTextTurn, processMultimodalTurn } from './turn-pipeline.js';
import { resolveContextTailMessageLimit } from './context-tail-limit.js';
import {
  archiveSessionByKey,
  beginTurnSession,
  formatUserContentForSession,
} from './session-io.js';
import { manualCompactSession } from './compaction-runtime.js';
import { asPrivate } from './zhin-agent-private.js';
import { PromptController } from './prompt-controller.js';
import { getActiveTurnTracker, runInTurnContext as runInTurnContextAls, type ScheduleTurnContext, appendTurnActiveSkills, getTurnActiveSkillsFromContext } from './turn-context.js';
import { computeDeferredDelta } from './turn-deferred-delta.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import { normalizePromptMessages } from './prompt-input.js';
import { resolveToolRequesterRole } from '../security/owner-approve-always-store.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { bindingToModelConfig } from '../routing/runtime-binding.js';
import type { Disposable } from '../types/disposable.js';
import { buildDisciplinedPrompt as assembleDisciplinedPrompt } from './prompt-assembly.js';
import { buildDeferredAutoContinueUserMessage, shouldDeferredAutoContinue } from './deferred-auto-continue.js';
import { buildSubagentAutoContinueUserMessage } from './subagent-auto-continue.js';
import { persistSubagentResultToContext } from './persist-subagent-context.js';
import { persistDeferredWorkerResultToContext } from './persist-deferred-context.js';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import {
  normalizeInboundQueueConfig,
  shouldUseGroupFifoQueue,
  type ResolvedInboundQueueConfig,
} from './inbound-queue-config.js';
import { InboundTurnQueue } from './inbound-turn-queue.js';

export type { ZhinAgentConfig, OnChunkCallback } from './config.js';
export type { IAgentTurnProcessor, IAgentSessionManager, IAgentDiagnostics, IAgentConfigurator } from './interfaces.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from './turn-metrics.js';
export { PromptAccessDeniedError } from './prompt-access.js';
export { formatAiHandlerCompleteLog, formatZhinAgentTurnUsage } from './turn-metrics.js';
export * from './prompt-builder.js';
export * from './prompt-templates.js';
export * from './task-continuation.js';

const logger = new Logger(null, 'ZhinAgent');

// ============================================================================
// ZhinAgent
// ============================================================================

import { PromptAccessDeniedError } from './prompt-access.js';
import type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from './interfaces.js';

export class ZhinAgent implements IAgentTurnProcessor, IAgentSessionManager, IAgentDiagnostics, IAgentConfigurator {
  private provider: AIProvider;
  private providerResolver: ((alias: string) => AIProvider) | null = null;
  private activeBinding: ResolvedAgentBinding | null = null;
  private config: Required<ZhinAgentConfig>;
  private skillRegistry: SkillRegistry | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  private imSessionStore: IMSessionStore | MemoryIMSessionStore = new MemoryIMSessionStore();
  private agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  private contextRepository: ContextRepository;
  private imTranscriptStore: ImTranscriptStore;
  private memory: ConversationMemory;
  private externalTools: Map<string, AgentTool> = new Map();
  private userProfiles: UserProfileStore;
  private rateLimiter: RateLimiter;
  private subagentManager: SubagentManager | null = null;
  private bootstrapContext: string = '';
  private alwaysSkillsBaseline: string = '';
  private skillsSummaryXML: string = '';
  private pendingScheduleTurnContext?: ScheduleTurnContext;
  private pendingActivityFeedbackEligible?: boolean;
  private modelRegistry: ModelRegistry | null = null;
  private phaseTraceEnabled: boolean;
  private promptTraceEnabled: boolean;
  private promptTraceVerbose: boolean;
  private readonly emitter = new ZhinAgentEventEmitter();
  private deferredCatalog: AgentTool[] = [];
  private readonly deferredWorkerRunner = new DeferredWorkerRunner();
  private lastToolSearchDeferredStats?: string;
  private readonly promptController: PromptController;
  private deferredResultSender: SubagentResultSender | null = null;
  private deferredAutoContinueDepthBySession = new Map<string, number>();
  private lastTurnMetrics: ZhinAgentTurnMetrics | null = null;
  private memoryPersistenceReady: Promise<void>;
  private resolveMemoryPersistenceReady!: () => void;
  private memoryPersistenceDone = false;
  private readonly inboundQueueConfig: ResolvedInboundQueueConfig;
  private readonly inboundTurnQueue: InboundTurnQueue;
  private get phaseConfig(): PhaseTraceConfig {
    return { phaseTraceEnabled: this.phaseTraceEnabled, onPhaseTrace: this.config.onPhaseTrace };
  }

  private get promptTraceConfig() {
    return {
      promptTraceEnabled: this.promptTraceEnabled,
      promptTraceVerbose: this.promptTraceVerbose,
    };
  }

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    const merged = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.inboundQueueConfig = normalizeInboundQueueConfig(merged.inboundQueue);
    this.config = merged;
    this.phaseTraceEnabled = isPhaseTraceEnabled(this.config);
    this.promptTraceEnabled = isPromptTraceEnabled(this.config);
    this.promptTraceVerbose = isPromptTraceVerbose(this.config);
    this.memoryPersistenceReady = new Promise<void>((resolve) => {
      this.resolveMemoryPersistenceReady = resolve;
    });
    this.memory = new ConversationMemory({
      minTopicRounds: this.config.minTopicRounds,
      slidingWindowSize: this.config.slidingWindowSize,
      topicChangeThreshold: this.config.topicChangeThreshold,
      topicDetectModel: this.config.chatModel || undefined,
    });
    this.memory.setProvider(provider);
    this.userProfiles = new UserProfileStore();
    this.rateLimiter = new RateLimiter(this.config.rateLimit);
    this.promptController = new PromptController(
      this.config.steeringMode,
      this.config.followUpMode,
    );
    this.inboundTurnQueue = new InboundTurnQueue(this.inboundQueueConfig, {
      emitQueuedStart: (commMessage, sessionKey) => {
        this.emitter.emit(
          'ai.activity.queued.start',
          this.emitter.createPayload(sessionKey, commMessage, 'text'),
        );
      },
      emitQueuedClear: (commMessage, sessionKey) => {
        this.emitter.emit(
          'ai.activity.queued.clear',
          this.emitter.createPayload(sessionKey, commMessage, 'text'),
        );
      },
    });
    const memoryStack = createMemoryContextRepository({
      tailMessageLimit: resolveContextTailMessageLimit(this.config),
    });
    this.agentSessionStore = memoryStack.sessionStore;
    this.contextRepository = memoryStack.repository;
    this.imTranscriptStore = new MemoryImTranscriptStore();
    this.wireLlmApiLayer();
    // DB 注入完成前由 waitForMemoryPersistence 等待；useDatabase:false 时由 bootstrap 立即 mark
  }

  // ── DI setters ──────────────────────────────────────────────────────

  /**
   * 统一依赖注入入口。替代逐字段 setter。
   * 所有 setter 现委托到此方法；新代码优先使用 configure()。
   */
  configure(deps: Partial<ZhinAgentDependencies>): void {
    if (deps.skillRegistry !== undefined) {
      this.skillRegistry = deps.skillRegistry;
      logger.debug(`SkillRegistry connected (${deps.skillRegistry.size} skills)`);
    }
    if (deps.orchestrator !== undefined) {
      this.orchestrator = deps.orchestrator;
      logger.debug('AgentOrchestrator connected for MCP and resources');
    }
    if (deps.imSessionStore !== undefined) this.imSessionStore = deps.imSessionStore;
    if (deps.agentSessionStore !== undefined) this.agentSessionStore = deps.agentSessionStore;
    if (deps.contextRepository !== undefined) this.contextRepository = deps.contextRepository;
    if (deps.imTranscriptStore !== undefined) this.imTranscriptStore = deps.imTranscriptStore;
    if (deps.modelRegistry !== undefined) {
      this.modelRegistry = deps.modelRegistry;
      this.subagentManager?.setModelRegistry(deps.modelRegistry);
    }
    if (deps.hostPlugin !== undefined) this.emitter.setHostPlugin(deps.hostPlugin);
    if (deps.providerResolver !== undefined) {
      this.providerResolver = deps.providerResolver;
      this.wireLlmApiLayer();
    }
    if (deps.activeBinding !== undefined) {
      this.activeBinding = deps.activeBinding;
      if (deps.activeBinding) {
        const patch = bindingToModelConfig(deps.activeBinding);
        this.config = { ...this.config, ...patch };
      }
    }
    if (deps.subagentSender !== undefined) {
      this.subagentManager?.setSender(deps.subagentSender);
    }
    if (deps.deferredResultSender !== undefined) this.deferredResultSender = deps.deferredResultSender;
    if (deps.bootstrapContext !== undefined) {
      this.bootstrapContext = deps.bootstrapContext;
      logger.debug(`Bootstrap context set (${deps.bootstrapContext.length} chars)`);
    }
    if (deps.activeSkillsContext !== undefined) {
      this.alwaysSkillsBaseline = deps.activeSkillsContext || '';
    }
    if (deps.skillsSummaryXML !== undefined) this.skillsSummaryXML = deps.skillsSummaryXML || '';
  }

  /** turn 内 Active Skills（ALS）；无 turn 时回退 always baseline */
  getTurnActiveSkills(): string {
    const fromTurn = getTurnActiveSkillsFromContext();
    if (fromTurn) return fromTurn;
    return this.alwaysSkillsBaseline;
  }

  /** @deprecated 使用 getTurnActiveSkills() */
  get activeSkillsContext(): string {
    return this.getTurnActiveSkills();
  }

  getAlwaysSkillsBaseline(): string {
    return this.alwaysSkillsBaseline;
  }

  initScheduleTurnContext(ctx: ScheduleTurnContext): void {
    this.pendingScheduleTurnContext = ctx;
    this.pendingActivityFeedbackEligible = false;
  }

  initInboundTurnContext(): void {
    this.pendingActivityFeedbackEligible = true;
    this.pendingScheduleTurnContext = undefined;
  }

  appendActiveSkillsContext(fragment: string): void {
    appendTurnActiveSkills(fragment);
  }

  buildDisciplinedPrompt(basePrompt: string): string {
    return assembleDisciplinedPrompt(asPrivate(this), basePrompt);
  }

  private wireLlmApiLayer(): void {
    registerLlmApiFromProviders(
      [sdkEntryFromProvider(this.provider)],
      (alias) => {
        const p = alias === this.provider.name ? this.provider : this.providerResolver?.(alias);
        return p?.models ?? [];
      },
    );
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

  /** 多 Endpoint Runtime 共享主 Agent 的 DB session / transcript 存储 */
  sharePersistenceWith(target: ZhinAgent): void {
    target.configure({
      imSessionStore: this.imSessionStore,
      agentSessionStore: this.agentSessionStore,
      contextRepository: this.contextRepository,
      imTranscriptStore: this.imTranscriptStore,
    });
    if (this.memoryPersistenceDone) {
      target.markMemoryPersistenceReady();
    }
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
      maxParallelSubagents: this.config.maxParallelSubagents,
      execPolicyConfig: this.config,
      modelRegistry: this.modelRegistry,
      agentDispatcher: getAgentDispatcher(),
      onSubagentUsage: (usage) => getActiveTurnTracker()?.addSubagentUsage(usage),
      registerSubagentTask: (done) => getActiveTurnTracker()?.trackSubagent(done),
      eventEmitter: this.emitter,
      onEvent: (event) => {
        const sessionId = resolveIMSessionIdFromMessage(event.origin.message);
        const payload = this.emitter.createPayload(sessionId, event.origin.message, 'text', {
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
      onSubagentComplete: (payload) => this.continueAfterSubagent(payload),
    });
    logger.debug('SubagentManager initialized');
  }

  getDeferredResultSender(): SubagentResultSender | null {
    return this.deferredResultSender;
  }

  getDeferredAutoContinueDepth(sessionKey: string): number {
    return this.deferredAutoContinueDepthBySession.get(sessionKey) ?? 0;
  }

  resetDeferredAutoContinueDepth(sessionKey: string): void {
    this.deferredAutoContinueDepthBySession.delete(sessionKey);
  }

  async continueAfterDeferredWorker(
    commMessage: Message,
    taskId: string,
    goal: string,
    result: DeferredWorkerResult,
  ): Promise<void> {
    const sessionKey = resolveAgentTurnSessionKey(commMessage);
    const depth = this.getDeferredAutoContinueDepth(sessionKey);

    const persisted = await persistDeferredWorkerResultToContext(
      asPrivate(this),
      commMessage,
      taskId,
      goal,
      result,
    );
    if (!shouldDeferredAutoContinue(this.config, result, depth, persisted)) {
      logger.warn(formatCompact({
        deferred: 'auto_continue_skipped',
        task_id: taskId,
        depth,
        persisted,
        status: result.status,
      }));
      return;
    }

    await this.promptController.waitForIdle();
    this.deferredAutoContinueDepthBySession.set(sessionKey, depth + 1);

    logger.info(formatCompact({
      deferred: 'auto_continue',
      task_id: taskId,
      depth: depth + 1,
    }));

    const message = buildDeferredAutoContinueUserMessage(taskId, goal, result.status);
    const elements = await this.runInTurnContext(randomUUID(), () =>
      processTextTurn(asPrivate(this), '', commMessage, [], undefined, {
        prebuiltMessages: [message],
        deferredAutoContinue: true,
      }),
    );

    const sender = this.getDeferredResultSender();
    if (sender && elements.length > 0) {
      await deliverDeferredAutoContinueReply(sender, commMessage, elements);
    }

    logger.info(formatCompact({
      deferred: 'auto_continue_done',
      task_id: taskId,
      depth: depth + 1,
      outbound: elements.length,
    }));
  }

  async continueAfterSubagent(payload: SubagentCompletePayload): Promise<void> {
    if (this.config.subagentAutoContinue === false) return;

    const commMessage = payload.origin.message;
    const sessionKey = resolveAgentTurnSessionKey(commMessage);
    const depth = this.getDeferredAutoContinueDepth(sessionKey);
    if (depth >= this.config.deferredAutoContinueMaxDepth) {
      logger.warn(formatCompact({
        subagent: 'auto_continue_skipped',
        task_id: payload.taskId,
        reason: 'max_depth',
        depth,
      }));
      return;
    }

    const persisted = await persistSubagentResultToContext(asPrivate(this), commMessage, payload);
    if (!persisted) {
      logger.warn(formatCompact({
        subagent: 'auto_continue_skipped',
        task_id: payload.taskId,
        reason: 'persist_failed',
      }));
      return;
    }

    await this.promptController.waitForIdle();
    this.deferredAutoContinueDepthBySession.set(sessionKey, depth + 1);

    logger.info(formatCompact({
      subagent: 'auto_continue',
      task_id: payload.taskId,
      depth: depth + 1,
    }));

    const message = buildSubagentAutoContinueUserMessage(
      payload.taskId,
      payload.label,
      payload.status,
    );
    const elements = await this.runInTurnContext(randomUUID(), () =>
      processTextTurn(asPrivate(this), '', commMessage, [], undefined, {
        prebuiltMessages: [message],
        deferredAutoContinue: true,
      }),
    );

    const sender = this.getDeferredResultSender();
    if (sender && elements.length > 0) {
      await deliverDeferredAutoContinueReply(sender, commMessage, elements);
    }

    logger.info(formatCompact({
      subagent: 'auto_continue_done',
      task_id: payload.taskId,
      depth: depth + 1,
      outbound: elements.length,
    }));
  }

  getActiveTurnTracker(): TurnTracker | undefined {
    return getActiveTurnTracker();
  }

  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T> {
    const tracker = new TurnTracker(this.config.subagentTurnWaitMs);
    const scheduleContext = this.pendingScheduleTurnContext;
    const activityFeedbackEligible = this.pendingActivityFeedbackEligible;
    this.pendingScheduleTurnContext = undefined;
    this.pendingActivityFeedbackEligible = undefined;
    const init: Partial<Pick<import('./turn-context.js').TurnContextStore, 'scheduleContext' | 'activityFeedbackEligible'>> = {};
    if (scheduleContext) init.scheduleContext = scheduleContext;
    if (activityFeedbackEligible) init.activityFeedbackEligible = true;
    return runInTurnContextAls(turnId, tracker, fn, Object.keys(init).length ? init : undefined);
  }

  getSubagentManager(): SubagentManager | null {
    return this.subagentManager;
  }

  /** fork 模式：主会话 active_leaf 链快照（不含 spawn_task / tool_search 编排噪声） */
  async buildParentContextSnapshotForSubagent(origin: SubagentOrigin): Promise<string | undefined> {
    const sessionKey = resolveIMSessionIdFromMessage(origin.message);
    const active = await this.agentSessionStore.findActive(sessionKey);
    if (!active) return undefined;
    const ctx = await this.contextRepository.loadContext(active.session_id);
    const preamble = buildParentContextPreamble(ctx.messages);
    return preamble || undefined;
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

  getLastTurnMetrics(): ZhinAgentTurnMetrics | null {
    return this.lastTurnMetrics;
  }

  /** 本 turn deferred tools/skills delta（调度预演采集 execution plan 用） */
  getLastTurnToolSnapshot(): { tools: string[]; skills: string[] } {
    const priv = asPrivate(this);
    const snap = priv.lastDeferredSessionSnapshot ?? { loadedTools: {}, loadedSkills: [] };
    const deferredCfg = resolveDeferredToolsConfig(this.config);
    return computeDeferredDelta(snap, deferredCfg.alwaysLoadedTools, priv.lastDeferredSnapshotBefore);
  }

  private beginActiveTurn(): void {
    const tracker = getActiveTurnTracker();
    if (!tracker) return;
    tracker.begin();
  }

  private async finalizeActiveTurn(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void> {
    const tracker = getActiveTurnTracker();
    if (!tracker) return;
    await tracker.finalize(partial);
    this.lastTurnMetrics = tracker.lastMetrics;
  }

  private emitSessionNewEvent(
    sessionId: string,
    commMessage: Message,
    mode: 'text' | 'multimodal',
    content: string,
    reply: string,
  ): void {
    this.emitter.emit('ai.session.new', this.emitter.createPayload(sessionId, commMessage, mode, {
      reason: 'first_message',
      content,
      reply,
    }));
  }

  emitSessionCompactEvent(
    sessionId: string,
    commMessage: Message,
    mode: 'text' | 'multimodal',
    info: {
      microSavedTokens: number;
      autoSavedTokens: number;
      totalTokensBefore: number;
      totalTokensAfter: number;
    },
  ): void {
    this.emitter.emit('ai.session.compact', this.emitter.createPayload(sessionId, commMessage, mode, {
      path: 'agent',
      compactedCount: 1,
      savedTokens: info.microSavedTokens + info.autoSavedTokens,
      totalTokensBefore: info.totalTokensBefore,
      totalTokensAfter: info.totalTokensAfter,
      result: info,
    }));
  }

  // ── prompt() / steer / followUp (ADR 0009 D6) ─────────────────────

  private assertMasterForPromptControl(commMessage: Message): void {
    const plugin = this.emitter.getHostPlugin();
    if (!plugin) {
      throw new PromptAccessDeniedError('steer/followUp 需要有效的 master 上下文');
    }
    try {
      const role = resolveToolRequesterRole(plugin, commMessage);
      if (role !== 'master') {
        throw new PromptAccessDeniedError('steer/followUp 仅 master 可用');
      }
    } catch (error) {
      if (error instanceof PromptAccessDeniedError) throw error;
      throw new PromptAccessDeniedError('steer/followUp 需要有效的 master 上下文');
    }
  }

  subscribe(listener: (event: import('@zhin.js/ai').AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    return this.promptController.subscribe(listener);
  }

  abort(): void {
    this.promptController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.promptController.waitForIdle();
  }

  isPromptBusy(): boolean {
    return this.promptController.isBusy();
  }

  clearSteeringQueue(sessionKey?: string): void {
    this.promptController.clearSteeringQueue(sessionKey);
  }

  clearFollowUpQueue(sessionKey?: string): void {
    this.promptController.clearFollowUpQueue(sessionKey);
  }

  steer(message: AgentMessage, commMessage: Message): void {
    this.assertMasterForPromptControl(commMessage);
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    this.promptController.steer(sessionKey, message);
  }

  followUp(message: AgentMessage, commMessage: Message): void {
    this.assertMasterForPromptControl(commMessage);
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    this.promptController.followUp(sessionKey, message);
  }

  /**
   * 对齐 Agent.prompt：入队并执行 LLM turn（需 IM Message 通讯上下文）。
   * process() / processMultimodal() 在 agentLoop 路径下内部委托此方法。
   */
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    commMessage: Message,
    options?: { images?: ImageContent[]; onChunk?: OnChunkCallback },
  ): Promise<OutputElement[]> {
    const messages = normalizePromptMessages(input, options?.images);
    const text = messages
      .flatMap((message) => {
        if (message.role !== 'user') return [] as string[];
        const user = message as UserMessage;
        return user.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text);
      })
      .join('\n')
      .trim();
    return this.runInTurnContext(randomUUID(), () =>
      processTextTurn(asPrivate(this), text, commMessage, [], options?.onChunk, {
        prebuiltMessages: messages,
      }),
    );
  }

  // ── Core processing ─────────────────────────────────────────────────

  /** 旁听由 zhin `message.receive` 写入 im_transcripts，此处保留空实现 */
  async appendPassiveGroupChatter(_commMessage: Message, _rawContent: string): Promise<void> {
    return;
  }

  /** 归档当前场景 active 会话（/reset）；下次 @ 将创建新 session 纪元 */
  async archiveSessionForCommMessage(commMessage: Message): Promise<boolean> {
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    return archiveSessionByKey(
      {
        imSessionStore: this.imSessionStore,
        agentSessionStore: this.agentSessionStore,
        contextRepository: this.contextRepository,
      },
      sessionKey,
    );
  }

  /** 手动压缩当前 session epoch（/compact） */
  async compactSessionForCommMessage(commMessage: Message): Promise<{ ok: boolean; message: string }> {
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    const deps = {
      imSessionStore: this.imSessionStore,
      agentSessionStore: this.agentSessionStore,
      contextRepository: this.contextRepository,
    };
    const { sessionId } = await beginTurnSession(deps, sessionKey, commMessage);
    const provider = this.getTurnProvider();
    const modelId = this.config.chatModel || provider.models[0] || '';
    const llmModel = getLlmTransportModel(provider.name, modelId);
    const contextWindow = llmModel.contextWindow ?? this.config.contextTokens;
    return manualCompactSession(this.contextRepository, {
      host: asPrivate(this),
      sessionId,
      commMessage,
      model: llmModel,
      compactionConfig: this.config.compaction,
      contextWindow,
      mode: 'text',
    });
  }

  async process(
    content: string,
    commMessage: Message,
    externalTools: Tool[] = [],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const runTurn = (turnContent: string) =>
      this.runInTurnContext(randomUUID(), () =>
        processTextTurn(asPrivate(this), turnContent, commMessage, externalTools, onChunk),
      );

    if (shouldUseGroupFifoQueue(commMessage, this.inboundQueueConfig)) {
      const sessionKey = resolveIMSessionIdFromMessage(commMessage);
      return this.inboundTurnQueue.schedule({
        sessionKey,
        commMessage,
        content,
        run: runTurn,
      });
    }

    return runTurn(content);
  }

  async *processStream(
    content: string,
    commMessage: Message,
    externalTools: Tool[] = [],
  ): AsyncGenerator<TurnEvent, void, undefined> {
    const turnId = randomUUID();
    const sessionId = resolveIMSessionIdFromMessage(commMessage);

    yield { type: 'turn_start', sessionId, turnId };

    let accumulated = '';
    const onChunk: OnChunkCallback = (chunk, acc) => {
      accumulated = acc;
      eventQueue.push({ type: 'chunk', text: chunk, accumulated: acc });
      resolveWaiting?.();
    };

    const eventQueue: TurnEvent[] = [];
    let resolveWaiting: (() => void) | undefined;
    let done = false;
    let finalOutput: OutputElement[] = [];
    let finalError: Error | undefined;

    const runPromise = this.runInTurnContext(turnId, async () => {
      if (shouldUseGroupFifoQueue(commMessage, this.inboundQueueConfig)) {
        const sessionKey = resolveIMSessionIdFromMessage(commMessage);
        return this.inboundTurnQueue.schedule({
          sessionKey,
          commMessage,
          content,
          run: (mergedContent) =>
            processTextTurn(asPrivate(this), mergedContent, commMessage, externalTools, onChunk),
        });
      }
      return processTextTurn(asPrivate(this), content, commMessage, externalTools, onChunk);
    }).then((output) => {
      finalOutput = output;
      done = true;
      resolveWaiting?.();
    }).catch((err) => {
      finalError = err instanceof Error ? err : new Error(String(err));
      done = true;
      resolveWaiting?.();
    });

    while (!done) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
        continue;
      }
      await new Promise<void>(resolve => { resolveWaiting = resolve; });
      resolveWaiting = undefined;
    }

    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    if (finalError) {
      yield { type: 'error', error: finalError, recoverable: false };
    } else {
      yield {
        type: 'turn_end',
        output: finalOutput,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    await runPromise.catch(() => {});
  }

  async processMultimodal(
    parts: ContentPart[],
    commMessage: Message,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    const runTurn = () =>
      this.runInTurnContext(randomUUID(), () =>
        processMultimodalTurn(asPrivate(this), parts, commMessage, onChunk),
      );

    if (shouldUseGroupFifoQueue(commMessage, this.inboundQueueConfig)) {
      const sessionKey = resolveIMSessionIdFromMessage(commMessage);
      return this.inboundTurnQueue.schedule({
        sessionKey,
        commMessage,
        coalesce: false,
        run: () => runTurn(),
      });
    }

    return runTurn();
  }

  // ── Internal helpers ────────────────────────────────────────────────

  // ── Lifecycle ───────────────────────────────────────────────────────

  isReady(): boolean {
    return true;
  }

  dispose(): void {
    this.memory.dispose();
    this.externalTools.clear();
    this.userProfiles.dispose();
    this.rateLimiter.dispose();
    if (this.subagentManager) {
      this.subagentManager.dispose();
      this.subagentManager = null;
    }
    if (this.promptController) {
      this.promptController.abort();
    }
    this.inboundTurnQueue.dispose();
    // 使用 Disposable 接口统一清理资源（运行时 has-dispose 检查）
    const tryDispose = (obj: unknown) => {
      if (obj && typeof (obj as Disposable).dispose === 'function') {
        (obj as Disposable).dispose?.();
      }
    };
    tryDispose(this.imSessionStore);
    tryDispose(this.agentSessionStore);
    tryDispose(this.contextRepository);
    tryDispose(this.imTranscriptStore);
    this.deferredAutoContinueDepthBySession.clear();
    this.deferredCatalog = [];
    this.lastTurnMetrics = null;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- disposed, fields intentionally nulled
    this.provider = null!;
    this.providerResolver = null;
    this.skillRegistry = null;
    this.orchestrator = null;
  }
}
