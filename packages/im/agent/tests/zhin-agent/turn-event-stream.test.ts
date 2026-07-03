import { describe, it, expect } from 'vitest';
import type {
  TurnEvent,
  TurnStartEvent,
  ChunkEvent,
  ToolCallEvent,
  ToolResultEvent,
  ThinkingEvent,
  TurnEndEvent,
  TurnErrorEvent,
  SubagentStartEvent,
  SubagentProgressEvent,
  SubagentEndEvent,
  McpConnectEvent,
  McpToolCallEvent,
  TurnUsage,
} from '../../src/zhin-agent/turn-event.js';

describe('TurnEvent type structure', () => {
  it('turn_start event has required fields', () => {
    const event: TurnStartEvent = {
      type: 'turn_start',
      sessionId: 'sess-1',
      turnId: 'turn-1',
    };
    expect(event.type).toBe('turn_start');
    expect(event.sessionId).toBe('sess-1');
    expect(event.turnId).toBe('turn-1');
  });

  it('chunk event has text and accumulated', () => {
    const event: ChunkEvent = {
      type: 'chunk',
      text: 'hello',
      accumulated: 'hello world',
    };
    expect(event.type).toBe('chunk');
    expect(event.text).toBe('hello');
    expect(event.accumulated).toBe('hello world');
  });

  it('tool_call event has toolName, args, toolUseId', () => {
    const event: ToolCallEvent = {
      type: 'tool_call',
      toolName: 'bash',
      args: { command: 'ls' },
      toolUseId: 'tool-1',
    };
    expect(event.type).toBe('tool_call');
    expect(event.toolName).toBe('bash');
  });

  it('tool_result event has output and durationMs', () => {
    const event: ToolResultEvent = {
      type: 'tool_result',
      toolName: 'bash',
      output: 'file.txt',
      durationMs: 42,
      toolUseId: 'tool-1',
    };
    expect(event.type).toBe('tool_result');
    expect(event.durationMs).toBe(42);
  });

  it('thinking event has text', () => {
    const event: ThinkingEvent = {
      type: 'thinking',
      text: 'I should use bash...',
    };
    expect(event.type).toBe('thinking');
  });

  it('turn_end event has output and usage', () => {
    const usage: TurnUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    const event: TurnEndEvent = {
      type: 'turn_end',
      output: [{ type: 'text', text: 'done' }],
      usage,
    };
    expect(event.type).toBe('turn_end');
    expect(event.usage.totalTokens).toBe(150);
  });

  it('error event has error and recoverable flag', () => {
    const event: TurnErrorEvent = {
      type: 'error',
      error: new Error('boom'),
      recoverable: false,
    };
    expect(event.type).toBe('error');
    expect(event.error.message).toBe('boom');
    expect(event.recoverable).toBe(false);
  });

  it('subagent events have taskId', () => {
    const start: SubagentStartEvent = {
      type: 'subagent_start',
      taskId: 'task-1',
      agentName: 'researcher',
      description: 'research the topic',
    };
    const progress: SubagentProgressEvent = {
      type: 'subagent_progress',
      taskId: 'task-1',
      summary: '50% done',
    };
    const end: SubagentEndEvent = {
      type: 'subagent_end',
      taskId: 'task-1',
      status: 'ok',
      result: 'Found the answer',
    };
    expect(start.type).toBe('subagent_start');
    expect(progress.type).toBe('subagent_progress');
    expect(end.type).toBe('subagent_end');
    expect(end.status).toBe('ok');
  });

  it('MCP events have serverName', () => {
    const connect: McpConnectEvent = {
      type: 'mcp_connect',
      serverName: 'postgres',
      status: 'connected',
    };
    const toolCall: McpToolCallEvent = {
      type: 'mcp_tool_call',
      serverName: 'postgres',
      toolName: 'query',
    };
    expect(connect.type).toBe('mcp_connect');
    expect(toolCall.type).toBe('mcp_tool_call');
  });
});

describe('TurnEvent union type', () => {
  it('discriminates on type field', () => {
    const events: TurnEvent[] = [
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      { type: 'chunk', text: 'hi', accumulated: 'hi' },
      { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ];

    const types = events.map(e => e.type);
    expect(types).toEqual(['turn_start', 'chunk', 'turn_end']);
  });

  it('type narrowing works correctly', () => {
    const event: TurnEvent = {
      type: 'chunk',
      text: 'hello',
      accumulated: 'hello',
    };

    if (event.type === 'chunk') {
      expect(event.text).toBe('hello');
      expect(event.accumulated).toBe('hello');
    }
  });
});

describe('AsyncGenerator event flow pattern', () => {
  it('simulates event flow: start → chunks → end', async () => {
    async function* simulateStream(): AsyncGenerator<TurnEvent> {
      yield { type: 'turn_start', sessionId: 's1', turnId: 't1' };
      yield { type: 'chunk', text: 'Hello', accumulated: 'Hello' };
      yield { type: 'chunk', text: ' world', accumulated: 'Hello world' };
      yield {
        type: 'turn_end',
        output: [{ type: 'text', text: 'Hello world' }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    }

    const events: TurnEvent[] = [];
    for await (const event of simulateStream()) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events[0].type).toBe('turn_start');
    expect(events[1].type).toBe('chunk');
    expect(events[2].type).toBe('chunk');
    expect(events[3].type).toBe('turn_end');
  });

  it('simulates error flow: start → error', async () => {
    async function* simulateErrorStream(): AsyncGenerator<TurnEvent> {
      yield { type: 'turn_start', sessionId: 's1', turnId: 't1' };
      yield { type: 'error', error: new Error('API key invalid'), recoverable: false };
    }

    const events: TurnEvent[] = [];
    for await (const event of simulateErrorStream()) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('turn_start');
    expect(events[1].type).toBe('error');
    if (events[1].type === 'error') {
      expect(events[1].error.message).toBe('API key invalid');
    }
  });

  it('can consume processMessage-style output from generator', async () => {
    async function* stream(): AsyncGenerator<TurnEvent> {
      yield { type: 'turn_start', sessionId: 's', turnId: 't' };
      yield { type: 'chunk', text: 'ok', accumulated: 'ok' };
      yield {
        type: 'turn_end',
        output: [{ type: 'text', text: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    let result: TurnEvent | undefined;
    for await (const event of stream()) {
      if (event.type === 'turn_end') result = event;
    }

    expect(result).toBeDefined();
    expect(result!.type).toBe('turn_end');
    if (result!.type === 'turn_end') {
      expect(result!.output).toHaveLength(1);
    }
  });

  it('generator close aborts iteration cleanly', async () => {
    async function* infiniteStream(): AsyncGenerator<TurnEvent> {
      yield { type: 'turn_start', sessionId: 's', turnId: 't' };
      let i = 0;
      while (true) {
        yield { type: 'chunk', text: `chunk-${i++}`, accumulated: '' };
      }
    }

    const events: TurnEvent[] = [];
    for await (const event of infiniteStream()) {
      events.push(event);
      if (events.length >= 5) break;
    }

    expect(events).toHaveLength(5);
    expect(events[0].type).toBe('turn_start');
    expect(events[4].type).toBe('chunk');
  });
});
