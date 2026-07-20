import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/ttt/[action:string=].ts';
import { TTT_HELP } from '../src/index.js';
import { mountTttMemoryServices } from '../src/memory-db.js';
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

describe('@zhin.js/plugin-tic-tac-toe runtime (slice-2)', () => {
  beforeEach(() => {
    setGameServices(null);
    mountTttMemoryServices();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('tic-tac-toe');
  });

  it('brands ttt command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(TTT_HELP);
  });

  it('bot action works with in-memory db (text-only)', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'bot' },
    });
    expect(String(result)).not.toContain('尚未就绪');
    expect(String(result)).toMatch(/开局|先手|井字/);
  });
});
