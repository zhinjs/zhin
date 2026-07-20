import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { DisposeStack, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  getRuntimeGame,
  resetRuntimeGamesForTests,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import gameCommand from '../commands/guess/[action:string=].ts';
import { GUESS_HELP } from '../src/index.js';
import { mountGuessMemoryServices } from '../src/memory-db.js';
import { setGameServices } from '../src/runtime-store.js';

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => {
    throw new Error('unused');
  },
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

function mockSetupContext(options?: { schedule?: boolean }) {
  const lifecycle = new DisposeStack();
  const register = vi.fn(() => vi.fn());
  const resources = {
    has: (token: unknown) => options?.schedule === true && token === scheduleHostToken,
    use: (token: unknown) => {
      if (options?.schedule === true && token === scheduleHostToken) {
        return { register };
      }
      throw new Error('missing resource');
    },
  };
  return { lifecycle, register, resources };
}

describe('@zhin.js/plugin-guess-number runtime (slice-2)', () => {
  beforeEach(() => {
    resetRuntimeGamesForTests();
    setGameServices(null);
    mountGuessMemoryServices();
  });

  afterEach(() => {
    resetRuntimeGamesForTests();
    setGameServices(null);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('guess-number');
  });

  it('brands guess command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(GUESS_HELP);
  });

  it('start action works with in-memory db', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(String(result)).not.toContain('尚未就绪');
    expect(String(result)).toContain('猜数字');
  });

  it('setup registers hub metadata and stale-session cron when schedule host exists', async () => {
    const { lifecycle, register, resources } = mockSetupContext({ schedule: true });
    void plugin.setup?.({
      plugin: {
        id: 'guess-number',
        instanceKey: 'guess-number',
        root: 'guess-number',
        role: 'root',
      },
      config: { get: () => ({}) },
      resources: resources as never,
      lifecycle,
      handoff: {} as never,
    });

    expect(getRuntimeGame('guess')?.title).toBe('猜数字');
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'guess/abort-stale',
        cron: '0 */10 * * * *',
      }),
    );

    await lifecycle.dispose();
    expect(getRuntimeGame('guess')).toBeUndefined();
  });
});
