import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/bj/[[action]].ts';
import { BJ_HELP } from '../src/index.js';
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

describe('@zhin.js/plugin-blackjack runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['bj_sessions'], createServices);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('blackjack');
  });

  it('brands bj command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(BJ_HELP);
  });

  it('start action returns a playable keyboard', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(plainTextFromSendContent(result as GameReply)).toContain('21 点');
    expect((result as unknown[]).some((part) =>
      (part as { type?: string }).type === 'keyboard')).toBe(true);
  });
});
