import { describe, expect, it, vi } from 'vitest';
import { EventSystem } from '../../src/event/event-system.js';

describe('EventSystem', () => {
  it('supports subscribe, middleware, and emit', async () => {
    const events: unknown[] = [];
    const system = new EventSystem({ source: 'test' });
    system.addMiddleware({
      process: async (event) => ({ ...event, payload: { ...(event.payload as object), wrapped: true } }),
    });
    system.on('turn_start', (event) => { events.push(event.payload); });

    await system.emit('turn_start', { sessionId: 's1' });

    expect(events).toEqual([{ sessionId: 's1', wrapped: true }]);
  });

  it('middleware can drop events', async () => {
    const handler = vi.fn();
    const system = new EventSystem();
    system.addMiddleware({ process: async () => null });
    system.on('turn_end', handler);
    await system.emit('turn_end', {});
    expect(handler).not.toHaveBeenCalled();
  });
});
