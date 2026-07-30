import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  createToken,
  outboundHostToken,
  scheduleHostToken,
} from '@zhin.js/plugin-runtime';
import {
  BaseSessionService,
  GameSessionConflictError,
  createInMemoryGameDb,
  defineGamePlugin,
  gameEvents,
  gameSessionCoordinator,
  type BaseGameSessionRow,
  type GameSessionDatabase,
} from '../src/index.js';

interface TestSessionRow extends BaseGameSessionRow {
  player_id: string;
  turn: string;
}

class TestSessionService extends BaseSessionService<TestSessionRow> {
  constructor(
    gameId: string,
    table: string,
    projectOutcomes?: (
      session: Readonly<TestSessionRow>,
    ) => readonly [{
      userId: string;
      result: 'won';
      score: number;
    }],
  ) {
    const database = createInMemoryGameDb([table]);
    super(database as unknown as GameSessionDatabase<TestSessionRow>, {
      gameId,
      table,
      userFields: ['player_id'],
      projectOutcomes,
    });
  }

  start(overrides: Partial<TestSessionRow> = {}): Promise<TestSessionRow> {
    const now = Date.now();
    return this.createRow({
      id: overrides.id ?? `${this.gameId}-${now}`,
      adapter: 'sandbox',
      endpoint: 'default',
      channel_type: 'group',
      channel_id: 'room',
      channel_key: 'sandbox-default-group:room',
      player_id: 'alice',
      status: 'active',
      turn: 'alice',
      updated_at: now,
      created_at: now,
      ...overrides,
    });
  }
}

describe('BaseSessionService', () => {
  beforeEach(() => {
    gameEvents.clear();
    gameSessionCoordinator.clear();
  });

  afterEach(() => {
    gameEvents.clear();
    gameSessionCoordinator.clear();
  });

  it('emits start, turn and end events around persisted transitions', async () => {
    const service = new TestSessionService(
      'alpha',
      'alpha_sessions',
      (session) => [{
        userId: session.player_id,
        result: 'won',
        score: 10,
      }],
    );
    const events: string[] = [];
    const outcomes: unknown[] = [];
    gameEvents.on('game:start', () => { events.push('start'); });
    gameEvents.on('turn:change', () => { events.push('turn'); });
    gameEvents.on('game:end', (event) => {
      events.push('end');
      outcomes.push(...event.outcomes);
    });

    const row = await service.start({ id: 's1' });
    await service.updateSession(row.id, { turn: 'bob' });
    await service.updateSession(row.id, { status: 'won' });

    expect(events).toEqual(['start', 'turn', 'end']);
    expect(outcomes).toEqual([{
      userId: 'alice',
      result: 'won',
      score: 10,
    }]);
    expect(await service.getById(row.id)).toMatchObject({
      turn: 'bob',
      status: 'won',
    });
  });

  it('rejects a different game for the same user and channel', async () => {
    const alpha = new TestSessionService('alpha', 'alpha_sessions');
    const beta = new TestSessionService('beta', 'beta_sessions');
    const disposeAlpha = alpha.registerCoordinator();
    const disposeBeta = beta.registerCoordinator();

    await alpha.start({ id: 'alpha-1' });

    await expect(beta.start({ id: 'beta-1' })).rejects.toEqual(
      expect.objectContaining<GameSessionConflictError>({
        name: 'GameSessionConflictError',
        activeGameId: 'alpha',
        requestedGameId: 'beta',
      }),
    );

    disposeBeta();
    disposeAlpha();
  });

  it('keeps cleaning stale rows when a timeout notifier fails', async () => {
    const service = new TestSessionService('alpha', 'alpha_sessions');
    const timeoutEvents = vi.fn();
    const notify = vi.fn()
      .mockRejectedValueOnce(new Error('adapter offline'))
      .mockResolvedValueOnce(undefined);
    gameEvents.on('session:timeout', timeoutEvents);
    const staleAt = Date.now() - 60_000;

    await service.start({ id: 's1', player_id: 'alice', updated_at: staleAt });
    await service.start({ id: 's2', player_id: 'bob', updated_at: staleAt });

    await expect(service.abortStale(1_000, notify)).resolves.toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(timeoutEvents).toHaveBeenCalledTimes(2);
    expect(await service.getById('s1')).toMatchObject({ status: 'aborted' });
    expect(await service.getById('s2')).toMatchObject({ status: 'aborted' });
  });

  it('uses the latest HMR registration and restores the previous generation', async () => {
    const coordinator = gameSessionCoordinator;
    const oldProvider = {
      gameId: 'alpha',
      getActiveForUser: vi.fn().mockResolvedValue({ id: 'old', channel_key: 'room' }),
    };
    const nextProvider = {
      gameId: 'alpha',
      getActiveForUser: vi.fn().mockResolvedValue(null),
    };
    const disposeOld = coordinator.register(oldProvider);
    const disposeNext = coordinator.register(nextProvider);

    await expect(
      coordinator.assertAvailable('beta', 'room', ['alice']),
    ).resolves.toBeUndefined();
    expect(nextProvider.getActiveForUser).toHaveBeenCalledOnce();
    expect(oldProvider.getActiveForUser).not.toHaveBeenCalled();

    disposeNext();
    await expect(
      coordinator.assertAvailable('beta', 'room', ['alice']),
    ).rejects.toBeInstanceOf(GameSessionConflictError);
    disposeOld();
  });

  it('routes stale-session notifications through the optional outbound host', async () => {
    const service = new TestSessionService('alpha', 'alpha_sessions');
    await service.start({ id: 'stale', updated_at: Date.now() - 60_000 });
    const servicesToken = createToken<TestSessionService>('test.game.services');
    const lifecycle = new DisposeStack();
    const send = vi.fn().mockResolvedValue('message-1');
    let scheduled: { execute(): Promise<void> } | undefined;
    const plugin = defineGamePlugin({
      name: 'alpha',
      game: {
        id: 'alpha',
        title: 'Alpha',
        icon: 'A',
        description: 'Alpha game',
        commandPrefix: '/alpha',
        quickStart: 'start',
      },
      tables: ['alpha_sessions'],
      servicesToken,
      defineHostTables: () => undefined,
      createServices: () => service,
      session: (services) => services,
      stale: { idleMs: 1, message: 'Alpha timed out' },
    });
    const resources = {
      provide: vi.fn(),
      has: (token: unknown) =>
        token === scheduleHostToken || token === outboundHostToken,
      use: (token: unknown) => {
        if (token === scheduleHostToken) {
          return {
            register(task: { execute(): Promise<void> }) {
              scheduled = task;
              return () => undefined;
            },
          };
        }
        if (token === outboundHostToken) return { send };
        throw new Error('missing resource');
      },
    };

    await plugin.setup?.({
      plugin: {
        id: 'alpha',
        instanceKey: 'alpha',
        root: 'alpha',
        role: 'root',
      },
      config: { get: () => ({}) },
      resources: resources as never,
      lifecycle,
      handoff: {} as never,
    });
    await scheduled?.execute();

    expect(send).toHaveBeenCalledWith({
      adapter: 'sandbox',
      endpointId: 'default',
      channelType: 'group',
      channelId: 'room',
      content: 'Alpha timed out',
    });
    await lifecycle.dispose();
  });
});
