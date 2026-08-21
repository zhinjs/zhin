/**
 * ZhinAgent 运行时 host 契约 — 供 ideal 模块引用，避免依赖 zhin-agent 门面实现。
 * 成员按域拆为窄接口，ZhinAgentPrivate 组合之；消费方优先用窄接口形参。
 */
import type { AIProvider, Usage, OutputElement, AgentSessionStore, ContextRepository, IMSessionStore, MemoryAgentSessionStore, MemoryIMSessionStore, RateLimiter, ModelRegistry } from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { Tool, Message } from '../orchestrator/types.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { OrchestrationService } from '../orchestrator/orchestration-service.js';
import type { RemoteAgentRegistry } from '../orchestrator/remote-agent-registry.js';
import type { SubagentSystem } from '../subagent/index.js';
import type { UserProfileStore } from '../user-profile.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { ApprovalPort } from '../session/approval-port.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { RegisteredAgentTool } from '../tool/contracts.js';
import type { DeferredTurnState } from '../turn/deferred-turn-state.js';
import type { SessionCompactInfo } from '../event/session-events.js';
import type { PromptAssemblyRegistry } from '../prompt/prompt-assembly-registry.js';
import type {
  HostEventEmitter,
  HostPhaseTraceConfig,
  HostPromptController,
  HostPromptTraceConfig,
  HostTurnMetrics,
  HostTurnTracker,
  OnChunkCallback,
  RequiredHostConfig,
} from './host-types.js';

/** session 域：会话/上下文存储与会话事件。 */
export interface AgentSessionHost {
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
  sessionSystem: SessionSystem | null;
  waitForMemoryPersistence(): Promise<void>;
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
    info: SessionCompactInfo,
  ): void;
}

/** context 域：提示词与上下文装配。 */
export interface AgentContextHost {
  contextSystem: ContextSystem | null;
  bootstrapContext: string;
  globalContext: string;
  skillsSummaryXML: string;
  promptAssemblyRegistry: PromptAssemblyRegistry;
  getTurnActiveSkills(): string;
  getAlwaysSkillsBaseline(): string;
  appendActiveSkillsContext(fragment: string): void;
  buildDisciplinedPrompt(basePrompt: string): string;
}

/** turn 生命周期域：调度、指标、追踪与 turn ALS。 */
export interface AgentTurnLifecycleHost {
  readonly promptController: HostPromptController;
  readonly phaseConfig: HostPhaseTraceConfig;
  readonly promptTraceConfig: HostPromptTraceConfig;
  readonly rateLimiter: RateLimiter;
  initInboundTurnContext(): void;
  beginActiveTurn(): void;
  finalizeActiveTurn(
    partial: Omit<HostTurnMetrics, 'usage' | 'mainUsage' | 'subagentUsage'> & { usage: Usage },
  ): Promise<void>;
  getActiveTurnTracker(): HostTurnTracker | undefined;
  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
}

/** emitter 域：事件派发。 */
export interface AgentEmitterHost {
  readonly emitter: HostEventEmitter;
}

export interface ZhinAgentPrivate
  extends AgentSessionHost, AgentContextHost, AgentTurnLifecycleHost, AgentEmitterHost {
  config: RequiredHostConfig;
  activeBinding: ResolvedAgentBinding | null;
  getTurnProvider(): AIProvider;
  skillRegistry: SkillRegistry | null;
  skillSystem: SkillSystem | null;
  orchestrator: AgentOrchestrator | null;
  orchestrationService: OrchestrationService | null;
  remoteAgentRegistry: RemoteAgentRegistry | null;
  agentCore: AgentCore | null;
  toolSystem: ToolSystem | null;
  /** Optional host-level fallback, for transports without an interactive approval surface. */
  approvalPort?: ApprovalPort;
  readonly externalTools: Map<string, RegisteredAgentTool>;
  readonly userProfiles: UserProfileStore;
  subagentSystem: SubagentSystem | null;
  modelRegistry: ModelRegistry | null;
  /** deferred 工具族的跨 turn 状态（目录/快照/统计/自动续轮深度/结果回投器）。 */
  readonly deferred: DeferredTurnState;
}

export type { OnChunkCallback, OutputElement, Tool, Message, Plugin };
