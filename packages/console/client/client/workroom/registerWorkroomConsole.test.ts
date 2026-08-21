import { describe, expect, it, vi } from 'vitest';
import { registerWorkroomConsole } from './registerWorkroomConsole.js';

describe('registerWorkroomConsole', () => {
  it('registers Workroom route and tool', () => {
    const addRoute = vi.fn();
    const addTool = vi.fn();
    const React = { createElement: vi.fn((type) => ({ type })) };

    registerWorkroomConsole({
      React: React as never,
      addRoute,
      addPage: addRoute,
      addTool,
    });

    expect(addRoute).toHaveBeenCalledWith(expect.objectContaining({
      path: '/console/workroom',
      name: 'Workroom',
    }));
    expect(addTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'workroom',
      path: '/console/workroom',
    }));
  });
});
