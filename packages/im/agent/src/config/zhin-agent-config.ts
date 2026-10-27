import type { ToolBudgetSettings } from '../core/turn-progress.js';
import type { InjectionGuardSettings } from '../security/provenance.js';
import type { UsageQuotaSettings } from '../security/usage-quota.js';
import type { ToolHardGateConfig } from '../security/tool-hard-gate.js';
/**
 * ZhinAgent 配置类型 SSOT — 供 host 契约与 zhin-agent 门面共用。
 */
import type { RateLimitConfig, QueueMode, ProviderResilienceConfig, ProviderTimers } from '@zhin.js/ai';
import type { DeferredToolsConfig } from '../tool-catalog/types.js';
import type { ModelHarnessConfig } from './model-harness.js';

export type OnChunkCallback = (chunk: string, full: string) => void;

export type ModelSizeHint = 'small' | 'medium' | 'large';
export type ExecApprovalMode = 'ask' | 'bypass' | 'auto';

export type InboundGroupQueueMode = 'supersede' | 'fifo';

export interface InboundQueueConfig {
  groupMode?: InboundGroupQueueMode;
  ttlMs?: number;
  coalesceWindowMs?: number;
  /**
   * Plugin-runtime IM ingress (#725): turns allowed to wait behind the running
   * turn of one session. Further messages get a short "busy" reply. Default 5.
   */
  maxQueuedTurns?: number;
}

/** ADR 0010 — session compaction config. */
export interface CompactionConfig {
  enabled?: boolean;
  auto?: boolean;
  keepRecentTokens?: number;
  minKeepCount?: number;
  /**
   * Share of the model context window (system prompt and tools included) at
   * which auto-compaction runs. Default 0.7 (#730).
   */
  thresholdRatio?: number;
}

export interface ScheduleBudgetConfig {
  maxTokens?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
}

export interface ScheduleDomainConfig {
  budget?: ScheduleBudgetConfig;
  security?: {
    execPreset?: 'readonly' | 'network';
    allowedDomains?: string[];
  };
}

export interface ZhinAgentConfig {
  persona?: string;
  maxIterations?: number;
  timeout?: number;
  preExecTimeout?: number;
  /** @deprecated No effect (#735); `zhin config check --fix` removes it. */
  maxSkills?: number;
  maxTools?: number;
  contextTailMessageLimit?: number;
  rateLimit?: RateLimitConfig;
  toneAwareness?: boolean;
  chatModel?: string;
  /**
   * @deprecated Programmatic-only leftover of the removed `ai.agent.visionModel`.
   * Still read as a fallback for image turns (after the bound model) and logs a
   * warning; removed in the next minor. Use `ai.agents.zhin.model` for the
   * conversation model and `ai.multimodal.perception` for images.
   */
  visionModel?: string;
  contextTokens?: number;
  maxHistoryShare?: number;
  compaction?: CompactionConfig;
  inboundQueue?: InboundQueueConfig;
  disabledTools?: string[];
  allowedTools?: string[];
  execSecurity?: 'deny' | 'allowlist' | 'full';
  execPreset?: 'readonly' | 'network' | 'development' | 'custom';
  /** IM 回合出网权限；未设置 `enabled` 时 `execPreset: network` 视为开启（兼容旧配置）。 */
  network?: { enabled?: boolean; allowedDomains?: string[] };
  execAllowlist?: string[];
  execApprovalMode?: ExecApprovalMode;
  subagentExecApprovalMode?: ExecApprovalMode;
  maxParallelSubagents?: number;
  toolExecution?: 'parallel' | 'sequential' | 'tiered';
  subagentAutoContinue?: boolean;
  subagentDirectImDelivery?: boolean;
  workerExecApprovalMode?: ExecApprovalMode;
  /** @deprecated No effect (#735); `zhin config check --fix` removes it. */
  taskExecApprovalMode?: ExecApprovalMode;
  maxSubagentIterations?: number;
  /** Plugin-runtime turns: `sync` offers spawn_task as an in-turn sub-agent; `off` (default) hides it. */
  subagentTurnMode?: 'off' | 'sync';
  /** Progress-aware tool budget (soft maxIterations + extensions, hard caps, auto-continuation). */
  toolBudget?: Partial<ToolBudgetSettings>;
  subagentTools?: string[];
  subagentTurnWaitMs?: number;
  modelSizeHint?: '' | 'small' | 'medium' | 'large';
  skillInstructionMaxChars?: number;
  modelHarness?: ModelHarnessConfig;
  /** Provider retry / backoff / timeout / fallback; unset keys use DEFAULT_PROVIDER_RESILIENCE. */
  providerResilience?: ProviderResilienceConfig;
  /** Provenance confirmation for high-risk actions and the outbound leak check (#727). */
  injectionGuard?: Partial<InjectionGuardSettings>;
  /** Dangerous-tool hard gate (ADR 0036): extra dangerous tools, funds switch, approval timeout. Always on. */
  toolHardGate?: ToolHardGateConfig;
  /** Per-user / per-group token quotas and group rate limit (#727); all limits off by default. */
  usageQuota?: Partial<UsageQuotaSettings>;
  /** Test seam: timers for the provider request timeout (evals inject a virtual clock). Not a YAML option. */
  providerTimers?: ProviderTimers;
  phaseTrace?: boolean;
  promptTrace?: boolean;
  promptTraceVerbose?: boolean;
  promptCache?: boolean;
  promptCacheRetention?: 'in_memory' | '24h';
  promptCacheKeyPrefix?: string;
  onPhaseTrace?: (event: {
    phase: string;
    sessionId: string;
    extra: Record<string, unknown>;
  }) => void;
  /** @deprecated No effect (#735); use `deferredTools.discoverTopK`. */
  deferredToolMaxResults?: number;
  deferredTools?: DeferredToolsConfig;
  workerBaseTools?: string[];
  /**
   * AI 结构化输出（AI SDK Output.object）：
   * - false：显式使用纯文本回复；
   * - 缺省 | true | 'segments'：IM 会话最终回复为 { segments: [...] }；隔离/非 IM 调用不应用此预设；
   * - 对象：自定义 JSON Schema 原样透传给模型。
   */
  outputSchema?: boolean | 'segments' | Record<string, unknown>;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  /** @deprecated No effect (#735); `zhin config check --fix` removes it. */
  policyDenialStopAfter?: number;
  deferredAutoContinue?: boolean;
  deferredAutoContinueMaxDepth?: number;
  /** §1 Runtime 注入单行 git 状态摘要（非 git 仓库自动跳过） */
  gitStatus?: boolean;
  /** 追加的上下文文件路径（支持 ~ 与相对路径；默认另加载 ~/.config/zhin/AGENTS.md 等全局路径） */
  contextPaths?: string[];
  /** 系统提示词总字符上限；按 retention/order 让出预算，required 内容放不下则失败。 */
  systemPromptMaxChars?: number;
  /** Activity feedback 展示 LLM 实际 thinking 内容（截断），而非静态 "思考中..."。 */
  thinkingPreview?: boolean;
  /** thinkingPreview 展示的最大字符数。 */
  thinkingPreviewMaxLength?: number;
  /** 无人值守 schedule execution domain。 */
  schedule?: ScheduleDomainConfig;
}
