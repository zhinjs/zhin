import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { DisposeStack, scheduleHostToken } from 'zhin.js';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import gameCommand from '../commands/guess/[[action]]/index.ts';
import { GUESS_HELP } from '../src/index.js';
import { createServices } from '../src/session-service.js';
let services: ReturnType<typeof createServices>;

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => services,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

function mockSetupContext(options?: { schedule?: boolean }) {
  const lifecycle = new DisposeStack();
  const register = vi.fn(() => vi.fn());
  const resources = {
    provide: vi.fn(),
    has: (token: unknown) => options?.schedule === true && token === scheduleHostToken,
    use: (token: unknown) => {
      if (options?.schedule === true && token === scheduleHostToken) {
        return { register };
      }
      throw new Error('missing resource');
    },
  };
  const addGame = vi.fn();
  return { lifecycle, register, resources, addGame };
}

describe('@zhin.js/plugin-guess-number runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['guess_sessions'], createServices);
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
    const text = plainTextFromSendContent(result as GameReply);
    expect(text).not.toContain('尚未就绪');
    expect(text).toContain('猜数字');
    expect((result as unknown[])[1]).toMatchObject({ type: 'keyboard' });
  });

  it('setup registers hub metadata and stale-session cron when schedule host exists', async () => {
    const { lifecycle, register, resources, addGame } = mockSetupContext({ schedule: true });
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
      addGame,
    });

    expect(addGame).toHaveBeenCalledWith(
      'guess',
      expect.objectContaining({ id: 'guess', title: '猜数字' }),
    );
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'guess/abort-stale',
        cron: '0 */10 * * * *',
      }),
    );

    await lifecycle.dispose();
  });
});
