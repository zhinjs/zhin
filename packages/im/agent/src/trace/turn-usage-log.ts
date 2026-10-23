import { formatCompact, type Logger } from '@zhin.js/logger';
import type { TurnTrace, TurnTraceModelCall } from './turn-trace.js';

export interface UsageLogContext {
  traceId: string;
  scene: string;
  selectedModel?: string;
  status?: string;
}

type Field = 'input' | 'output' | 'totalTokens' | 'cacheRead' | 'cacheWrite' | 'reasoning';
const FIELDS = {
  input: 'prompt_tokens', output: 'completion_tokens', totalTokens: 'total_tokens',
  cacheRead: 'cache_read_tokens', cacheWrite: 'cache_write_tokens', reasoning: 'reasoning_tokens',
} as const;

// Metadata can contain controls too; preserve one physical line and field boundaries.
function safe(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029|]/gu, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 240);
}

function known(call: TurnTraceModelCall, field: Field): number | undefined {
  const value = call[FIELDS[field]];
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  // Old records lack availability. Positive usage is evidence; normalized zero isn't.
  const reported = call.reported?.[field] ?? (field === 'cacheRead' || field === 'cacheWrite' || field === 'reasoning'
    ? true : value > 0);
  return reported ? value : undefined;
}

/** A partial sum is explicitly a lower bound, never an apparently complete zero. */
function sum(calls: readonly TurnTraceModelCall[], field: Field): number | string {
  if (!calls.length) return 0;
  const values = calls.map(call => known(call, field));
  const present = values.filter((v): v is number => v !== undefined);
  if (!present.length) return '?';
  const total = present.reduce((a, b) => a + b, 0);
  return present.length === calls.length ? total : `>=${total}`;
}

function tree(trace: TurnTrace): TurnTrace[] {
  return [trace, ...trace.subagents.flatMap(tree)];
}

function tokens(calls: readonly TurnTraceModelCall[]) {
  return { input: sum(calls, 'input'), output: sum(calls, 'output'),
    cache_read: sum(calls, 'cacheRead'), cache_write: sum(calls, 'cacheWrite'), reasoning: sum(calls, 'reasoning') };
}

export function formatTurnUsageLogs(trace: TurnTrace, context: UsageLogContext, includeDetails = true): { summary: string; details: string[] } {
  const traces = tree(trace);
  const calls = traces.flatMap(item => item.model_calls);
  const identity = { trace: safe(context.traceId), turn: safe(trace.turn_id) };
  const models = [...new Set(calls.map(call => `${call.provider ?? '?'}/${call.model ?? '?'}`))];
  const summary = formatCompact({ op: 'turn', ...identity, scene: safe(context.scene),
    status: context.status ?? trace.termination.status,
    model: safe(models.join(',') || context.selectedModel || '?'),
    calls: calls.length, ...tokens(calls),
    ms: trace.duration_ms === undefined ? '?' : Math.round(trace.duration_ms),
    ...(traces.length > 1 ? { subagent_calls: calls.length - trace.model_calls.length } : {}),
    ...((context.status ?? trace.termination.status) !== 'completed'
      || traces.some(item => item.dropped > 0 || item.termination.status !== 'completed')
      ? { partial: true } : {}),
  });
  const details = includeDetails ? traces.flatMap(item => {
    const ids = { trace: identity.trace, turn: safe(item.turn_id) };
    const lines = item.model_calls.map(call => formatCompact({ op: 'call', ...ids, index: call.index,
      model: safe(`${call.provider ?? '?'}/${call.model ?? '?'}`), status: safe(call.stop_reason ?? '?'),
      ...tokens([call]), ms: call.duration_ms === undefined ? '?' : Math.round(call.duration_ms) }));
    const budget = item.context_budget;
    if (budget) lines.push(formatCompact({ op: 'context', ...ids, request: 'first', unit: 'estimated_tokens',
      total: budget.total_tokens, fixed: budget.fixed_tokens,
      segments: Object.entries(budget.segments).map(([key, value]) => `${safe(key)}=${value}`).join(' '),
      loaded_tools: budget.tools.loaded, deferred_tools: budget.tools.deferred }));
    return lines;
  }) : [];
  return { summary, details };
}

/** Logging is a projection of the existing trace, never execution authority. */
export function logTurnUsage(logger: Pick<Logger, 'info' | 'debug' | 'isLevelEnabled'>, trace: TurnTrace, context: UsageLogContext): void {
  try {
    if (!logger.isLevelEnabled('info')) return;
    const debug = logger.isLevelEnabled('debug');
    const lines = formatTurnUsageLogs(trace, context, debug);
    logger.info(lines.summary);
    if (debug) for (const line of lines.details) logger.debug(line);
  } catch {
    // A transport/formatter failure must not change the outcome or skip trace persistence.
  }
}
