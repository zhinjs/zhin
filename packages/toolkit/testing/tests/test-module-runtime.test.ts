import type { ModuleRuntime } from '@zhin.js/runtime';
import { withTestEndpoints } from '../src/test-module-runtime.js';

// #1250: the test kit decorates the real module runtime; a port it drops (e.g. the cross-package
// staleDependents / updateRevisionableRoots) silently disables that reload path in kit scenarios.
describe('withTestEndpoints', () => {
  const ports = [
    'loadClientModule', 'invalidate', 'prepareInvalidation', 'affectedSources', 'staleDependents',
    'updateRevisionableRoots', 'requiresProcessRestart', 'beginGeneration', 'commitGeneration',
    'rollbackGeneration', 'updateWatchRoots', 'watch',
  ] as const;

  it('forwards every optional ModuleRuntime port the delegate implements', async () => {
    // Adding a port to ModuleRuntime fails this exhaustiveness check until it is listed above.
    const exhaustive: Exclude<keyof ModuleRuntime, (typeof ports)[number] | 'load' | 'close'> extends never
      ? true : never = true;
    expect(exhaustive).toBe(true);
    const calls: [string, unknown[]][] = [];
    const delegate: Record<string, unknown> = {
      async load() { return {}; },
      async close() { calls.push(['close', []]); },
    };
    for (const port of ports) {
      delegate[port] = function (this: unknown, ...args: unknown[]) {
        expect(this).toBe(delegate);
        calls.push([port, args]);
        return port === 'watch' ? () => undefined : `result:${port}`;
      };
    }
    const modules = withTestEndpoints(delegate as unknown as ModuleRuntime, '/project/plugin.ts', new Map());
    const forwarded = modules as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const port of ports) {
      expect(typeof forwarded[port], port).toBe('function');
      const result = await forwarded[port]!(`arg:${port}`);
      expect(calls.at(-1), port).toEqual([port, [`arg:${port}`]]);
      if (port !== 'watch') expect(result, port).toBe(`result:${port}`);
    }
    await modules.close();
    expect(calls.at(-1)).toEqual(['close', []]);
  });

  it('leaves ports the delegate lacks absent, so callers keep their own fallbacks', () => {
    const modules = withTestEndpoints({ async load<T>() { return {} as T; }, async close() {} }, '/project/plugin.ts', new Map());
    expect(modules.staleDependents).toBeUndefined();
    expect(modules.updateRevisionableRoots).toBeUndefined();
  });
});
