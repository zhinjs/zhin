import { describe, expect, it, vi } from 'vitest';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createAgentStreamBus } from '../../src/event/agent-stream-bus.js';

describe('AgentStreamBus', () => {
  it('fans out to registered sinks once per publish', async () => {
    const bus = createAgentStreamBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.registerSink({ name: 'a', handle: a });
    bus.registerSink({ name: 'b', handle: b });

    await bus.publish({
      type: AgentStreamEventType.TURN_STARTED,
      data: { sessionId: 's1', turnId: 't1' },
    }, { sessionId: 's1', turnId: 't1' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].timestamp).toBeTypeOf('number');
  });

  it('unregister sink stops delivery', async () => {
    const bus = createAgentStreamBus();
    const sink = vi.fn();
    const off = bus.registerSink({ name: 'x', handle: sink });
    off();
    await bus.publish({ type: AgentStreamEventType.MESSAGE_RECEIVED, data: {} });
    expect(sink).not.toHaveBeenCalled();
  });
});
