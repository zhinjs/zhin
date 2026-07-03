/**
 * ZhinAgent 配置、常量、类型定义
 */

import type { RateLimitConfig } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_FOLLOW_UP_MODE, DEFAULT_STEERING_MODE, buildPromptCacheKey, type QueueMode } from '@zhin.js/ai';
import type {
  AIProvider,
  AgentSessionStore,
  ContextRepository,
  IMSessionStore,
  ImTranscriptStore,
  MemoryAgentSessionStore,
  MemoryIMSessionStore,
  ModelRegistry,
  SessionManager,
} from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { ModelHarnessConfig } from './model-harness.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SubagentResultSender } from '../subagent.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from './context-tail-limit.js';
import {
  DEFAULT_ALWAYS_LOADED_TOOLS,
  DEFAULT_DEFERRED_TOOLS_CONFIG,
} from '../tool-catalog/types.js';

export {
  DEFAULT_ALWAYS_LOADED_TOOLS,
  DEFAULT_DEFERRED_TOOLS_CONFIG,
} from '../tool-catalog/types.js';

export type ModelSizeHint = 'small' | 'medium' | 'large';
export type ExecApprovalMode = 'ask' | 'allow' | 'deny';

const SMALL_MODEL_RE = /[:\-_](0\.5|1\.?[58]?|[3-8])b\b/i;
const MEDIUM_MODEL_RE = /[:\-_](14|[12][0-9]|32)b\b/i;

/**
 * Infer model size from model name string.
 * Pattern: `:8b` → small, `:14b` → medium, else large.
 */
export function inferModelSize(modelName: string): ModelSizeHint {
  if (SMALL_MODEL_RE.test(modelName)) return 'small';
  if (MEDIUM_MODEL_RE.test(modelName)) return 'medium';
  return 'large';
}

/**
 * Resolve the effective model size hint.
 * Priority: explicit config > model name inference.
 */
export function resolveModelSize(config: Required<ZhinAgentConfig>, modelName: string): ModelSizeHint {
  if (config.modelSizeHint && (config.modelSizeHint as string) !== '') return config.modelSizeHint as ModelSizeHint;
  return inferModelSize(modelName);
}

/**
 * Resolve the effective skill instruction max chars based on model size.
 */
export function resolveSkillInstructionMaxChars(config: Required<ZhinAgentConfig>, modelName: string): number {
  if (config.skillInstructionMaxChars && config.skillInstructionMaxChars > 0) return config.skillInstructionMaxChars;
  const size = resolveModelSize(config, modelName);
  switch (size) {
    case 'small': return 1500;
    case 'medium': return 4000;
    case 'large': return 8000;
  }
}

export const SECTION_SEP = '\n\n---\n\n';
export const HISTORY_CONTEXT_MARKER = '[Chat messages since your last reply - for context]';
/** 与 @zhin.js/core `CURRENT_USER_MESSAGE_MARKER` 保持一致 */
export const CURRENT_MESSAGE_MARKER = '[Current message - respond to this]';

export type OnChunkCallback = (chunk: string, full: string) => void;

/** ADR 0010 — session compaction config. */
export interface CompactionConfig {
  enabled?: boolean;
  auto?: boolean;
  keepRecentTokens?: number;
  minKeepCount?: number;
}
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 上下文感知内置工具的关键词触发正则 */
export const KEYWORD_TRIGGERS = {
  chatHistory: /之前|上次|历史|回忆|聊过|记录|还记得|曾经/i,
  userProfile: /偏好|设置|配置|档案|资料|时区|timezone|profile|喜好|我叫|叫我|记住我/i,
} as const;

export interface ZhinAgentConfig {
  persona?: string;
  maxIterations?: number;
  timeout?: number;
  preExecTimeout?: number;
  maxSkills?: number;
  maxTools?: number;
  minTopicRounds?: number;
  slidingWindowSize?: number;
  /** agent_messages 上下文 tail 条数（默认 80；勿与 slidingWindowSize 混用） */
  contextTailMessageLimit?: number;
  topicChangeThreshold?: number;
  rateLimit?: RateLimitConfig;
  toneAwareness?: boolean;
  /** 聊天任务使用的模型（覆盖自动选择） */
  chatModel?: string;
  visionModel?: string;
  contextTokens?: number;
  maxHistoryShare?: number;
  compaction?: CompactionConfig;
  disabledTools?: string[];
  allowedTools?: string[];
  execSecurity?: 'deny' | 'allowlist' | 'full';
  execPreset?: 'readonly' | 'network' | 'development' | 'custom';
  execAllowlist?: string[];
  /** 主 Agent：白名单外命令处理模式（ask=请求确认，allow=自动放行，deny=直接拒绝） */
  execApprovalMode?: ExecApprovalMode;
  /** 子 Agent（spawn_task）执行模式 */
  subagentExecApprovalMode?: ExecApprovalMode;
  /** Worker 执行模式（deferred worker 默认） */
  workerExecApprovalMode?: ExecApprovalMode;
  /** Task 执行模式（run_deferred_task 入口） */
  taskExecApprovalMode?: ExecApprovalMode;
  maxSubagentIterations?: number;
  subagentTools?: string[];
  /**
   * 主会话 turn 结束前，等待本轮 spawn 的子 agent 完成以便合并 token（毫秒）。
   * 0 表示不等待（仅统计在 wait 窗口内已完成的子 agent）。
   */
  subagentTurnWaitMs?: number;
  /** 模型大小提示，影响技能指令截断长度。留空则根据模型名自动推断 */
  modelSizeHint?: '' | 'small' | 'medium' | 'large';
  /** 技能指令最大字符数（覆盖 modelSizeHint 推断值） */
  skillInstructionMaxChars?: number;
  /** 模型级 harness 覆盖配置（按 model id / provider 模式） */
  modelHarness?: ModelHarnessConfig;
  /** 输出回合 phase 观测日志（或通过 ZHIN_AGENT_PHASE_TRACE 环境变量开启） */
  phaseTrace?: boolean;
  /** 记录发往 LLM 的提示词规模分段（或通过 ZHIN_AGENT_PROMPT_TRACE；默认随 phaseTrace 开启） */
  promptTrace?: boolean;
  /** promptTrace 时输出 system 首尾预览（或 ZHIN_AGENT_PROMPT_TRACE_VERBOSE） */
  promptTraceVerbose?: boolean;
  /** Provider prompt cache（anthropic / openai / openai-compatible）；默认启用，仅显式 false 禁用 */
  promptCache?: boolean;
  /** OpenAI `prompt_cache_retention`（默认 in_memory；部分模型支持 24h） */
  promptCacheRetention?: 'in_memory' | '24h';
  /** OpenAI `prompt_cache_key` 前缀（默认 zhin） */
  promptCacheKeyPrefix?: string;
  /** phase 观测回调（测试或自定义遥测；与 phaseTrace 同时生效） */
  onPhaseTrace?: (event: {
    phase: string;
    sessionId: string;
    extra: Record<string, unknown>;
  }) => void;
  /** Worker 侧 TF-IDF 载入 deferred 工具数量上限 */
  deferredToolMaxResults?: number;
  /** @deprecated 使用 deferredTools.alwaysLoadedTools */
  orchestratorTools?: string[];
  /** Deferred tool schema 按需加载 */
  deferredTools?: import('../tool-catalog/types.js').DeferredToolsConfig;
  /** Deferred Worker 基础工具（另加 TF-IDF 载入的 deferred） */
  workerBaseTools?: string[];
  /** 单轮平台 prompt 段 body 上限（字符） */
  platformPromptSectionMaxChars?: number;
  /** 单 slot 平台 prompt 合计上限（字符） */
  platformPromptMaxChars?: number;
  /** steer 队列 drain 模式（ADR 0009 Grill #13） */
  steeringMode?: QueueMode;
  /** followUp 队列 drain 模式（ADR 0009 Grill #13） */
  followUpMode?: QueueMode;
  /**
   * 同一轮对话内累计多少次策略/安全拒绝后强制结束工具循环（默认 2，传给 Agent）。
   * 设为 0 禁用熔断。
   */
  policyDenialStopAfter?: number;
  /**
   * @deprecated Worker 结果经 run_deferred_task 同步回传主 Agent，不再使用独立 auto_continue 回合。
   */
  deferredAutoContinue?: boolean;
  /** @deprecated 见 deferredAutoContinue */
  deferredAutoContinueMaxDepth?: number;
}

/** @deprecated 使用 DEFAULT_ALWAYS_LOADED_TOOLS */
export const DEFAULT_ORCHESTRATOR_TOOLS = DEFAULT_ALWAYS_LOADED_TOOLS;

/** 硬编排 v1 追加的总监工具 */
export const HARD_ORCHESTRATION_TOOLS = [
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
] as const;

export const DEFAULT_HARD_ORCHESTRATOR_TOOLS = [
  ...DEFAULT_ORCHESTRATOR_TOOLS,
  ...HARD_ORCHESTRATION_TOOLS,
] as const;

/** Deferred Worker 默认基础工具 */
export const DEFAULT_WORKER_BASE_TOOLS = [
  'bash',
  'read_file',
  'web_search',
] as const;

/** ZhinAgent 运行依赖（通过 setter 或 configure() 注入） */
export interface ZhinAgentDependencies {
  skillRegistry: SkillRegistry;
  orchestrator: AgentOrchestrator;
  sessionManager: SessionManager;
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
  imTranscriptStore: ImTranscriptStore;
  modelRegistry: ModelRegistry;
  hostPlugin: Plugin;
  providerResolver: (alias: string) => AIProvider;
  activeBinding: ResolvedAgentBinding;
  subagentSender: SubagentResultSender;
  deferredResultSender: SubagentResultSender;
  bootstrapContext: string;
  activeSkillsContext: string;
  skillsSummaryXML: string;
}

export const DEFAULT_CONFIG = {
  persona: 'You are Zhin, an intelligent IM assistant running in Zhin.js. Answer clearly, act through available tools when needed, and never claim actions or results unless confirmed by tool output.',
  maxIterations: 15,  // 增加到15次，支持复杂任务
  timeout: 120_000,   // 增加到2分钟
  preExecTimeout: 15_000,
  maxSkills: 5,       // 增加技能数量
  maxTools: 12,       // 增加工具数量
  minTopicRounds: 5,
  slidingWindowSize: 5,
  contextTailMessageLimit: DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT,
  topicChangeThreshold: 0.15,
  rateLimit: {},
  toneAwareness: true,
  chatModel: '',
  visionModel: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  maxHistoryShare: 0.5,
  compaction: {
    enabled: true,
    auto: true,
    keepRecentTokens: 20_000,
    minKeepCount: 2,
  },
  disabledTools: [],
  allowedTools: [],
  execSecurity: 'deny',
  execPreset: 'custom',
  execAllowlist: [],
  execApprovalMode: 'deny',
  subagentExecApprovalMode: 'deny',
  workerExecApprovalMode: 'deny',
  taskExecApprovalMode: 'deny',
  maxSubagentIterations: 25,  // 增加子任务迭代次数
  subagentTools: [],
  subagentTurnWaitMs: 300_000,  // 增加等待时间到5分钟
  modelSizeHint: '',
  skillInstructionMaxChars: 0,
  modelHarness: {},
  phaseTrace: false,
  onPhaseTrace: () => {},
  promptTraceVerbose: false,
  promptCacheRetention: 'in_memory',
  promptCacheKeyPrefix: 'zhin',
  deferredToolMaxResults: 8,
  deferredTools: { ...DEFAULT_DEFERRED_TOOLS_CONFIG },
  orchestratorTools: [...DEFAULT_ALWAYS_LOADED_TOOLS],
  workerBaseTools: [...DEFAULT_WORKER_BASE_TOOLS],
  platformPromptSectionMaxChars: 2048,
  platformPromptMaxChars: 4096,
  steeringMode: DEFAULT_STEERING_MODE,
  followUpMode: DEFAULT_FOLLOW_UP_MODE,
  policyDenialStopAfter: 2,
  deferredAutoContinue: false,
  deferredAutoContinueMaxDepth: 8,
} as unknown as Required<ZhinAgentConfig>;

/** `env` 参数主要用于测试注入，运行时默认读取 `process.env`。 */
export function isPhaseTraceEnabled(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.phaseTrace) return true;
  const raw = env.ZHIN_AGENT_PHASE_TRACE?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
}

function envFlagEnabled(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
}

/** 默认随 phaseTrace 开启；可单独用 `ZHIN_AGENT_PROMPT_TRACE` 或 `ai.agent.promptTrace` 控制。 */
export function isPromptTraceEnabled(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.promptTrace === true) return true;
  if (config.promptTrace === false) {
    return envFlagEnabled(env, 'ZHIN_AGENT_PROMPT_TRACE');
  }
  if (envFlagEnabled(env, 'ZHIN_AGENT_PROMPT_TRACE')) return true;
  return isPhaseTraceEnabled(config, env);
}

export function isPromptTraceVerbose(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.promptTraceVerbose) return true;
  return envFlagEnabled(env, 'ZHIN_AGENT_PROMPT_TRACE_VERBOSE');
}

/** Provider prompt cache：默认启用；`promptCache: false` 或 `ZHIN_AGENT_PROMPT_CACHE=0` 显式禁用。 */
export function isPromptCacheEnabled(
  config: Pick<ZhinAgentConfig, 'promptCache'>,
  modelSdk: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const supported = modelSdk === 'anthropic'
    || modelSdk === 'openai'
    || modelSdk === 'openai-compatible';
  if (!supported) return false;
  if (config.promptCache === false) return false;
  const raw = env.ZHIN_AGENT_PROMPT_CACHE?.trim().toLowerCase();
  if (raw && ['0', 'false', 'no', 'off'].includes(raw)) return false;
  return true;
}

export function buildAgentPromptCacheStreamOptions(
  config: Pick<ZhinAgentConfig, 'promptCache' | 'promptCacheRetention' | 'promptCacheKeyPrefix'>,
  parts: {
    modelSdk: string | undefined;
    provider: string;
    modelId: string;
    label: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): {
  promptCache: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: 'in_memory' | '24h';
} {
  const promptCache = isPromptCacheEnabled(config, parts.modelSdk, env);
  if (!promptCache) return { promptCache: false };
  return {
    promptCache: true,
    promptCacheKey: buildPromptCacheKey({
      prefix: config.promptCacheKeyPrefix ?? 'zhin',
      label: parts.label,
      provider: parts.provider,
      modelId: parts.modelId,
    }),
    promptCacheRetention: config.promptCacheRetention ?? 'in_memory',
  };
}

/** run_deferred_task 外层超时：须覆盖 Worker 多轮 LLM + MCP（默认远高于 Agent 30s 工具超时） */
export function resolveDeferredTaskToolTimeout(
  config: Pick<Required<ZhinAgentConfig>, 'timeout' | 'subagentTurnWaitMs' | 'maxSubagentIterations'>,
): number {
  const turnMs = config.timeout ?? 60_000;
  const waitMs = config.subagentTurnWaitMs ?? 180_000;
  const maxIter = config.maxSubagentIterations ?? 15;
  const iterationBudget = turnMs * Math.min(maxIter, 10);
  return Math.max(waitMs, iterationBudget, 180_000);
}

/** Worker 内慢工具（MCP 等）默认超时 */
export function resolveWorkerSlowToolTimeout(
  config: Pick<Required<ZhinAgentConfig>, 'timeout' | 'maxSubagentIterations'>,
): number {
  const turnMs = config.timeout ?? 60_000;
  return Math.min(180_000, Math.max(60_000, turnMs * 2));
}
