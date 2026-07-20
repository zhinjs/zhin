import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/chain/[action:string=].ts';
import { CHAIN_HELP } from '../src/index.js';
import { mountChainMemoryServices } from '../src/memory-db.js';
let services: ReturnType<typeof mountChainMemoryServices>;

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => services,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

describe('@zhin.js/plugin-idiom-chain runtime (slice-2)', () => {
  beforeEach(() => {
    services = mountChainMemoryServices();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('idiom-chain');
  });

  it('brands chain command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(CHAIN_HELP);
  });

  it('start action works with in-memory db (text-only)', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(String(result)).not.toContain('尚未就绪');
    expect(String(result)).toMatch(/接龙|成语|开局/);
  });
});
