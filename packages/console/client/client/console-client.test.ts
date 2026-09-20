import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createConsoleClient } from './console-client.js';
import { ConsoleTransport } from './transport/console-transport.js';

describe('ConsoleClient', () => {
  it('owns application, transport, and runtime environment state', () => {
    const first = createConsoleClient({ getRuntimeEnv: () => 'development' });
    const second = createConsoleClient();

    first.app.addRoute({ path: '/first', name: 'First', element: 'first' });

    expect(first.getRuntimeEnv()).toBe('development');
    expect(second.getRuntimeEnv()).toBe('production');
    expect(first.app.getRoutes()).toHaveLength(1);
    expect(second.app.getRoutes()).toEqual([]);
    expect(first.transport).not.toBe(second.transport);
  });

  it('binds plugin registration to its owned application', () => {
    const client = createConsoleClient();
    const hostApi = client.createPluginRegisterHostApi(React);

    hostApi.addRoute({ path: '/plugin', name: 'Plugin', element: 'plugin' });
    hostApi.addTool({ id: 'plugin', name: 'Plugin' });

    expect(client.app.getRoutes().map((route) => route.path)).toEqual(['/plugin']);
    expect(client.app.getToolTree().map((tool) => tool.id)).toEqual(['plugin']);
  });

  it('disconnects its transport and clears its application on disposal', () => {
    const transport = new ConsoleTransport();
    const dispose = vi.spyOn(transport, 'dispose');
    const client = createConsoleClient({ transport });
    client.app.addRoute({ path: '/route', name: 'Route', element: 'route' });

    client.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(client.app.getRoutes()).toEqual([]);
    expect(() => client.connect()).toThrow('ConsoleClient has been disposed');

    client.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
