import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameHubFeature,
  ensureGameHubService,
  getRegisteredGames,
} from '../src/game-hub-feature.js';
import {
  isGameHubMounted,
  resetGameHubMountForTests,
} from '../src/game-hub-mount.js';

function mockPluginTree() {
  const root = {
    started: false,
    addCommand: vi.fn(() => vi.fn()),
    registerInteractiveHandler: vi.fn(),
    addMiddleware: vi.fn(() => vi.fn()),
    defineModel: vi.fn(),
    useContext: vi.fn(),
    contexts: new Map<string, unknown>(),
    $contexts: new Map<string, { name: string; value: unknown; mounted?: (p: unknown) => void; extensions?: Record<string, unknown> }>(),
    contextIsReady(name: string) {
      try {
        return !!this.inject(name);
      } catch {
        return false;
      }
    },
    inject(name: string) {
      const ctx = this.$contexts.get(name);
      if (!ctx?.value) throw new Error(`Context "${name}" not found`);
      return ctx.value;
    },
    provide(target: GameHubFeature) {
      const ctx = {
        name: target.name,
        value: target,
        mounted: (p: unknown) => {
          target.mounted?.(p as never);
          return target;
        },
        extensions: target.extensions,
      };
      this.$contexts.set(target.name, ctx);
      return this;
    },
    get root() {
      return this;
    },
  };

  const child = {
    name: 'test-game-plugin',
    root,
    recordFeatureContribution: vi.fn(),
    onDispose: vi.fn((fn: () => void) => fn),
    registerGame: undefined as unknown,
  };

  return { root, child: child as never };
}

describe('GameHubFeature service', () => {
  beforeEach(() => {
    resetGameHubMountForTests();
  });

  it('ensureGameHubService provides game context on root', () => {
    const { root, child } = mockPluginTree();
    const feature = ensureGameHubService(child);
    expect(feature).toBeInstanceOf(GameHubFeature);
    expect(root.contextIsReady('game')).toBe(true);
  });

  it('register tracks games with dispose', () => {
    const { root, child } = mockPluginTree();
    ensureGameHubService(child);
    const feature = root.inject('game') as GameHubFeature;

    const dispose = feature.register({
      id: 'demo',
      title: '演示',
      icon: '🎮',
      description: 'd',
      commandPrefix: '演示',
      menus: [],
      runAction: async () => undefined,
    }, 'test-plugin');

    expect(getRegisteredGames()).toHaveLength(1);
    expect(getRegisteredGames()[0]?.id).toBe('demo');
    dispose();
    expect(getRegisteredGames()).toHaveLength(0);
  });

  it('mounted hooks hub UI commands', () => {
    const { root, child } = mockPluginTree();
    ensureGameHubService(child);
    root.started = true;
    const feature = root.inject('game') as GameHubFeature;
    feature.mounted(root);

    expect(isGameHubMounted()).toBe(true);
    expect(root.addCommand).toHaveBeenCalled();
    expect((root.addCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(root.registerInteractiveHandler).toHaveBeenCalledTimes(1);
    expect(root.addMiddleware).toHaveBeenCalled();
  });

  it('ensureGameHubService is idempotent', () => {
    const { child } = mockPluginTree();
    const a = ensureGameHubService(child);
    const b = ensureGameHubService(child);
    expect(a).toBe(b);
  });
});
