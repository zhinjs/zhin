import { invokeGameCommand } from '../../../../packages/game-kit/tests/command-operation-fixture.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/riddle/[[action]]/index.ts';
import { RIDDLE_HELP } from '../src/index.js';
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
  input: { conversation: { endpoint: { adapter: 'synthetic', id: 'test-account' }, kind: 'private', id: 'alice' }, sender: { id: 'alice', name: 'Alice' }, content: '' } as never,
};

describe('@zhin.js/plugin-word-riddle runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['word_riddle_sessions'], createServices);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('word-riddle');
  });

  it('brands riddle command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await invokeGameCommand(gameCommand, {
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(RIDDLE_HELP);
  });

  it('start action returns riddle controls', async () => {
    const result = await invokeGameCommand(gameCommand, {
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(plainTextFromSendContent(result as GameReply).length).toBeGreaterThan(0);
    expect((result as unknown[]).some((part) =>
      (part as { type?: string }).type === 'keyboard')).toBe(true);
  });
});
