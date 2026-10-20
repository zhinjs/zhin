import { describe, expect, it, vi } from 'vitest';
import { SubagentSystem } from '../../src/subagent/subagent-system.js';
import { ImResultSink } from '../../src/subagent/im-result-sink.js';

describe('SubagentSystem', () => {
  it('composes ImResultSink into a unified sender', () => {
    const system = new SubagentSystem({});
    system.addResultSink(new ImResultSink({
      proactiveOutbound: { send: async () => {} },
    }));

    const sender = system.composeSender();
    expect(sender).toBeTypeOf('function');
  });

  it('ImResultSink exposes asResultSender compatible with SubagentSystem', () => {
    const sink = new ImResultSink({ proactiveOutbound: { send: async () => {} } });
    expect(typeof sink.asResultSender()).toBe('function');
  });

  it('forwards taskId and status to non-IM result sinks', async () => {
    const delivered: Array<{ taskId: string; status: string; result: string }> = [];
    const system = new SubagentSystem({});
    system.addResultSink({
      deliver: async (result) => { delivered.push(result as any); },
    });
    const sender = system.composeSender();
    await sender!(
      { message: { $scene: { id: 'g1' } } } as any,
      { text: 'done', taskId: 'task-42', status: 'error' },
    );
    expect(delivered).toEqual([{ taskId: 'task-42', status: 'failed', result: 'done' }]);
  });

  it('shares concurrent disposal completion', async () => {
    let release!: () => void;
    const runtimeDispose = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const system = new SubagentSystem({});
    (system as unknown as { runtime: { dispose(): Promise<void> } }).runtime = {
      dispose: runtimeDispose,
    };

    const first = system.dispose();
    let secondSettled = false;
    const repeated = system.dispose();
    expect(repeated).toBe(first);
    const second = repeated.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(runtimeDispose).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });
});
