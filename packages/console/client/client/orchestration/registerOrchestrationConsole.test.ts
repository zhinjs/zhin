import { describe, expect, it, vi } from 'vitest';
import { registerOrchestrationConsole } from './registerOrchestrationConsole.js';

describe('registerOrchestrationConsole', () => {
  it('registers orchestration route and tool', () => {
    const addRoute = vi.fn();
    const addTool = vi.fn();
    const React = { createElement: vi.fn((type) => ({ type })) };

    registerOrchestrationConsole({
      React: React as never,
      addRoute,
      addPage: addRoute,
      addTool,
    });

    expect(addRoute).toHaveBeenCalledWith(expect.objectContaining({
      path: '/console/orchestration',
      name: '编排',
    }));
    expect(addTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'orchestration',
      path: '/console/orchestration',
    }));
  });
});
