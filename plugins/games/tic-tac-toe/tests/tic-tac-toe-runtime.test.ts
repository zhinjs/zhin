import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { DisposeStack, outboundHostToken } from '@zhin.js/plugin-runtime';
import plugin from '../plugin.ts';
import gameCommand from '../commands/ttt/[action:string=].ts';
import { TTT_HELP } from '../src/index.js';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import { gameServicesToken } from '../src/runtime-store.js';
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

describe('@zhin.js/plugin-tic-tac-toe runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['ttt_sessions', 'ttt_queue', 'ttt_moves', 'ttt_spectators'], createServices);
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

  it('bot action returns an interactive board', async () => {
    const result = await gameCommand.execute({
      ...emptyCtx,
      params: { action: 'bot' },
    });
    expect(plainTextFromSendContent(result as GameReply)).toMatch(/开局|先手|井字/);
    expect((result as unknown[]).some((part) =>
      (part as { type?: string }).type === 'keyboard')).toBe(true);
  });

  it('pushes turn updates to subscribed spectators', async () => {
    const lifecycle = new DisposeStack();
    const send = vi.fn().mockResolvedValue('message-1');
    let runtimeServices: ReturnType<typeof createServices> | undefined;
    const resources = {
      provide(token: unknown, value: unknown) {
        if (token === gameServicesToken) {
          runtimeServices = value as ReturnType<typeof createServices>;
        }
      },
      has: (token: unknown) => token === outboundHostToken,
      use: (token: unknown) => {
        if (token === outboundHostToken) return { send };
        throw new Error('missing resource');
      },
    };
    await plugin.setup?.({
      plugin: {
        id: 'tic-tac-toe',
        instanceKey: 'tic-tac-toe',
        root: 'tic-tac-toe',
        role: 'root',
      },
      config: { get: () => ({}) },
      resources: resources as never,
      lifecycle,
      handoff: {} as never,
    });
    const message = {
      $adapter: 'sandbox',
      $endpoint: 'default',
      $channel: { type: 'group', id: 'room' },
      $sender: { id: 'alice', name: 'Alice' },
    };
    const session = await runtimeServices!.session.createSession({
      message,
      playerX: 'alice',
      playerO: 'bob',
      playerXName: 'Alice',
      playerOName: 'Bob',
      boardJson: JSON.stringify(Array.from({ length: 9 }, () => 0)),
    });
    await runtimeServices!.session.addSpectator(session.id, 'watcher');

    await runtimeServices!.session.updateSession(session.id, {
      turn: 2,
      move_count: 1,
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'sandbox',
      endpointId: 'default',
      conversation: { kind: 'private', id: 'watcher' },
    }));
    await lifecycle.dispose();
  });
});
