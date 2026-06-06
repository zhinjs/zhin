/**
 * ZhinAgent 配置、常量、类型定义
 */

import type { RateLimitConfig } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_FOLLOW_UP_MODE, DEFAULT_STEERING_MODE, type QueueMode } from '@zhin.js/ai';
import type { ModelHarnessConfig } from './model-harness.js';

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
  topicChangeThreshold?: number;
  rateLimit?: RateLimitConfig;
  toneAwareness?: boolean;
  /** 聊天任务使用的模型（覆盖自动选择） */
  chatModel?: string;
  visionModel?: string;
  contextTokens?: number;
  maxHistoryShare?: number;
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
  /** phase 观测回调（测试或自定义遥测；与 phaseTrace 同时生效） */
  onPhaseTrace?: (event: {
    phase: string;
    sessionId: string;
    extra: Record<string, unknown>;
  }) => void;
  /** Worker 侧 TF-IDF 载入 deferred 工具数量上限 */
  deferredToolMaxResults?: number;
  /** 主 Agent 常驻编排工具名 */
  orchestratorTools?: string[];
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
}

/** 主 Agent 默认常驻编排工具（不含 activate_skill：执行一律经 Worker；文生图走 deferred） */
export const DEFAULT_ORCHESTRATOR_TOOLS = [
  'tool_search',
  'run_deferred_task',
  'ask_user',
  'spawn_task',
] as const;

/** 不进入主编排也不进入 deferred 目录 */
export const DEFERRED_CATALOG_EXCLUDED_TOOLS = ['activate_skill', 'install_skill'] as const;

/** @deprecated 使用 DEFERRED_CATALOG_EXCLUDED_TOOLS */
export const TOOL_SEARCH_EXCLUDED_TOOLS = DEFERRED_CATALOG_EXCLUDED_TOOLS;

/** Deferred Worker 默认基础工具 */
export const DEFAULT_WORKER_BASE_TOOLS = [
  'bash',
  'read_file',
] as const;

/** @deprecated 使用 DEFAULT_ORCHESTRATOR_TOOLS */
export const DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS = DEFAULT_ORCHESTRATOR_TOOLS;

/** @deprecated 使用 DEFAULT_WORKER_BASE_TOOLS */
export const DEFAULT_TOOL_SEARCH_WORKER_BASE_TOOLS = DEFAULT_WORKER_BASE_TOOLS;

export const DEFAULT_CONFIG: Required<ZhinAgentConfig> = {
  persona: 'You are Zhin, an intelligent IM assistant running in Zhin.js. Answer clearly, act through available tools when needed, and never claim actions or results unless confirmed by tool output.',
  maxIterations: 15,  // 增加到15次，支持复杂任务
  timeout: 120_000,   // 增加到2分钟
  preExecTimeout: 15_000,
  maxSkills: 5,       // 增加技能数量
  maxTools: 12,       // 增加工具数量
  minTopicRounds: 5,
  slidingWindowSize: 5,
  topicChangeThreshold: 0.15,
  rateLimit: {},
  toneAwareness: true,
  chatModel: '',
  visionModel: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  maxHistoryShare: 0.5,
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
  deferredToolMaxResults: 8,
  orchestratorTools: [...DEFAULT_ORCHESTRATOR_TOOLS],
  workerBaseTools: [...DEFAULT_WORKER_BASE_TOOLS],
  platformPromptSectionMaxChars: 2048,
  platformPromptMaxChars: 4096,
  steeringMode: DEFAULT_STEERING_MODE,
  followUpMode: DEFAULT_FOLLOW_UP_MODE,
  policyDenialStopAfter: 2,
};

/** `env` 参数主要用于测试注入，运行时默认读取 `process.env`。 */
export function isPhaseTraceEnabled(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.phaseTrace) return true;
  const raw = env.ZHIN_AGENT_PHASE_TRACE?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
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
