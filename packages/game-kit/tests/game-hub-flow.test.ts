import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Plugin } from 'zhin.js';
import { handleHubChoice } from '../src/game-hub-flow.js';
import {
  createHubScope,
  getLastHubMenu,
  rememberHubMenu,
  resetHubMenuContextForTests,
} from '../src/game-hub-menu-context.js';
import { ensureGameHubService } from '../src/game-hub-feature.js';
import { resetGameHubMountForTests } from '../src/game-hub-mount.js';

function mockPluginTree() {
  const root = {
    started: false,
    addCommand: vi.fn(() => vi.fn()),
    registerInteractiveHandler: vi.fn(),
    addMiddleware: vi.fn(() => vi.fn()),
    $contexts: new Map<string, { name: string; value: unknown }>(),
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
    provide(target: { name: string; mounted?: (p: unknown) => void; extensions?: Record<string, unknown> }) {
      this.$contexts.set(target.name, { name: target.name, value: target });
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
  };

  return { root, child: child as never };
}

function mockMessage(userId: string, channelId = 'c1'): Message<any> {
  return {
    $adapter: 'sandbox',
    $endpoint: 'default',
    $channel: { type: 'group', id: channelId },
    $sender: { id: userId, name: userId },
    $reply: vi.fn(),
  } as unknown as Message<any>;
}

describe('game-hub-flow access', () => {
  beforeEach(() => {
    resetHubMenuContextForTests();
    resetGameHubMountForTests();
  });

  it('allows another user to navigate hub before game starts', async () => {
    const { child } = mockPluginTree();
    const feature = ensureGameHubService(child);
    feature.register({
      id: 'demo',
      title: '演示',
      icon: '🎮',
      description: 'd',
      commandPrefix: '演示',
      menus: [{ id: 'start', label: '开始', style: 'primary' }],
      runAction: vi.fn(),
    }, 'demo-plugin');

    const opener = mockMessage('alice');
    const scopeId = createHubScope(opener);
    const clicker = mockMessage('bob');
    const plugin = {} as Plugin;

    const ok = await handleHubChoice(plugin, clicker, scopeId, 'g_demo');

    expect(ok).toBe(true);
    expect(clicker.$reply).toHaveBeenCalled();
  });

  it('shares last hub menu across users in the same channel', () => {
    const opener = mockMessage('alice', 'room-1');
    const peer = mockMessage('bob', 'room-1');
    const scopeId = createHubScope(opener);
    rememberHubMenu(opener, scopeId, [{ id: 'g_demo', label: '演示' }]);

    expect(getLastHubMenu(peer)?.scopeId).toBe(scopeId);
    expect(getLastHubMenu(mockMessage('carol', 'room-2'))).toBeNull();
  });

  it('runAction uses clicker message not opener', async () => {
    const runAction = vi.fn(async () => undefined);
    const { child } = mockPluginTree();
    const feature = ensureGameHubService(child);
    feature.register({
      id: 'demo2',
      title: '演示2',
      icon: '🎮',
      description: 'd',
      commandPrefix: '演示2',
      menus: [{ id: 'start', label: '开始', style: 'primary' }],
      runAction,
    }, 'demo-plugin');

    const opener = mockMessage('alice');
    const scopeId = createHubScope(opener);
    const clicker = mockMessage('bob');
    const plugin = {} as Plugin;

    await handleHubChoice(plugin, clicker, scopeId, 'a_demo2_start');

    expect(runAction).toHaveBeenCalledWith('start', {
      plugin,
      message: clicker,
    });
  });
});
