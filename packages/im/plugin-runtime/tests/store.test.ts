import { describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  createPluginEventChannel,
  createToken,
  definePlugin,
  definePluginConsoleRpc,
  definePluginStore,
  pluginConsoleRpcToken,
  pluginDataMigrationProviderToken,
  pluginTaskProviderToken,
  pluginVerificationToken,
  rootPluginId,
  type PluginDataMigrationProvider,
  type PluginSetupContext,
  type PluginTaskProvider,
  type PluginVerificationHost,
} from '../src/index.js';

function createTestSetupContext<TConfig = Record<string, unknown>>(
  config: TConfig = {} as TConfig,
): { context: PluginSetupContext<TConfig>; scope: Scope } {
  const owner = rootPluginId();
  const scope = new Scope(owner);
  const events = createPluginEventChannel();
  const controller = new AbortController();
  const context: PluginSetupContext<TConfig> = {
    events: events.subscriptions,
    signal: controller.signal,
    plugin: {
      id: owner,
      instanceKey: 'root',
      root: owner,
      role: 'root',
    },
    config: {
      get: () => Object.freeze({ ...config }),
    },
    resources: scope,
    lifecycle: new DisposeStack(),
    handoff: new GenerationHandoffStack(),
    addFeature() {},
  };
  return { context, scope };
}

describe('Scope.get and definePluginStore', () => {
  it('supports Scope.get without throwing when a token is absent', () => {
    const scope = new Scope(rootPluginId());
    const token = createToken<number>('test.counter');
    expect(scope.get(token)).toBeUndefined();
    scope.provide(token, 42);
    expect(scope.get(token)).toBe(42);
  });

  it('provides, reads, checks, and disposes generation-scoped stores', async () => {
    const disposed: string[] = [];
    const store = definePluginStore<{ readonly label: string; dispose(): void }>(
      'test.store.disposable',
      'Disposable test store',
    );
    const { context, scope } = createTestSetupContext();

    expect(store.has(context)).toBe(false);
    expect(store.get(context)).toBeUndefined();
    expect(store.has(scope)).toBe(false);
    expect(store.get(scope)).toBeUndefined();

    const instance = store.provide(context, () => ({
      label: 'ready',
      dispose() {
        disposed.push('dispose-method');
      },
    }));

    expect(instance.label).toBe('ready');
    expect(store.use(context)).toBe(instance);
    expect(store.use(scope)).toBe(instance);
    expect(store.has(context)).toBe(true);
    expect(store.get(context)).toBe(instance);
    expect(scope.use(store)).toBe(instance);

    // Reader carrier without .has()
    const minimalReader = {
      use: <T>(token: import('../src/index.js').Token<T>) => scope.use(token),
    };
    expect(store.has(minimalReader)).toBe(true);
    expect(store.get(minimalReader)).toBe(instance);

    scope.seal();
    await scope.disposers.dispose();
    expect(disposed).toEqual(['dispose-method']);
  });

  it('supports options.create, options.dispose, stop(), Symbol.dispose, and Symbol.asyncDispose', async () => {
    const events: string[] = [];
    const { context, scope } = createTestSetupContext({ prefix: 'cfg' });

    const createdStore = definePluginStore<{ readonly value: string }, { readonly prefix: string }>({
      id: 'test.store.options',
      create: (ctx) => ({ value: `${ctx.config.get().prefix}:ok` }),
      dispose: (val) => {
        events.push(`custom:${val.value}`);
      },
    });
    expect(createdStore.provide(context)).toEqual({ value: 'cfg:ok' });

    const stoppableStore = definePluginStore<{ stop(): Promise<void> }>('test.store.stoppable');
    stoppableStore.provide(context, {
      async stop() {
        events.push('stop');
      },
    });

    const syncSymbolStore = definePluginStore<{ [Symbol.dispose](): void }>('test.store.sym-dispose');
    syncSymbolStore.provide(context, {
      [Symbol.dispose]() {
        events.push('symbol.dispose');
      },
    });

    const asyncSymbolStore = definePluginStore<{ [Symbol.asyncDispose](): Promise<void> }>(
      'test.store.sym-async-dispose',
    );
    asyncSymbolStore.provide(context, {
      async [Symbol.asyncDispose]() {
        events.push('symbol.asyncDispose');
      },
    });

    const emptyStore = definePluginStore<number>('test.store.empty');
    expect(() => emptyStore.provide(context)).toThrow(TypeError);

    scope.seal();
    await scope.disposers.dispose();
    expect(events).toEqual([
      'symbol.asyncDispose',
      'symbol.dispose',
      'stop',
      'custom:cfg:ok',
    ]);
  });

  it('registers declarative PluginSetupCapabilities returned from definePlugin setup()', async () => {
    const { context, scope } = createTestSetupContext();
    const disposeSpy = vi.fn();
    const fakeTasks = { title: 't', description: 'd', schema: {}, effects: [] } as unknown as PluginTaskProvider;
    const fakeVerification: PluginVerificationHost = {
      checks: () => [],
      run: async () => ({ status: 'passed', summary: 'ok', evidence: [] }),
    };
    const fakeMigration = { inventory: async () => ({ candidates: [] }) } as unknown as PluginDataMigrationProvider;

    const plugin = definePlugin({
      name: 'declarative-plugin',
      setup() {
        return {
          consoleRpc: {
            status: {
              demo: true,
              handler: () => ({ healthy: true }),
            },
          },
          tasks: fakeTasks,
          verification: fakeVerification,
          dataMigration: fakeMigration,
          dispose: disposeSpy,
        };
      },
    });

    const returnedDispose = await plugin.setup!(context);
    expect(returnedDispose).toBe(disposeSpy);
    expect(scope.get(pluginConsoleRpcToken)?.methods.has('status')).toBe(true);
    expect(scope.get(pluginTaskProviderToken)).toBe(fakeTasks);
    expect(scope.get(pluginVerificationToken)).toBe(fakeVerification);
    expect(scope.get(pluginDataMigrationProviderToken)).toBe(fakeMigration);

    // Also supports pre-built definePluginConsoleRpc in async setup()
    const { context: asyncCtx, scope: asyncScope } = createTestSetupContext();
    const prebuiltRpc = definePluginConsoleRpc({
      status: { handler: () => ({ ok: 1 }) },
    });
    const asyncPlugin = definePlugin({
      name: 'async-declarative-plugin',
      async setup() {
        return { consoleRpc: prebuiltRpc };
      },
    });
    await asyncPlugin.setup!(asyncCtx);
    expect(asyncScope.get(pluginConsoleRpcToken)).toBe(prebuiltRpc);
  });
});
