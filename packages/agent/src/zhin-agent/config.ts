/**
 * ZhinAgent 配置、常量、类型定义
 */

import type { RateLimitConfig } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TOKENS } from '@zhin.js/ai';
import { PERMISSION_LEVEL_PRIORITY } from '../orchestrator/tool-selection.js';
import type { ModelHarnessConfig } from './model-harness.js';

export type ModelSizeHint = 'small' | 'medium' | 'large';

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
export const CURRENT_MESSAGE_MARKER = '[Current message - respond to this]';

export const PERM_MAP: Record<string, number> = PERMISSION_LEVEL_PRIORITY;

export type OnChunkCallback = (chunk: string, full: string) => void;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 上下文感知内置工具的关键词触发正则 */
export const KEYWORD_TRIGGERS = {
  chatHistory: /之前|上次|历史|回忆|聊过|记录|还记得|曾经/i,
  userProfile: /偏好|设置|配置|档案|资料|时区|timezone|profile|喜好|我叫|叫我|记住我/i,
  spawnTask: /后台|子任务|spawn|异步|background|并行|独立处理/i,
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
  /** 纯闲聊(0工具)使用的轻量模型，留空则复用 chatModel */
  chatLiteModel?: string;
  visionModel?: string;
  contextTokens?: number;
  maxHistoryShare?: number;
  disabledTools?: string[];
  allowedTools?: string[];
  execSecurity?: 'deny' | 'allowlist' | 'full';
  execPreset?: 'readonly' | 'network' | 'development' | 'custom';
  execAllowlist?: string[];
  execAsk?: boolean;
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
  /** 启用 Claude Code 式 deferred + 同步 Worker（主 Agent 仅编排） */
  toolSearch?: boolean;
  /** Worker 侧 TF-IDF 载入 deferred 工具数量上限 */
  toolSearchMaxResults?: number;
  /** toolSearch 模式下主 Agent 常驻工具名 */
  toolSearchOrchestratorTools?: string[];
  /** toolSearch 模式下 Worker 基础工具（另加 TF-IDF 载入的 deferred） */
  toolSearchWorkerBaseTools?: string[];
  /** 单轮平台 prompt 段 body 上限（字符） */
  platformPromptSectionMaxChars?: number;
  /** 单 slot 平台 prompt 合计上限（字符） */
  platformPromptMaxChars?: number;
}

/** toolSearch 主 Agent 默认常驻（不含 activate_skill：执行一律经 Worker） */
export const DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS = [
  'tool_search',
  'run_deferred_task',
  'ask_user',
] as const;

/** toolSearch 模式下不进入主编排也不进入 deferred 目录 */
export const TOOL_SEARCH_EXCLUDED_TOOLS = ['activate_skill', 'install_skill'] as const;

/** toolSearch Worker 默认基础工具 */
export const DEFAULT_TOOL_SEARCH_WORKER_BASE_TOOLS = [
  'bash',
  'read_file',
] as const;

export const DEFAULT_CONFIG: Required<ZhinAgentConfig> = {
  persona: 'You are Zhin, an intelligent IM assistant running in Zhin.js. Answer clearly, act through available tools when needed, and never claim actions or results unless confirmed by tool output.',
  maxIterations: 5,
  timeout: 60_000,
  preExecTimeout: 10_000,
  maxSkills: 3,
  maxTools: 8,
  minTopicRounds: 5,
  slidingWindowSize: 5,
  topicChangeThreshold: 0.15,
  rateLimit: {},
  toneAwareness: true,
  chatModel: '',
  chatLiteModel: '',
  visionModel: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  maxHistoryShare: 0.5,
  disabledTools: [],
  allowedTools: [],
  execSecurity: 'deny',
  execPreset: 'custom',
  execAllowlist: [],
  execAsk: false,
  maxSubagentIterations: 15,
  subagentTools: [],
  subagentTurnWaitMs: 180_000,
  modelSizeHint: '',
  skillInstructionMaxChars: 0,
  modelHarness: {},
  phaseTrace: false,
  onPhaseTrace: () => {},
  toolSearch: false,
  toolSearchMaxResults: 5,
  toolSearchOrchestratorTools: [...DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS],
  toolSearchWorkerBaseTools: [...DEFAULT_TOOL_SEARCH_WORKER_BASE_TOOLS],
  platformPromptSectionMaxChars: 2048,
  platformPromptMaxChars: 4096,
};

/** `env` 参数主要用于测试注入，运行时默认读取 `process.env`。 */
export function isPhaseTraceEnabled(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.phaseTrace) return true;
  const raw = env.ZHIN_AGENT_PHASE_TRACE?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
}
