import { describe, it, expect, vi } from 'vitest';
import { EventSystem } from '../../src/event/event-system.js';
import { FilteringMiddleware } from '../../src/event/filtering-middleware.js';

describe('FilteringMiddleware', () => {
  it('passes events when no allow/deny configured', async () => {
    const mw = new FilteringMiddleware();
    const event = { type: 'agent.turn.start', payload: {}, timestamp: 1 };
    await expect(mw.process(event)).resolves.toEqual(event);
  });

  it('drops denied event types', async () => {
    const mw = new FilteringMiddleware({ deniedEventTypes: ['agent.turn.error'] });
    const event = { type: 'agent.turn.error', payload: {}, timestamp: 1 };
    await expect(mw.process(event)).resolves.toBeNull();
  });

  it('allowlist permits only listed types', async () => {
    const mw = new FilteringMiddleware({ allowedEventTypes: ['agent.turn.start'] });
    const allowed = { type: 'agent.turn.start', payload: {}, timestamp: 1 };
    const blocked = { type: 'agent.turn.end', payload: {}, timestamp: 2 };
    await expect(mw.process(allowed)).resolves.toEqual(allowed);
    await expect(mw.process(blocked)).resolves.toBeNull();
  });

  it('deny takes precedence over allow', async () => {
    const mw = new FilteringMiddleware({
      allowedEventTypes: ['agent.turn.start', 'agent.turn.error'],
      deniedEventTypes: ['agent.turn.error'],
    });
    const event = { type: 'agent.turn.error', payload: {}, timestamp: 1 };
    await expect(mw.process(event)).resolves.toBeNull();
  });
});

describe('EventSystem with FilteringMiddleware', () => {
  it('does not invoke listeners for filtered events', async () => {
    const system = new EventSystem({ source: 'test' });
    system.addMiddleware(new FilteringMiddleware({ deniedEventTypes: ['blocked'] }));
    const handler = vi.fn();
    system.on('blocked', handler);
    system.on('allowed', handler);

    await system.emit('blocked', { x: 1 });
    await system.emit('allowed', { x: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'allowed' }));
  });

  it('createEventSystem wires filtering from config', async () => {
    const { createEventSystem } = await import('../../src/event/event-system.js');
    const system = createEventSystem({
      source: 'test',
      allowedEventTypes: ['agent.turn.start'],
    });
    const handler = vi.fn();
    system.on('agent.turn.start', handler);
    system.on('agent.turn.end', handler);

    await system.emit('agent.turn.start', {});
    await system.emit('agent.turn.end', {});

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
