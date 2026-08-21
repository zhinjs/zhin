/**
 * ZhinAgent — IM Agent 门面类（组合 ideal 模块；实现见 init/ + internal/）。
 */
import { randomUUID } from 'node:crypto';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { getLogger } from '@zhin.js/logger';
import {
  type AIProvider,
  type AgentTool,
  type AgentMessage,
  type MediaContentBlock,
  type Usage,
  type AgentEvent,
  type OutputElement,
  type ModelRegistry,
  type AgentSessionStore,
  type ContextRepository,
  type IMSessionStore,
  type MemoryAgentSessionStore,
  MemoryIMSessionStore,
  ConversationMemory,
  createMemoryContextRepository,
  RateLimiter,
} from '@zhin.js/ai';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { RegisteredAgentTool } from '../tool/contracts.js';
import type { ContextSystem } from '../context/context-system.js';
import { type MemorySystem, createMemorySystemForHost } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import { type ZhinAgentTurnMetrics } from '../turn/turn-metrics.js';
import { TurnTracker } from '../turn/turn-tracker.js';
import { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import { UserProfileStore } from '../user-profile.js';
import { SubagentSystem, type SubagentOrigin, type SubagentResultSender, type SubagentCompletePayload } from '../subagent/index.js';
import { buildParentContextSnapshot } from '../subagent-parent-context.js';
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  type ZhinAgentDependencies,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
  isPromptTraceEnabled,
  isPromptTraceVerbose,
} from '../config/index.js';
import { processTextTurn } from '../turn/turn-pipeline.js';
import { DeferredTurnState } from '../turn/deferred-turn-state.js';
import { resolveContextTailMessageLimit } from '../context/context-tail-limit.js';
import { archiveSessionByKey } from '../session/session-io.js';
import {
  recordPassiveGroupObservation as recordPassiveGroupObservationInternal,
  type PassiveGroupObservation,
} from '../session/passive-group-session.js';
import { asPrivate } from '../internal/as-private.js';
import { PromptController } from '../turn/prompt-controller.js';
import { getActiveTurnTracker } from '../internal/turn-context.js';
import { computeDeferredDelta } from '../turn/turn-deferred-delta.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { buildDisciplinedPrompt as assembleDisciplinedPrompt } from '../prompt/assembly.js';
import { PromptAssemblyRegistry } from '../prompt/prompt-assembly-registry.js';
import { createInboundTurnQueue, runWithInboundQueue } from '../turn/inbound-queue-runtime.js';
import type { ResolvedInboundQueueConfig } from '../turn/inbound-queue-config.js';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { continueAfterSubagent } from '../turn/auto-continue.js';
import { createSubagentSystem } from '../subagent/subagent-system-init.js';
import { processTextTurnStream } from '../turn/process-stream.js';
import { isCancelIntent } from '../turn/cancel-intent.js';
import { followUpMessage, runPromptTurn, steerMessage } from '../turn/prompt-api.js';
import {
  getAgentTurnConfiguration,
  runWithAgentTurnConfiguration,
  type AgentTurnConfiguration,
} from '../turn/agent-turn-context.js';
import {
  appendActiveSkills,
  getTurnActiveSkills,
  initInboundTurnContext as bridgeInitInboundTurnContext,
  runInTurnContext as bridgeRunInTurnContext,
  type TurnContextBridgeState,
  type TurnContextRunOptions,
} from '../turn/turn-context-bridge.js';
import { emitSessionCompactEvent, emitSessionNewEvent, type SessionCompactInfo } from '../event/session-events.js';
import { applyZhinAgentConfigure, wireZhinAgentLlmApiLayer } from '../init/configure-zhin-agent.js';
import { disposeZhinAgentResources } from '../init/dispose-zhin-agent.js';
import type { PhaseTraceConfig } from '../internal/phase-trace.js';
import type { ApprovalPort } from '../session/approval-port.js';
import type { TurnEvent } from '../event/turn-event.js';
import type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from '../config/agent-interfaces.js';
import {
  bindModuleProperties,
  clearZhinAgentRuntimeModules,
  createZhinAgentRuntimeModules,
  type ZhinAgentRuntimeModules,
} from './runtime-modules.js';
export type { ZhinAgentConfig, OnChunkCallback } from '../config/index.js';
export type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from '../config/agent-interfaces.js';
export type { ZhinAgentTurnMetrics, ZhinAgentTurnPath } from '../turn/turn-metrics.js';
export { PromptAccessDeniedError } from '../turn/prompt-access.js';
export type { AgentTurnConfiguration } from '../turn/agent-turn-context.js';
export { formatAiHandlerCompleteLog, formatAiHandlerTurnTable, formatZhinAgentTurnUsage } from '../turn/turn-metrics.js';
export * from '../prompt/prompt-builder.js';
export * from '../prompt/templates.js';
export * from '../turn/task-continuation.js';

const logger = getLogger('ZhinAgent');

export interface AgentTurnRequest {
  readonly content: string;
  readonly message: Message;
  readonly tools?: readonly Tool[];
  readonly onChunk?: OnChunkCallback;
  /** Cancels only this turn; the signal reaches queueing, model IO, and tools. */
  readonly signal?: AbortSignal;
  /** Enables IM activity feedback only for an actual inbound user message. */
  readonly activityFeedbackEligible?: boolean;
  /** Per-message routing state. Never call configure() for these values. */
  readonly configuration?: AgentTurnConfiguration;
  /** Structured turn telemetry for execution domains. */
  readonly onTurnEvent?: (event: TurnEvent) => void;
  /**
   * Snapshot generation for ToolRuntime (Plugin Runtime hosts).
   * Must match stamps applied by agentToolsFromCapabilities / stampToolGeneration.
   */
  readonly generation?: number;
}

export class ZhinAgent implements IAgentTurnProcessor, IAgentSessionManager, IAgentDiagnostics, IAgentConfigurator {
  private provider: AIProvider;
  providerResolver: ((alias: string) => AIProvider) | null = null;
  private configuredActiveBinding: ResolvedAgentBinding | null = null;
  config: Required<ZhinAgentConfig>;
  /** ideal 模块槽位；经 getter/setter 供 configure 与 asPrivate(host) 读写 */
  private readonly runtimeModules: ZhinAgentRuntimeModules;
  readonly imSessionStore: IMSessionStore | MemoryIMSessionStore = new MemoryIMSessionStore();
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
  memory: ConversationMemory;
  readonly externalTools: Map<string, RegisteredAgentTool> = new Map();
  userProfiles: UserProfileStore;
  rateLimiter: RateLimiter;
  subagentSystem: SubagentSystem | null = null;
  private configuredBootstrapContext: string = '';
  private configuredGlobalContext: string = '';
  alwaysSkillsBaseline: string = '';
  skillsSummaryXML: string = '';
  modelRegistry: ModelRegistry | null = null;
  readonly emitter = new ZhinAgentEventEmitter();
  readonly deferred = new DeferredTurnState();
  readonly promptController: PromptController;
  readonly promptAssemblyRegistry = new PromptAssemblyRegistry();
  /** 无交互审批面传输的 host 级回退。 */
  approvalPort?: ApprovalPort;
  /** Per-turn instructions from defineDynamic resolvers (ADR 0039 P2)。 */
  turnDynamicInstructions?: string;
  lastTurnMetrics: ZhinAgentTurnMetrics | null = null;
  private readonly inboundQueueConfig: ResolvedInboundQueueConfig;
  readonly inboundTurnQueue: InboundTurnQueue;
  readonly turnContextState: TurnContextBridgeState = {
    alwaysSkillsBaseline: '',
  };

  declare skillRegistry: SkillRegistry | null;
  declare skillSystem: SkillSystem | null;
  declare orchestrator: AgentOrchestrator | null;
  declare agentCore: AgentCore | null;
  declare toolSystem: ToolSystem | null;
  declare contextSystem: ContextSystem | null;
  declare memorySystem: MemorySystem | null;
  declare sessionSystem: SessionSystem | null;
  declare eventSystem: EventSystem | null;

  get activeBinding(): ResolvedAgentBinding | null {
    return getAgentTurnConfiguration()?.activeBinding ?? this.configuredActiveBinding;
  }

  set activeBinding(value: ResolvedAgentBinding | null) {
    this.configuredActiveBinding = value;
  }

  get bootstrapContext(): string {
    return getAgentTurnConfiguration()?.bootstrapContext ?? this.configuredBootstrapContext;
  }

  set bootstrapContext(value: string) {
    this.configuredBootstrapContext = value;
  }

  get globalContext(): string {
    return this.configuredGlobalContext;
  }

  set globalContext(value: string) {
    this.configuredGlobalContext = value;
  }

  get phaseConfig(): PhaseTraceConfig {
    return { phaseTraceEnabled: isPhaseTraceEnabled(this.config), onPhaseTrace: this.config.onPhaseTrace };
  }

  get promptTraceConfig() {
    return { promptTraceEnabled: isPromptTraceEnabled(this.config), promptTraceVerbose: isPromptTraceVerbose(this.config) };
  }

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    const merged = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
    this.config = merged;
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
    const inbound = createInboundTurnQueue(this.config, this.emitter);
    this.inboundQueueConfig = inbound.config;
    this.inboundTurnQueue = inbound.queue;
    const memoryStack = createMemoryContextRepository({
      tailMessageLimit: resolveContextTailMessageLimit(this.config),
    });
    this.agentSessionStore = memoryStack.sessionStore;
    this.contextRepository = memoryStack.repository;
    this.turnContextState.alwaysSkillsBaseline = this.alwaysSkillsBaseline;
    this.runtimeModules = createZhinAgentRuntimeModules(asPrivate(this));
    bindModuleProperties(this, this.runtimeModules);
    this.wireLlmApiLayer();
  }

  configure(deps: Partial<ZhinAgentDependencies>): void {
    applyZhinAgentConfigure(this, deps);
  }

  getTurnActiveSkills(): string {
    return getTurnActiveSkills(this.turnContextState);
  }

  getAlwaysSkillsBaseline(): string {
    return this.alwaysSkillsBaseline;
  }

  initInboundTurnContext(): void {
    bridgeInitInboundTurnContext(this.turnContextState);
  }

  appendActiveSkillsContext(fragment: string): void {
    appendActiveSkills(fragment);
  }

  buildDisciplinedPrompt(basePrompt: string): string {
    return assembleDisciplinedPrompt(asPrivate(this), basePrompt);
  }

  getPromptRegistry(): PromptAssemblyRegistry {
    return this.promptAssemblyRegistry;
  }

  wireLlmApiLayer(): void {
    wireZhinAgentLlmApiLayer(this.provider, this.providerResolver);
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

  async waitForMemoryPersistence(): Promise<void> {
    return this.requireSessionSystem().waitForPersistence();
  }

  markMemoryPersistenceReady(): void {
    this.requireSessionSystem().markPersistenceReady();
  }

  sharePersistenceWith(target: ZhinAgent): void {
    target.configure({
      imSessionStore: this.imSessionStore,
      agentSessionStore: this.agentSessionStore,
      contextRepository: this.contextRepository,
    });
    if (this.requireSessionSystem().isPersistenceReady()) {
      target.markMemoryPersistenceReady();
    }
  }

  upgradeProfilesToDatabase(model: Parameters<UserProfileStore['upgradeToDatabase']>[0]): void {
    this.userProfiles.upgradeToDatabase(model);
  }

  /**
   * 群/频道旁听：未触发 AI 的共享会话消息写入会话背景（Passive Group Context），
   * 供后续 @ 触发时带入上下文。仅群/频道场景调用（私聊/sandbox 由 Host 侧过滤）。
   */
  async recordPassiveGroupObservation(observation: PassiveGroupObservation): Promise<void> {
    await recordPassiveGroupObservationInternal(asPrivate(this), observation);
  }

  initSubagentSystem(createTools: () => AgentTool[]): void {
    this.subagentSystem = createSubagentSystem({
      provider: this.provider,
      config: this.config,
      modelRegistry: this.modelRegistry,
      emitter: this.emitter,
      createTools,
      onSubagentComplete: (payload) => this.continueAfterSubagent(payload),
    });
  }

  async continueAfterSubagent(payload: SubagentCompletePayload): Promise<void> {
    return continueAfterSubagent(asPrivate(this), payload);
  }

  getActiveTurnTracker(): TurnTracker | undefined {
    return getActiveTurnTracker();
  }

  runInTurnContext<T>(
    turnId: string,
    fn: () => Promise<T>,
    options?: TurnContextRunOptions,
  ): Promise<T> {
    return bridgeRunInTurnContext(this.turnContextState, this.config, turnId, fn, options);
  }

  getSubagentSystem(): SubagentSystem | null {
    return this.subagentSystem;
  }

  async buildParentContextSnapshotForSubagent(origin: SubagentOrigin): Promise<string | undefined> {
    const sessionKey = resolveIMSessionIdFromMessage(origin.message);
    return buildParentContextSnapshot(this.agentSessionStore, this.contextRepository, sessionKey);
  }

  getEventEmitter(): ZhinAgentEventEmitter {
    return this.emitter;
  }

  getUserProfiles(): UserProfileStore {
    return this.userProfiles;
  }

  registerTool(tool: RegisteredAgentTool): () => void {
    if (this.externalTools.has(tool.name)) {
      logger.warn(`registerTool: overwriting existing tool "${tool.name}" (source=${tool.source ?? '-'})`);
    }
    this.externalTools.set(tool.name, tool);
    return () => { this.externalTools.delete(tool.name); };
  }

  /** Tools registered via registerTool (e.g. Runtime plugin agent tools) — for introspection. */
  listRegisteredTools(): readonly RegisteredAgentTool[] {
    return [...this.externalTools.values()];
  }

  getLastTurnMetrics(): ZhinAgentTurnMetrics | null {
    return this.lastTurnMetrics;
  }

  getLastTurnToolSnapshot(): { tools: string[]; skills: string[] } {
    const priv = asPrivate(this);
    const snap = priv.deferred.lastSessionSnapshot ?? { loadedTools: {}, loadedSkills: [] };
    const deferredCfg = resolveDeferredToolsConfig(this.config);
    return computeDeferredDelta(snap, deferredCfg.alwaysLoadedTools, priv.deferred.lastSnapshotBefore);
  }

  beginActiveTurn(): void {
    getActiveTurnTracker()?.begin();
  }

  async finalizeActiveTurn(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void> {
    const tracker = getActiveTurnTracker();
    if (!tracker) return;
    await tracker.finalize(partial);
    this.lastTurnMetrics = tracker.lastMetrics;
  }

  emitSessionNewEvent(sessionId: string, commMessage: Message, mode: 'text' | 'multimodal', content: string, reply: string): void {
    emitSessionNewEvent(this.emitter, sessionId, commMessage, mode, content, reply);
  }

  emitSessionCompactEvent(sessionId: string, commMessage: Message, mode: 'text' | 'multimodal', info: SessionCompactInfo): void {
    emitSessionCompactEvent(this.emitter, sessionId, commMessage, mode, info);
  }

  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
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
    steerMessage(this.promptController, this.emitter, message, commMessage);
  }

  followUp(message: AgentMessage, commMessage: Message): void {
    followUpMessage(this.promptController, this.emitter, message, commMessage);
  }

  async prompt(
    input: string | AgentMessage | AgentMessage[],
    commMessage: Message,
    options?: { media?: MediaContentBlock[]; onChunk?: OnChunkCallback },
  ): Promise<OutputElement[]> {
    return runPromptTurn(asPrivate(this), input, commMessage, (id, fn) => this.runInTurnContext(id, fn), options);
  }

  async archiveSession(sessionKey: string): Promise<boolean> {
    return archiveSessionByKey(
      {
        agentSessionStore: this.agentSessionStore,
        contextRepository: this.contextRepository,
      },
      sessionKey,
    );
  }

  async compactSession(sessionKey: string): Promise<{ ok: boolean; message: string }> {
    const priv = asPrivate(this);
    const memorySystem = this.memorySystem ?? createMemorySystemForHost(priv);
    return memorySystem.compactSession(
      priv,
      sessionKey,
      this.requireSessionSystem().sessionDeps(priv),
    );
  }

  private requireSessionSystem(): SessionSystem {
    const system = this.sessionSystem;
    if (!system) {
      throw new Error('ZhinAgent.sessionSystem is required');
    }
    return system;
  }

  async process(content: string, commMessage: Message, externalTools: Tool[] = [], onChunk?: OnChunkCallback): Promise<OutputElement[]> {
    return this.processTurn({ content, message: commMessage, tools: externalTools, onChunk });
  }

  /**
   * Executes one immutable, generation-owned Agent turn. This prevents two
   * concurrent IM messages from overwriting activeBinding/bootstrapContext.
   */
  async processTurn(request: AgentTurnRequest): Promise<OutputElement[]> {
    if (isCancelIntent(request.content ?? '')) {
      const sessionKey = resolveIMSessionIdFromMessage(request.message);
      if (this.promptController.cancelSession(sessionKey)) {
        return [{ type: 'text', content: '已取消' }];
      }
      return [{ type: 'text', content: '当前没有正在执行的任务' }];
    }
    const executeTurn = (content: string) => processTextTurn(
      asPrivate(this),
      content,
      request.message,
      [...(request.tools ?? [])],
      request.onChunk,
      {
        signal: request.signal,
        onTurnEvent: request.onTurnEvent,
        generation: request.generation,
      },
    );
    return runWithAgentTurnConfiguration(request.configuration ?? {}, () =>
      this.runInTurnContext(randomUUID(), () =>
        runWithInboundQueue(request.message, this.inboundQueueConfig, this.inboundTurnQueue, {
          content: request.content,
          signal: request.signal,
          run: executeTurn,
        }),
        request.activityFeedbackEligible === undefined
          ? undefined
          : {
              activityFeedbackEligible: request.activityFeedbackEligible,
            },
      ),
    );
  }

  async *processStream(content: string, commMessage: Message, externalTools: Tool[] = []): AsyncGenerator<TurnEvent, void, undefined> {
    yield* processTextTurnStream(asPrivate(this), {
      content, commMessage, externalTools,
      inboundQueueConfig: this.inboundQueueConfig, inboundTurnQueue: this.inboundTurnQueue,
      runInTurnContext: (id, fn) => this.runInTurnContext(id, fn),
    });
  }


  isReady(): boolean {
    return true;
  }

  dispose(): void {
    disposeZhinAgentResources(this);
    this.subagentSystem = null;
    this.lastTurnMetrics = null;
     
    this.provider = null!;
    this.providerResolver = null;
    clearZhinAgentRuntimeModules(this.runtimeModules);
  }
}
