/**
 * ZhinAgent 运行时 host 契约 — 供 ideal 模块引用，避免依赖 zhin-agent 门面实现。
 */
import type { AIProvider, ContentPart, Usage, OutputElement, AgentSessionStore, ContextRepository, IMSessionStore, ImTranscriptStore, MemoryAgentSessionStore, MemoryIMSessionStore, RateLimiter, ModelRegistry } from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SubagentSystem } from '../subagent/index.js';
import type { UserProfileStore } from '../user-profile.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { HttpApprovalAdapter } from '../session/http-approval-adapter.js';
import type { ApprovalPort } from '../session/session-interaction-port.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { RegisteredAgentTool } from '../tool/contracts.js';
import type { DeferredTurnState } from '../turn/deferred-turn-state.js';
import type { SessionCompactInfo } from '../event/session-events.js';
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
  config: RequiredHostConfig;
  activeBinding: ResolvedAgentBinding | null;
  getTurnProvider(): AIProvider;
  skillRegistry: SkillRegistry | null;
  skillSystem: SkillSystem | null;
  orchestrator: AgentOrchestrator | null;
  agentCore: AgentCore | null;
  toolSystem: ToolSystem | null;
  contextSystem: ContextSystem | null;
  sessionSystem: SessionSystem | null;
  /** HTTP approval adapter — set when AgentSessionHostPort is wired (ADR 0041). */
  httpApprovalAdapter?: HttpApprovalAdapter;
  /** Optional host-level fallback, for transports without an interactive approval surface. */
  approvalPort?: ApprovalPort;
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
  imTranscriptStore: ImTranscriptStore;
  readonly externalTools: Map<string, RegisteredAgentTool>;
  readonly userProfiles: UserProfileStore;
  readonly rateLimiter: RateLimiter;
  subagentSystem: SubagentSystem | null;
  bootstrapContext: string;
  globalContext: string;
  getTurnActiveSkills(): string;
  getAlwaysSkillsBaseline(): string;
  initScheduleTurnContext(ctx: HostScheduleTurnContext): void;
  initInboundTurnContext(): void;
  appendActiveSkillsContext(fragment: string): void;
  skillsSummaryXML: string;
  modelRegistry: ModelRegistry | null;
  readonly phaseConfig: HostPhaseTraceConfig;
  readonly promptTraceConfig: HostPromptTraceConfig;
  readonly emitter: HostEventEmitter;
  /** deferred 工具族的跨 turn 状态（目录/快照/统计/自动续轮深度/结果回投器）。 */
  readonly deferred: DeferredTurnState;
  /** Per-turn instructions from defineDynamic resolvers (ADR 0039 P2). */
  turnDynamicInstructions?: string;
  readonly promptController: HostPromptController;
  getActiveTurnTracker(): HostTurnTracker | undefined;
  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
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
  emitSessionCompactEvent(sessionId: string, commMessage: Message, mode: 'text' | 'multimodal', info: SessionCompactInfo): void;
  buildDisciplinedPrompt(basePrompt: string): string;
}

export type { OnChunkCallback, OutputElement, Tool, Message, Plugin, ContentPart };
