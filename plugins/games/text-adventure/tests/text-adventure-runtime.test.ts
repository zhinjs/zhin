import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/adv/[action:string=].ts';
import { ADV_HELP } from '../src/index.js';
import { mountAdvMemoryServices } from '../src/memory-db.js';
let services: ReturnType<typeof mountAdvMemoryServices>;

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
    services = mountAdvMemoryServices();
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

  it('start action works with in-memory db (text-only)', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(String(result)).not.toContain('尚未就绪');
    expect(String(result).length).toBeGreaterThan(0);
  });
});
