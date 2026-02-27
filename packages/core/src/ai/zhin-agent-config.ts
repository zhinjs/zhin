/**
 * ZhinAgent 配置、常量、类型定义
 */

import type { RateLimitConfig } from './rate-limiter.js';
import { DEFAULT_CONTEXT_TOKENS } from './compaction.js';

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
  if (config.modelSizeHint && config.modelSizeHint !== ('' as any)) return config.modelSizeHint;
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

export const PERM_MAP: Record<string, number> = {
  user: 0,
  group_admin: 1,
  group_owner: 2,
  bot_admin: 3,
  owner: 4,
};

export type OnChunkCallback = (chunk: string, full: string) => void;

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
  /** 模型大小提示，影响技能指令截断长度。留空则根据模型名自动推断 */
  modelSizeHint?: 'small' | 'medium' | 'large';
  /** 技能指令最大字符数（覆盖 modelSizeHint 推断值） */
  skillInstructionMaxChars?: number;
}

export const DEFAULT_CONFIG: Required<ZhinAgentConfig> = {
  persona: '你是一个友好的中文 AI 助手，擅长使用工具帮助用户解决问题。',
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
  modelSizeHint: '' as any,
  skillInstructionMaxChars: 0,
};
