import { describe, expect, it } from 'vitest';
import { createAgentTraceRuntime } from '../../src/plugin-runtime/agent-trace-runtime.js';

describe('Agent Trace runtime', () => {
  it('projects a turn lifecycle and omits streaming chunks', () => {
    let now = 100;
    const trace = createAgentTraceRuntime({ now: () => now++ });

    trace.record('discord:bot:group:room', 'turn-1', {
      type: 'turn_start',
      sessionId: 'discord:bot:group:room',
      turnId: 'turn-1',
    });
    trace.record('discord:bot:group:room', 'turn-1', {
      type: 'chunk',
      text: 'partial',
      accumulated: 'partial',
    });
    trace.record('discord:bot:group:room', 'turn-1', {
      type: 'tool_result',
      toolName: 'lookup',
      toolUseId: 'tool-1',
      output: { ok: true },
      durationMs: 24,
    });

    expect(trace.list('discord:bot:group:room')).toMatchObject({
      latestSequence: 2,
      activeTurnIds: ['turn-1'],
      events: [
        { sequence: 1, type: 'turn_start', turnId: 'turn-1' },
        { sequence: 2, type: 'tool_result', data: { toolName: 'lookup', durationMs: 24 } },
      ],
    });

    trace.record('discord:bot:group:room', 'turn-1', {
      type: 'turn_cancelled',
      code: 'cancelled',
      reason: 'owner requested',
    });
    expect(trace.list('discord:bot:group:room').activeTurnIds).toEqual([]);
  });

  it('redacts sensitive fields and bounds retained data', () => {
    const trace = createAgentTraceRuntime({ maxEventsPerSession: 2 });
    trace.record('session', 'turn', {
      type: 'tool_call',
      toolName: 'request',
      toolUseId: 'tool-1',
      args: {
        authorization: 'Bearer private',
        nested: { apiKey: 'private', value: 'safe' },
      },
    });
    trace.record('session', 'turn', { type: 'iteration_start', iteration: 1, maxIterations: 3 });
    trace.record('session', 'turn', { type: 'iteration_start', iteration: 2, maxIterations: 3 });

    const snapshot = trace.list('session');
    expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3]);

    const redactionTrace = createAgentTraceRuntime();
    redactionTrace.record('session', 'turn', {
      type: 'tool_call',
      toolName: 'request',
      toolUseId: 'tool-2',
      args: {
        authorization: 'Bearer private',
        nested: { apiKey: 'private', value: 'safe' },
      },
    });
    expect(redactionTrace.list('session').events[0]?.data).toMatchObject({
      args: {
        authorization: '[redacted]',
        nested: { apiKey: '[redacted]', value: 'safe' },
      },
    });
  });

  it('supports incremental reads without losing the latest cursor', () => {
    const trace = createAgentTraceRuntime();
    trace.record('session', 'turn', { type: 'iteration_start', iteration: 1, maxIterations: 3 });
    trace.record('session', 'turn', { type: 'iteration_start', iteration: 2, maxIterations: 3 });

    expect(trace.list('session', { afterSequence: 1 })).toMatchObject({
      latestSequence: 2,
      events: [{ sequence: 2 }],
    });
  });

  it('keeps usage token counts while redacting actual token secrets', () => {
    const trace = createAgentTraceRuntime();
    trace.record('session', 'turn', {
      type: 'usage',
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });

    expect(trace.list('session').events[0]?.data).toEqual({
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });
  });
});
