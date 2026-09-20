import { describe, expect, it, vi } from 'vitest';
import { createConsoleApp } from './app.js';

describe('ConsoleApp', () => {
  it('isolates registrations and subscriptions by application owner', () => {
    const first = createConsoleApp();
    const second = createConsoleApp();
    const listener = vi.fn();
    first.subscribe(listener);

    first.addRoute({ path: '/first', name: 'First', element: 'first' });
    first.addTool({ id: 'first', name: 'First' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(first.getRoutes()).toHaveLength(1);
    expect(first.getToolTree()).toHaveLength(1);
    expect(second.getRoutes()).toEqual([]);
    expect(second.getToolTree()).toEqual([]);
    expect(second.getVersion()).toBe(0);
  });

  it('releases all registrations and listeners on disposal', () => {
    const app = createConsoleApp();
    const listener = vi.fn();
    app.subscribe(listener);
    app.addRoute({ path: '/route', name: 'Route', element: 'route' });
    app.addTool({ id: 'tool', name: 'Tool' });

    app.dispose();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(app.getRoutes()).toEqual([]);
    expect(app.getToolTree()).toEqual([]);
    expect(() => app.addRoute({ path: '/next', name: 'Next', element: 'next' }))
      .toThrow('ConsoleApp has been disposed');
  });
});
