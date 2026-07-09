import { buildPromptCacheKey } from '@zhin.js/ai';
import type { ZhinAgentConfig, ModelSizeHint } from './zhin-agent-config.js';

const SMALL_MODEL_RE = /[:\-_](0\.5|1\.?[58]?|[3-8])b\b/i;
const MEDIUM_MODEL_RE = /[:\-_](14|[12][0-9]|32)b\b/i;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function inferModelSize(modelName: string): ModelSizeHint {
  if (SMALL_MODEL_RE.test(modelName)) return 'small';
  if (MEDIUM_MODEL_RE.test(modelName)) return 'medium';
  return 'large';
}

export function resolveModelSize(config: Required<ZhinAgentConfig>, modelName: string): ModelSizeHint {
  if (config.modelSizeHint && (config.modelSizeHint as string) !== '') return config.modelSizeHint as ModelSizeHint;
  return inferModelSize(modelName);
}

export function resolveSkillInstructionMaxChars(config: Required<ZhinAgentConfig>, modelName: string): number {
  if (config.skillInstructionMaxChars && config.skillInstructionMaxChars > 0) return config.skillInstructionMaxChars;
  const size = resolveModelSize(config, modelName);
  switch (size) {
    case 'small': return 1500;
    case 'medium': return 4000;
    case 'large': return 8000;
  }
}

export function isPhaseTraceEnabled(config: Required<ZhinAgentConfig>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.phaseTrace) return true;
  const raw = env.ZHIN_AGENT_PHASE_TRACE?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
}

function envFlagEnabled(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return !!raw && TRUE_VALUES.has(raw);
}

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

export function resolveDeferredTaskToolTimeout(
  config: Pick<Required<ZhinAgentConfig>, 'timeout' | 'subagentTurnWaitMs' | 'maxSubagentIterations'>,
): number {
  const turnMs = config.timeout ?? 60_000;
  const waitMs = config.subagentTurnWaitMs ?? 180_000;
  const maxIter = config.maxSubagentIterations ?? 15;
  const iterationBudget = turnMs * Math.min(maxIter, 10);
  return Math.max(waitMs, iterationBudget, 180_000);
}

export function resolveWorkerSlowToolTimeout(
  config: Pick<Required<ZhinAgentConfig>, 'timeout' | 'maxSubagentIterations'>,
): number {
  const turnMs = config.timeout ?? 60_000;
  return Math.min(180_000, Math.max(60_000, turnMs * 2));
}
