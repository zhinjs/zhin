/**
 * ZhinAgent 运行时 host 契约 — 供 ideal 模块引用，避免依赖 zhin-agent 门面实现。
 */
import type { AIProvider, AgentTool, ContentPart, Usage, OutputElement, AgentSessionStore, ContextRepository, IMSessionStore, ImTranscriptStore, MemoryAgentSessionStore, MemoryIMSessionStore, ConversationMemory, RateLimiter, DeferredToolSessionSnapshot, ModelRegistry } from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SubagentSystem, SubagentResultSender } from '../subagent/index.js';
import type { UserProfileStore } from '../user-profile.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import type { DeferredWorkerResult, DeferredWorkerRunner } from '../deferred-worker-runner.js';
import type {
  HostEventEmitter,
  HostPhaseTraceConfig,
  HostPromptController,
  HostPromptTraceConfig,
  HostScheduleTurnContext,
  HostTurnMetrics,
  HostTurnTracker,
  OnChunkCallback,
  RequiredHostConfig,
} from './host-types.js';
export interface ZhinAgentPrivate {
  readonly config: RequiredHostConfig;
  readonly provider: AIProvider;
  readonly activeBinding: ResolvedAgentBinding | null;
  getTurnProvider(): AIProvider;
  readonly skillRegistry: SkillRegistry | null;
  readonly skillSystem: SkillSystem | null;
  readonly orchestrator: AgentOrchestrator | null;
  readonly agentCore: AgentCore | null;
  readonly toolSystem: ToolSystem | null;
  readonly contextSystem: ContextSystem | null;
  readonly memorySystem: MemorySystem | null;
  readonly sessionSystem: SessionSystem | null;
  readonly eventSystem: EventSystem | null;
  readonly imSessionStore: IMSessionStore | MemoryIMSessionStore;
  readonly agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  readonly contextRepository: ContextRepository;
  readonly imTranscriptStore: ImTranscriptStore;
  readonly memory: ConversationMemory;
  readonly externalTools: Map<string, AgentTool>;
  readonly userProfiles: UserProfileStore;
  readonly rateLimiter: RateLimiter;
  readonly subagentSystem: SubagentSystem | null;
  readonly bootstrapContext: string;
  getTurnActiveSkills(): string;
  getAlwaysSkillsBaseline(): string;
  initScheduleTurnContext(ctx: HostScheduleTurnContext): void;
  initInboundTurnContext(): void;
  appendActiveSkillsContext(fragment: string): void;
  readonly skillsSummaryXML: string;
  readonly modelRegistry: ModelRegistry | null;
  readonly phaseConfig: HostPhaseTraceConfig;
  readonly promptTraceConfig: HostPromptTraceConfig;
  readonly emitter: HostEventEmitter;
  deferredCatalog: AgentTool[];
  lastDeferredCatalog?: ToolCatalogItem[];
  lastDeferredSessionSnapshot?: DeferredToolSessionSnapshot;
  lastDeferredSnapshotBefore?: DeferredToolSessionSnapshot;
  readonly deferredWorkerRunner: DeferredWorkerRunner;
  lastToolSearchDeferredStats?: string;
  readonly promptController: HostPromptController;
  getActiveTurnTracker(): HostTurnTracker | undefined;
  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
  setDeferredResultSender(sender: SubagentResultSender): void;
  getDeferredResultSender(): SubagentResultSender | null;
  waitForMemoryPersistence(): Promise<void>;
  beginActiveTurn(): void;
  finalizeActiveTurn(
    partial: Omit<HostTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void>;
  emitSessionNewEvent(
    sessionId: string,
    commMessage: Message,
    mode: 'text' | 'multimodal',
    content: string,
    reply: string,
  ): void;
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
  ): void;
  buildDisciplinedPrompt(basePrompt: string): string;
  runDeferredWorker(
    goal: string,
    toolQuery: string | undefined,
    commMessage: Message,
    allTools: AgentTool[],
  ): Promise<string>;
  getDeferredAutoContinueDepth(sessionKey: string): number;
  resetDeferredAutoContinueDepth(sessionKey: string): void;
  continueAfterDeferredWorker(
    commMessage: Message,
    taskId: string,
    goal: string,
    result: DeferredWorkerResult,
  ): Promise<void>;
}

export type { OnChunkCallback, OutputElement, Tool, Message, Plugin, ContentPart };
