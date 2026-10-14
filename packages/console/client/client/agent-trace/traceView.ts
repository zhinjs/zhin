/** Pure helpers for the trace archive page (#728): waterfall layout and labels. */

export type TraceModelCall = { index: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cache_read_tokens?: number };
export type TraceToolCall = { tool_use_id: string; tool_name: string; args_summary: string; status: string; started_at_ms: number; duration_ms?: number; result_size?: number; error?: string; policy?: string };
export type TraceTimelineEntry = { at_ms: number; kind: string; detail: string };
export type TraceDetail = {
  turn_id: string;
  session_key: string;
  principal?: { subject_id: string; display_name?: string; roles: string[]; trust_level?: string };
  started_at: number;
  duration_ms?: number;
  model_calls: TraceModelCall[];
  tool_calls: TraceToolCall[];
  timeline: TraceTimelineEntry[];
  termination: { status: string; code?: string; reason?: string };
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  subagents?: TraceDetail[];
};

export type WaterfallBar = {
  readonly key: string;
  readonly kind: 'model' | 'tool';
  readonly label: string;
  /** Left offset and width as percentages of the turn duration. */
  readonly left: number;
  readonly width: number;
  readonly failed: boolean;
  readonly title: string;
};

/**
 * Lay model and tool calls on the turn's time axis. Tool calls carry their own
 * start and duration; a model call ends at its `model_call` timeline entry and
 * starts at the previous step boundary (iteration start or last tool result).
 */
export function buildWaterfall(trace: TraceDetail): WaterfallBar[] {
  const ends = [
    trace.duration_ms ?? 0,
    ...trace.timeline.map((entry) => entry.at_ms),
    ...trace.tool_calls.map((call) => call.started_at_ms + (call.duration_ms ?? 0)),
  ];
  const total = Math.max(1, ...ends);
  const place = (start: number, duration: number) => {
    const left = Math.min(100, Math.max(0, (start / total) * 100));
    return { left, width: Math.max(0.5, Math.min(100 - left, (duration / total) * 100)) };
  };
  const bars: WaterfallBar[] = [];
  let boundary = 0;
  let modelIndex = 0;
  for (const entry of trace.timeline) {
    if (entry.kind === 'iteration' || entry.kind.startsWith('tool_result') || entry.kind === 'tool_failed' || entry.kind === 'tool_denied') {
      boundary = Math.max(boundary, entry.at_ms);
    }
    if (entry.kind === 'model_call') {
      const call = trace.model_calls[modelIndex];
      modelIndex += 1;
      bars.push({
        key: `m${modelIndex}`,
        kind: 'model',
        label: `模型 #${call?.index ?? modelIndex}`,
        ...place(boundary, entry.at_ms - boundary),
        failed: false,
        title: call
          ? `${entry.at_ms - boundary}ms · in ${call.prompt_tokens} / out ${call.completion_tokens}${call.cache_read_tokens ? ` / cache ${call.cache_read_tokens}` : ''}`
          : entry.detail,
      });
      boundary = entry.at_ms;
    }
  }
  trace.tool_calls.forEach((call, index) => {
    bars.push({
      key: `t${index}`,
      kind: 'tool',
      label: call.tool_name,
      ...place(call.started_at_ms, call.duration_ms ?? 0),
      failed: call.status !== 'ok' && call.status !== 'running',
      title: `${call.status} ${call.duration_ms ?? 0}ms${call.args_summary ? ` · ${call.args_summary}` : ''}${call.error ? ` · ${call.error}` : ''}`,
    });
  });
  return bars.sort((a, b) => a.left - b.left);
}

export function formatTime(epochMs: number | undefined): string {
  return epochMs ? new Date(epochMs).toLocaleString() : '—';
}

/** `datetime-local` input value → epoch ms query param (empty when unset). */
export function toQueryTime(value: string): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}
