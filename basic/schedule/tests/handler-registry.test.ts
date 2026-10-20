import { describe, expect, it, vi } from 'vitest';
import { createHandlerRegistry } from '../src/store/handler-registry.js';

describe('HandlerRegistry', () => {
  it('registers and retrieves handlers', () => {
    const registry = createHandlerRegistry();
    const handler = vi.fn();
    registry.register('daily', handler);

    expect(registry.has('daily')).toBe(true);
    expect(registry.get('daily')).toBe(handler);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('seeds from initial record', () => {
    const handler = vi.fn();
    const registry = createHandlerRegistry({ weekly: handler });
    expect(registry.get('weekly')).toBe(handler);
  });

  it('register returns this for chaining', () => {
    const registry = createHandlerRegistry();
    const result = registry.register('a', vi.fn()).register('b', vi.fn());
    expect(result).toBe(registry);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('b')).toBe(true);
  });
});
