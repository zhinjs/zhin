/**
 * ZhinAgent 配置类型 SSOT — 供 host 契约与 zhin-agent 门面共用。
 */
import type { RateLimitConfig, QueueMode } from '@zhin.js/ai';
import type { DeferredToolsConfig } from '../tool-catalog/types.js';
import type { ModelHarnessConfig } from './model-harness.js';

export type OnChunkCallback = (chunk: string, full: string) => void;

export type ModelSizeHint = 'small' | 'medium' | 'large';
export type ExecApprovalMode = 'ask' | 'allow' | 'deny';

export type InboundGroupQueueMode = 'supersede' | 'fifo';

export interface InboundQueueConfig {
  groupMode?: InboundGroupQueueMode;
  ttlMs?: number;
  coalesceWindowMs?: number;
}

/** ADR 0010 — session compaction config. */
export interface CompactionConfig {
  enabled?: boolean;
  auto?: boolean;
  keepRecentTokens?: number;
  minKeepCount?: number;
}

export interface ZhinAgentConfig {
  persona?: string;
  maxIterations?: number;
  timeout?: number;
  preExecTimeout?: number;
  maxSkills?: number;
  maxTools?: number;
  minTopicRounds?: number;
  slidingWindowSize?: number;
  contextTailMessageLimit?: number;
  topicChangeThreshold?: number;
  rateLimit?: RateLimitConfig;
  toneAwareness?: boolean;
  chatModel?: string;
  visionModel?: string;
  contextTokens?: number;
  maxHistoryShare?: number;
  compaction?: CompactionConfig;
  inboundQueue?: InboundQueueConfig;
  disabledTools?: string[];
  allowedTools?: string[];
  execSecurity?: 'deny' | 'allowlist' | 'full';
  execPreset?: 'readonly' | 'network' | 'development' | 'custom';
  execAllowlist?: string[];
  execApprovalMode?: ExecApprovalMode;
  subagentExecApprovalMode?: ExecApprovalMode;
  maxParallelSubagents?: number;
  toolExecution?: 'parallel' | 'sequential' | 'tiered';
  subagentAutoContinue?: boolean;
  subagentDirectImDelivery?: boolean;
  workerExecApprovalMode?: ExecApprovalMode;
  taskExecApprovalMode?: ExecApprovalMode;
  maxSubagentIterations?: number;
  subagentTools?: string[];
  subagentTurnWaitMs?: number;
  modelSizeHint?: '' | 'small' | 'medium' | 'large';
  skillInstructionMaxChars?: number;
  modelHarness?: ModelHarnessConfig;
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
  deferredToolMaxResults?: number;
  deferredTools?: DeferredToolsConfig;
  workerBaseTools?: string[];
  /**
   * AI 结构化输出（AI SDK Output.object）：
   * - false/缺省：纯文本回复（现状）；
   * - true | 'segments'：约束最终回复为 zhin AI 出站 JSON（text/mentions/segments 消息段数组）；
   * - 对象：自定义 JSON Schema 原样透传给模型。
   */
  outputSchema?: boolean | 'segments' | Record<string, unknown>;
  platformPromptSectionMaxChars?: number;
  platformPromptMaxChars?: number;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  policyDenialStopAfter?: number;
  deferredAutoContinue?: boolean;
  deferredAutoContinueMaxDepth?: number;
}
