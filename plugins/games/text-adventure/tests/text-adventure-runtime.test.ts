import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/adv/[[action]].ts';
import { ADV_HELP } from '../src/index.js';
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

describe('@zhin.js/plugin-text-adventure runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['adv_sessions', 'adv_profiles'], createServices);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('text-adventure');
  });

  it('brands adv command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(ADV_HELP);
  });

  it('start action returns scene choices', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(plainTextFromSendContent(result as GameReply).length).toBeGreaterThan(0);
    expect((result as unknown[]).some((part) =>
      (part as { type?: string }).type === 'keyboard')).toBe(true);
  });
});
