import { describe, expect, it, vi } from 'vitest';
import { buildWaterfall, toQueryTime, type TraceDetail } from './traceView.js';
import { registerAgentTraceConsole } from './registerAgentTraceConsole.js';

const detail: TraceDetail = {
  turn_id: 't', session_key: 's', started_at: 0, duration_ms: 1000,
  model_calls: [{ index: 1, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, { index: 2, prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 }],
  tool_calls: [{ tool_use_id: 'c1', tool_name: 'bash', args_summary: 'ls', status: 'failed', started_at_ms: 400, duration_ms: 200, error: 'boom' }],
  timeline: [
    { at_ms: 0, kind: 'iteration', detail: '1/6' },
    { at_ms: 400, kind: 'model_call', detail: '#1' },
    { at_ms: 400, kind: 'tool_call', detail: 'bash' },
    { at_ms: 600, kind: 'tool_failed', detail: 'bash: boom' },
    { at_ms: 1000, kind: 'model_call', detail: '#2' },
  ],
  termination: { status: 'completed' },
  usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
};

describe('trace archive page helpers (#728)', () => {
  it('lays model and tool calls on the turn time axis', () => {
    const bars = buildWaterfall(detail);
    expect(bars.map((b) => [b.label, Math.round(b.left), Math.round(b.width), b.failed])).toEqual([
      ['模型 #1', 0, 40, false],
      ['bash', 40, 20, true],
      ['模型 #2', 60, 40, false],
    ]);
  });

  it('converts datetime-local values to epoch query params', () => {
    expect(toQueryTime('')).toBe('');
    expect(toQueryTime('2026-10-14T08:00')).toBe(String(Date.parse('2026-10-14T08:00')));
  });

  it('registers the Agent Trace route and tool', () => {
    const addRoute = vi.fn();
    const addTool = vi.fn();
    registerAgentTraceConsole({ React: { createElement: vi.fn((type) => ({ type })) } as never, addRoute, addTool } as never);
    expect(addRoute).toHaveBeenCalledWith(expect.objectContaining({ path: '/console/agent-trace' }));
    expect(addTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-trace' }));
  });
});
