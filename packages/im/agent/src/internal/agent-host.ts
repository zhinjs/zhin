import type { LocalImageAssetStore } from '../media/local-image-assets.js';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
/**
 * ZhinAgent 运行时 host 契约 — 供 ideal 模块引用，避免依赖 zhin-agent 门面实现。
 * 成员按域拆为窄接口，ZhinAgentPrivate 组合之；消费方优先用窄接口形参。
 */
import type { AIProvider, Usage, AgentSessionRepository, ContextRepository, RateLimiter, ModelRegistry, LlmApiRuntime } from '@zhin.js/ai';
import type { Tool, Message } from '../resource-hub/types.js';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentResourceHub } from '../resource-hub/index.js';
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
import type { AgentCompactionRuntime } from '../memory/compaction-runtime.js';
import type { SessionToldLedger } from '../memory/told-ledger.js';
import type { OwnerApprovalRuntime } from '../security/owner-approval-runtime.js';
import type { SessionCompactInfo } from '../event/session-events.js';
import type { AudioTranscriptionPort } from '../media/media-types.js';
import type { MediaPerceptionPort } from '../media/perception.js';
import type { ImageAssetPublisher } from '../media/image-assets.js';
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
  agentSessionStore: AgentSessionRepository;
  contextRepository: ContextRepository;
  sessionSystem: SessionSystem | null;
  readonly compactionRuntime: AgentCompactionRuntime;
  /** Conclusions and commitments already sent to the user, per session (#730). Optional for custom hosts. */
  readonly toldLedger?: SessionToldLedger;
  /** Active semantic memory for per-turn recall (#734). Optional for custom hosts. */
  semanticMemory?: SemanticMemoryRuntime | null;
  readonly ownerApprovals: OwnerApprovalRuntime;
  /** Dangerous-tool approval cards (ADR 0036 hard gate). Optional for custom hosts. */
  readonly toolApprovals?: import('../security/tool-approval-queue.js').ToolApprovalQueue;
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
  /** Per-user / per-group token quotas and group rate limit (#727). */
  readonly usageQuota: import('../security/usage-quota.js').UsageQuota;
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
  llmRuntime: LlmApiRuntime;
  audioTranscriber?: AudioTranscriptionPort;
  /** `ai.multimodal.perception` pre-pass; absent when not configured. */
  mediaPerception?: MediaPerceptionPort;
  imageAssets?: ImageAssetPublisher;
  localAssets?: LocalImageAssetStore;
  getTurnProvider(): AIProvider;
  skillRegistry: SkillRegistry | null;
  skillSystem: SkillSystem | null;
  resourceHub: AgentResourceHub | null;
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

export type { OnChunkCallback, AgentOutputElement, Tool, Message };
