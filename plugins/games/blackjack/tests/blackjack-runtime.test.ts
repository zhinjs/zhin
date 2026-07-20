import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/bj/[action:string=].ts';
import { BJ_HELP } from '../src/index.js';
import { mountBjMemoryServices } from '../src/memory-db.js';
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

describe('@zhin.js/plugin-blackjack runtime (slice-2)', () => {
  beforeEach(() => {
    setGameServices(null);
    mountBjMemoryServices();
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

  it('start action works with in-memory db (text-only)', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(String(result)).not.toContain('尚未就绪');
    expect(String(result).length).toBeGreaterThan(0);
  });
});
