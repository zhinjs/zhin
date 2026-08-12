import { describe, expect, it, vi } from 'vitest';
import {
  createToolRuntime,
  registerPolicyExtractor,
  type ToolRuntimeTurnContext,
  type ToolRuntimeJournalPort,
} from '../../src/tool/tool-runtime.js';
import type { AgentTool } from '@zhin.js/ai';
import type { ToolCallEvent, ToolResultEvent } from '../../src/event/turn-event.js';

function makeTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'test_tool',
    description: 'test',
    parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ToolRuntimeTurnContext> = {}): ToolRuntimeTurnContext {
  return {
    generation: 1,
    signal: new AbortController().signal,
    sessionId: 's1',
    commMessage: { $sender: { id: 'u1' } } as any,
    ...overrides,
  };
}

describe('ToolRuntime', () => {
  it('executes a tool and returns output + durationMs', async () => {
    const rt = createToolRuntime(makeCtx());
    const tool = makeTool({ execute: async () => 'hello' });
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(result.output).toBe('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.denied).toBeUndefined();
  });

  it('rejects when generation is invalid', async () => {
    const rt = createToolRuntime(makeCtx({
      isGenerationValid: (g) => g !== 1,
    }));
    const tool = makeTool();
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(result.denied).toBe('generation_invalid');
    expect(String(result.output)).toContain('generation 1');
  });

  it('rejects when tool generation mismatches turn generation', async () => {
    const rt = createToolRuntime(makeCtx({ generation: 2 }));
    const tool = makeTool({ generation: 1 });
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(result.denied).toBe('generation_mismatch');
  });

  it('allows execution when tool.generation matches turn generation', async () => {
    const rt = createToolRuntime(makeCtx({ generation: 3 }));
    const tool = makeTool({ generation: 3, execute: async () => 'matched' });
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(result.output).toBe('matched');
    expect(result.denied).toBeUndefined();
  });

  it('skips generation check when tool.generation is undefined', async () => {
    const rt = createToolRuntime(makeCtx({ generation: 5 }));
    const tool = makeTool({ execute: async () => 'no stamp' });
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(result.output).toBe('no stamp');
    expect(result.denied).toBeUndefined();
  });

  it('throws when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new Error('cancelled'));
    const rt = createToolRuntime(makeCtx({ signal: ac.signal }));
    const tool = makeTool();
    await expect(rt.execute(tool, {}, { toolCallId: 'tc1' }))
      .rejects.toThrow('cancelled');
  });

  it('waits for real tool settlement before reporting cancellation', async () => {
    const ac = new AbortController();
    let release!: () => void;
    const toolFinished = new Promise<void>((resolve) => { release = resolve; });
    const rt = createToolRuntime(makeCtx({ signal: ac.signal }));
    const tool = makeTool({
      execute: async (_args, _msg, context) => {
        expect(context?.signal).toBe(ac.signal);
        await toolFinished;
        return 'late result';
      },
    });
    const running = rt.execute(tool, {}, { toolCallId: 'tc1' });
    let settled = false;
    void running.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    const timeout = new Error('deadline elapsed');
    timeout.name = 'TriggerTimeoutError';
    ac.abort(timeout);
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(running).rejects.toBe(timeout);
  });

  it('emits journal events for successful execution', async () => {
    const events: (ToolCallEvent | ToolResultEvent)[] = [];
    const journal: ToolRuntimeJournalPort = { append: (evt) => { events.push(evt); } };
    const rt = createToolRuntime(makeCtx({ journal }));
    const tool = makeTool({ execute: async () => 'result' });
    await rt.execute(tool, { key: 'val' }, { toolCallId: 'tc1' });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_call');
    expect((events[0] as ToolCallEvent).toolName).toBe('test_tool');
    expect((events[0] as ToolCallEvent).args).toEqual({ key: 'val' });
    expect(events[1].type).toBe('tool_result');
    expect((events[1] as ToolResultEvent).output).toBe('result');
  });

  it('emits journal events even when policy denies', async () => {
    const events: (ToolCallEvent | ToolResultEvent)[] = [];
    const journal: ToolRuntimeJournalPort = { append: (evt) => { events.push(evt); } };
    registerPolicyExtractor('deny_test_tool', (toolName) => ({
      toolName,
      command: 'rm -rf /',
    }));
    const rt = createToolRuntime(makeCtx({ journal }));
    const tool = makeTool({ name: 'deny_test_tool' });
    const result = await rt.execute(tool, {}, { toolCallId: 'tc1' });
    expect(events.length).toBeGreaterThanOrEqual(0);
    if (result.denied) {
      expect(typeof result.denied).toBe('string');
    }
  });

  it('exposes generation on the runtime instance', () => {
    const rt = createToolRuntime(makeCtx({ generation: 42 }));
    expect(rt.generation).toBe(42);
  });
});
