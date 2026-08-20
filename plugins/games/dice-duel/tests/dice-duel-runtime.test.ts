import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/dice/[[action]].ts';
import { DICE_HELP } from '../src/index.js';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
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

describe('@zhin.js/plugin-dice-duel runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['dice_sessions'], createServices);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('dice-duel');
  });

  it('brands dice command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(DICE_HELP);
  });

  it('start action works with in-memory db (text-only)', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    const text = plainTextFromSendContent(result as GameReply);
    expect(text).not.toContain('尚未就绪');
    expect(text).toContain('骰子');
    expect((result as unknown[])[1]).toMatchObject({ type: 'keyboard' });
  });
});
