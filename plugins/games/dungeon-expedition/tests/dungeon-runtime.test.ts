import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import dungeonCommand from '../commands/dungeon/[action:string=].ts';
import {
  createServices,
  type SessionService,
} from '../src/session-service.js';

let service: SessionService;

const context = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => service,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

describe('@zhin.js/plugin-dungeon-expedition runtime', () => {
  beforeEach(() => {
    service = createMemoryGameServices(
      ['dungeon_sessions'],
      createServices,
    );
  });

  it('defines a discoverable plugin and command', () => {
    expect(plugin.name).toBe('dungeon-expedition');
    expect(parseCommandDefinition(dungeonCommand)).toBe(dungeonCommand);
  });

  it('creates a structured expedition from the command', async () => {
    const reply = await dungeonCommand.execute({
      ...context,
      params: { action: '开始' },
    });
    const text = plainTextFromSendContent(reply as GameReply);

    expect(text).toContain('地牢远征');
    expect(text).toContain('等待队员');
    expect((reply as unknown[])[1]).toMatchObject({ type: 'keyboard' });
  });
});
