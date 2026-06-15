import type { Usage, TokenUsage } from '@zhin.js/ai';
import { formatCompact, Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'ZhinAgent');

export interface PhaseTraceConfig {
  phaseTraceEnabled: boolean;
  onPhaseTrace?: (event: { phase: string; sessionId: string; extra: Record<string, unknown> }) => void;
}

export function logPhase(
  config: PhaseTraceConfig,
  phase: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): void {
  if (!config.phaseTraceEnabled) return;
  config.onPhaseTrace?.({ phase, sessionId, extra });
  const flat: Record<string, string | number | boolean> = { phase, session: sessionId };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue;
    flat[k] = typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean);
  }
  logger.info(formatCompact(flat));
}

export function usageLogFields(usage?: Usage): Record<string, number> {
  if (!usage) return {};
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export function tokenUsageLogFields(usage?: TokenUsage): Record<string, number> {
  if (!usage) return {};
  const fields: Record<string, number> = {
    promptTokens: usage.input,
    completionTokens: usage.output,
    totalTokens: usage.totalTokens,
  };
  if (usage.cacheRead > 0) fields.cacheReadTokens = usage.cacheRead;
  if (usage.cacheWrite > 0) fields.cacheWriteTokens = usage.cacheWrite;
  return fields;
}

export interface AgentLoopIterationTraceInput {
  iteration: number;
  model?: string;
  label?: string;
  usage?: TokenUsage;
  stopReason?: string;
  toolNames?: string;
}

/** 每次 LLM 迭代结束（含多轮 tool turn 的中间轮） */
export function logAgentLoopIterationEnd(
  config: PhaseTraceConfig,
  sessionId: string,
  input: AgentLoopIterationTraceInput,
): void {
  logPhase(config, 'agent_loop.iteration.end', sessionId, {
    iteration: input.iteration,
    model: input.model,
    label: input.label,
    stopReason: input.stopReason,
    toolNames: input.toolNames || undefined,
    ...tokenUsageLogFields(input.usage),
  });
}