import type { Usage } from '@zhin.js/ai';
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