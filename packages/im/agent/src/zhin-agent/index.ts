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
  type ContentPart,
  type ImageContent,
  type Usage,
  type AgentEvent,
  type OutputElement,
  type ModelRegistry,
  type AgentSessionStore,
  type ContextRepository,
  type IMSessionStore,
  type ImTranscriptStore,
  type MemoryAgentSessionStore,
  MemoryIMSessionStore,
  ConversationMemory,
  createMemoryContextRepository,
  MemoryImTranscriptStore,
  RateLimiter,
} from '@zhin.js/ai';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import { type MemorySystem, createMemorySystemForHost } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import { type ZhinAgentTurnMetrics } from '../turn/turn-metrics.js';
import { TurnTracker } from '../turn/turn-tracker.js';
import { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import { UserProfileStore } from '../user-profile.js';
import { SubagentSystem, type SubagentOrigin, type SubagentResultSender, type SubagentCompletePayload } from '../subagent/index.js';
import { buildParentContextPreamble } from '../subagent-parent-context.js';
import {
  type ZhinAgentConfig,
  type OnChunkCallback,
  type ZhinAgentDependencies,
  DEFAULT_CONFIG,
  isPhaseTraceEnabled,
  isPromptTraceEnabled,
  isPromptTraceVerbose,
} from '../config/index.js';
import { processTextTurn, processMultimodalTurn } from '../turn/turn-pipeline.js';
import { resolveContextTailMessageLimit } from '../context/context-tail-limit.js';
import { archiveSessionByKey } from '../session/session-io.js';
import { asPrivate } from '../internal/as-private.js';
import { PromptController } from '../turn/prompt-controller.js';
import { getActiveTurnTracker, type ScheduleTurnContext } from '../internal/turn-context.js';
import { computeDeferredDelta } from '../turn/turn-deferred-delta.js';
import { resolveDeferredToolsConfig } from '../tool-catalog/resolve-config.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { buildDisciplinedPrompt as assembleDisciplinedPrompt } from '../prompt/assembly.js';
import { createInboundTurnQueue, runWithInboundQueue } from '../turn/inbound-queue-runtime.js';
import type { ResolvedInboundQueueConfig } from '../turn/inbound-queue-config.js';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { continueAfterDeferredWorker, continueAfterSubagent } from '../turn/auto-continue.js';
import { createSubagentSystem } from '../subagent/subagent-system-init.js';
import { processTextTurnStream } from '../turn/process-stream.js';
import { followUpMessage, runPromptTurn, steerMessage } from '../turn/prompt-api.js';
import {
  appendActiveSkills,
  getTurnActiveSkills,
  initInboundTurnContext as bridgeInitInboundTurnContext,
  initScheduleTurnContext as bridgeInitScheduleTurnContext,
  runInTurnContext as bridgeRunInTurnContext,
  type TurnContextBridgeState,
} from '../turn/turn-context-bridge.js';
import { emitSessionCompactEvent, emitSessionNewEvent } from '../event/session-events.js';
import { applyZhinAgentConfigure, wireZhinAgentLlmApiLayer, type ConfigureZhinAgentTarget } from '../init/configure-zhin-agent.js';
import { disposeZhinAgentResources, type DisposeZhinAgentTarget } from '../init/dispose-zhin-agent.js';
import type { PhaseTraceConfig } from '../internal/phase-trace.js';
import type { TurnEvent } from '../event/turn-event.js';
import type {
  IAgentTurnProcessor,
  IAgentSessionManager,
  IAgentDiagnostics,
  IAgentConfigurator,
} from '../config/agent-interfaces.js';
import {
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
export { formatAiHandlerCompleteLog, formatAiHandlerTurnTable, formatZhinAgentTurnUsage } from '../turn/turn-metrics.js';
export * from '../prompt/prompt-builder.js';
export * from '../prompt/templates.js';
export * from '../turn/task-continuation.js';

const logger = getLogger('ZhinAgent');

export class ZhinAgent implements IAgentTurnProcessor, IAgentSessionManager, IAgentDiagnostics, IAgentConfigurator {
  private provider: AIProvider;
  private providerResolver: ((alias: string) => AIProvider) | null = null;
  private activeBinding: ResolvedAgentBinding | null = null;
  private config: Required<ZhinAgentConfig>;
  /** ideal 模块槽位；经 getter/setter 供 configure 与 asPrivate(host) 读写 */
  private readonly runtimeModules: ZhinAgentRuntimeModules;
  private imSessionStore: IMSessionStore | MemoryIMSessionStore = new MemoryIMSessionStore();
  private agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  private contextRepository: ContextRepository;
  private imTranscriptStore: ImTranscriptStore;
  private memory: ConversationMemory;
  private externalTools: Map<string, AgentTool> = new Map();
  private userProfiles: UserProfileStore;
  private rateLimiter: RateLimiter;
  private subagentSystem: SubagentSystem | null = null;
  private bootstrapContext: string = '';
  private alwaysSkillsBaseline: string = '';
  private skillsSummaryXML: string = '';
  private modelRegistry: ModelRegistry | null = null;
  private phaseTraceEnabled: boolean;
  private promptTraceEnabled: boolean;
  private promptTraceVerbose: boolean;
  private readonly emitter = new ZhinAgentEventEmitter();
  private deferredCatalog: AgentTool[] = [];
  lastToolSearchDeferredStats?: string;
  private readonly promptController: PromptController;
  private deferredResultSender: SubagentResultSender | null = null;
  private deferredAutoContinueDepthBySession = new Map<string, number>();
  private lastTurnMetrics: ZhinAgentTurnMetrics | null = null;
  private memoryPersistenceReady: Promise<void>;
  private resolveMemoryPersistenceReady!: () => void;
  private memoryPersistenceDone = false;
  private readonly inboundQueueConfig: ResolvedInboundQueueConfig;
  private readonly inboundTurnQueue: InboundTurnQueue;
  private readonly turnContextState: TurnContextBridgeState = {
    alwaysSkillsBaseline: '',
  };

  get skillRegistry(): SkillRegistry | null { return this.runtimeModules.skillRegistry; }
  set skillRegistry(value: SkillRegistry | null) { this.runtimeModules.skillRegistry = value; }

  get skillSystem(): SkillSystem | null { return this.runtimeModules.skillSystem; }
  set skillSystem(value: SkillSystem | null) { this.runtimeModules.skillSystem = value; }

  get orchestrator(): AgentOrchestrator | null { return this.runtimeModules.orchestrator; }
  set orchestrator(value: AgentOrchestrator | null) { this.runtimeModules.orchestrator = value; }

  get agentCore(): AgentCore | null { return this.runtimeModules.agentCore; }
  set agentCore(value: AgentCore | null) { this.runtimeModules.agentCore = value; }

  get toolSystem(): ToolSystem | null { return this.runtimeModules.toolSystem; }
  set toolSystem(value: ToolSystem | null) { this.runtimeModules.toolSystem = value; }

  get contextSystem(): ContextSystem | null { return this.runtimeModules.contextSystem; }
  set contextSystem(value: ContextSystem | null) { this.runtimeModules.contextSystem = value; }

  get memorySystem(): MemorySystem | null { return this.runtimeModules.memorySystem; }
  set memorySystem(value: MemorySystem | null) { this.runtimeModules.memorySystem = value; }

  get sessionSystem(): SessionSystem | null { return this.runtimeModules.sessionSystem; }
  set sessionSystem(value: SessionSystem | null) { this.runtimeModules.sessionSystem = value; }

  get eventSystem(): EventSystem | null { return this.runtimeModules.eventSystem; }
  set eventSystem(value: EventSystem | null) { this.runtimeModules.eventSystem = value; }

  private get phaseConfig(): PhaseTraceConfig {
    return { phaseTraceEnabled: this.phaseTraceEnabled, onPhaseTrace: this.config.onPhaseTrace };
  }

  private get promptTraceConfig() {
    return {
      promptTraceEnabled: this.promptTraceEnabled,
      promptTraceVerbose: this.promptTraceVerbose,
    };
  }

  private get autoContinueHost() {
    return {
      config: this.config,
      promptController: this.promptController,
      getDeferredAutoContinueDepth: (k: string) => this.getDeferredAutoContinueDepth(k),
      setDeferredAutoContinueDepth: (k: string, d: number) => this.deferredAutoContinueDepthBySession.set(k, d),
      resetDeferredAutoContinueDepth: (k: string) => this.resetDeferredAutoContinueDepth(k),
      getDeferredResultSender: () => this.getDeferredResultSender(),
      runInTurnContext: <T>(turnId: string, fn: () => Promise<T>) => this.runInTurnContext(turnId, fn),
    };
  }

  constructor(provider: AIProvider, config?: ZhinAgentConfig) {
    this.provider = provider;
    const merged = { ...DEFAULT_CONFIG, ...config } as Required<ZhinAgentConfig>;
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
    const inbound = createInboundTurnQueue(this.config, this.emitter);
    this.inboundQueueConfig = inbound.config;
    this.inboundTurnQueue = inbound.queue;
    const memoryStack = createMemoryContextRepository({
      tailMessageLimit: resolveContextTailMessageLimit(this.config),
    });
    this.agentSessionStore = memoryStack.sessionStore;
    this.contextRepository = memoryStack.repository;
    this.imTranscriptStore = new MemoryImTranscriptStore();
    this.turnContextState.alwaysSkillsBaseline = this.alwaysSkillsBaseline;
    this.runtimeModules = createZhinAgentRuntimeModules(asPrivate(this));
    this.wireLlmApiLayer();
  }

  configure(deps: Partial<ZhinAgentDependencies>): void {
    applyZhinAgentConfigure(this as unknown as ConfigureZhinAgentTarget, deps);
  }

  getTurnActiveSkills(): string {
    return getTurnActiveSkills(this.turnContextState);
  }

  /** @deprecated 使用 getTurnActiveSkills() */
  get activeSkillsContext(): string {
    return this.getTurnActiveSkills();
  }

  getAlwaysSkillsBaseline(): string {
    return this.alwaysSkillsBaseline;
  }

  initScheduleTurnContext(ctx: ScheduleTurnContext): void {
    bridgeInitScheduleTurnContext(this.turnContextState, ctx);
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

  private wireLlmApiLayer(): void {
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
    if (this.memoryPersistenceDone) return;
    const timeoutMs = process.env.NODE_ENV === 'test' ? 50 : 5_000;
    await Promise.race([
      this.memoryPersistenceReady,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!this.memoryPersistenceDone) {
            logger.warn('waitForMemoryPersistence: timeout, proceeding with in-memory session/history');
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

  upgradeProfilesToDatabase(model: Parameters<UserProfileStore['upgradeToDatabase']>[0]): void {
    this.userProfiles.upgradeToDatabase(model);
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
    return continueAfterDeferredWorker(
      this.autoContinueHost,
      asPrivate(this),
      commMessage,
      taskId,
      goal,
      result,
    );
  }

  async continueAfterSubagent(payload: SubagentCompletePayload): Promise<void> {
    return continueAfterSubagent(this.autoContinueHost, asPrivate(this), payload);
  }

  getActiveTurnTracker(): TurnTracker | undefined {
    return getActiveTurnTracker();
  }

  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T> {
    return bridgeRunInTurnContext(this.turnContextState, this.config, turnId, fn);
  }

  getSubagentSystem(): SubagentSystem | null {
    return this.subagentSystem;
  }

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

  getLastTurnToolSnapshot(): { tools: string[]; skills: string[] } {
    const priv = asPrivate(this);
    const snap = priv.lastDeferredSessionSnapshot ?? { loadedTools: {}, loadedSkills: [] };
    const deferredCfg = resolveDeferredToolsConfig(this.config);
    return computeDeferredDelta(snap, deferredCfg.alwaysLoadedTools, priv.lastDeferredSnapshotBefore);
  }

  private beginActiveTurn(): void {
    getActiveTurnTracker()?.begin();
  }

  private async finalizeActiveTurn(
    partial: Omit<ZhinAgentTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void> {
    const tracker = getActiveTurnTracker();
    if (!tracker) return;
    await tracker.finalize(partial);
    this.lastTurnMetrics = tracker.lastMetrics;
  }

  emitSessionNewEvent(
    sessionId: string,
    commMessage: Message,
    mode: 'text' | 'multimodal',
    content: string,
    reply: string,
  ): void {
    emitSessionNewEvent(this.emitter, sessionId, commMessage, mode, content, reply);
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
    options?: { images?: ImageContent[]; onChunk?: OnChunkCallback },
  ): Promise<OutputElement[]> {
    return runPromptTurn(asPrivate(this), input, commMessage, (id, fn) => this.runInTurnContext(id, fn), options);
  }

  async appendPassiveGroupChatter(_commMessage: Message, _rawContent: string): Promise<void> {
    return;
  }

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

  async compactSessionForCommMessage(commMessage: Message): Promise<{ ok: boolean; message: string }> {
    const priv = asPrivate(this);
    const memorySystem = this.memorySystem ?? createMemorySystemForHost(priv);
    return memorySystem.compactSessionForCommMessage(
      priv,
      commMessage,
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

  async process(
    content: string,
    commMessage: Message,
    externalTools: Tool[] = [],
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    return this.runInTurnContext(randomUUID(), () =>
      runWithInboundQueue(commMessage, this.inboundQueueConfig, this.inboundTurnQueue, {
        content,
        run: (mergedContent) =>
          processTextTurn(asPrivate(this), mergedContent, commMessage, externalTools, onChunk),
      }),
    );
  }

  async *processStream(
    content: string,
    commMessage: Message,
    externalTools: Tool[] = [],
  ): AsyncGenerator<TurnEvent, void, undefined> {
    yield* processTextTurnStream(asPrivate(this), {
      content,
      commMessage,
      externalTools,
      inboundQueueConfig: this.inboundQueueConfig,
      inboundTurnQueue: this.inboundTurnQueue,
      runInTurnContext: (id, fn) => this.runInTurnContext(id, fn),
    });
  }

  async processMultimodal(
    parts: ContentPart[],
    commMessage: Message,
    onChunk?: OnChunkCallback,
  ): Promise<OutputElement[]> {
    return this.runInTurnContext(randomUUID(), () =>
      runWithInboundQueue(commMessage, this.inboundQueueConfig, this.inboundTurnQueue, {
        coalesce: false,
        run: () => processMultimodalTurn(asPrivate(this), parts, commMessage, onChunk),
      }),
    );
  }

  isReady(): boolean {
    return true;
  }

  dispose(): void {
    disposeZhinAgentResources(this as unknown as DisposeZhinAgentTarget);
    this.subagentSystem = null;
    this.deferredAutoContinueDepthBySession.clear();
    this.deferredCatalog = [];
    this.lastTurnMetrics = null;
     
    this.provider = null!;
    this.providerResolver = null;
    clearZhinAgentRuntimeModules(this.runtimeModules);
  }
}
