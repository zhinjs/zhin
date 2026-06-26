import { describe, it, expect, beforeEach } from 'vitest';
import { startGame, processGuess } from '../src/game-flow.js';
import { createServices, type GuessDatabase, type SessionService } from '../src/session-service.js';

type Row = Record<string, unknown>;

function createMockDb(): GuessDatabase {
  const tables = new Map<string, Row[]>();

  function model(name: string) {
    if (!tables.has(name)) tables.set(name, []);
    const rows = () => tables.get(name)!;
    const match = (row: Row, q: Record<string, unknown>) =>
      Object.entries(q).every(([k, v]) => row[k] === v);

    return {
      findAll: async (q: Record<string, unknown> = {}) =>
        rows().filter((row) => match(row, q)),
      findOne: async (q: Record<string, unknown> = {}) =>
        rows().find((row) => match(row, q)) ?? null,
      create: async (row: Row) => {
        rows().push({ ...row });
        return row;
      },
      updateWhere: async (where: Record<string, unknown>, patch: Row) => {
        for (const row of rows()) {
          if (match(row, where)) Object.assign(row, patch);
        }
        return 1;
      },
    };
  }

  return {
    models: { get: (name: string) => model(name) },
  } as unknown as GuessDatabase;
}

function mockMessage(userId: string, channelId = 'g1') {
  return {
    $adapter: 'sandbox',
    $endpoint: 'default',
    $channel: { type: 'group', id: channelId },
    $sender: { id: userId, name: userId },
  } as never;
}

describe('guess-number sessions', () => {
  let services: SessionService;

  beforeEach(() => {
    services = createServices(createMockDb());
  });

  it('allows two users in same channel to start separate games', async () => {
    const startA = await startGame(services, mockMessage('alice'));
    const startB = await startGame(services, mockMessage('bob'));

    expect(startA).toContain('猜数字');
    expect(startB).toContain('猜数字');
    expect(startB).not.toContain('本频道');

    const ch = 'sandbox-default-group:g1';
    expect(await services.getActiveForUser(ch, 'alice')).toBeTruthy();
    expect(await services.getActiveForUser(ch, 'bob')).toBeTruthy();
  });

  it('processGuess works for own session', async () => {
    await startGame(services, mockMessage('alice'));
    const reply = await processGuess(services, mockMessage('alice'), 50);
    expect(reply).toMatch(/大|小|机会/);
  });
});
