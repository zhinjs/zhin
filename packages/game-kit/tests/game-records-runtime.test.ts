import { channelKey } from '../src/board-sender.js';
import { describe, expect, it, vi } from 'vitest';
import { GameRecordStore, type GameRecordDatabase } from '../src/game-records.js';

function createDatabase() {
  const create = vi.fn(async () => undefined);
  const findAll = vi.fn(async () => [] as Record<string, unknown>[]);
  const database = {
    models: { get: () => ({ create, findAll }) },
  } as unknown as GameRecordDatabase;
  return { database, create, findAll };
}

const message = { target: { endpoint: { adapter: 'process', id: 'terminal' }, kind: 'private', id: 'u1' },
sender: { id: 'u1', name: 'User' } } as never;

describe('GameRecordStore ownership', () => {
  it('writes only through its explicitly owned database', async () => {
    const first = createDatabase();
    const second = createDatabase();
    await new GameRecordStore(first.database).record({ scope: channelKey(message), player: message.sender, gameId: 'guess', result: 'won' });
    expect(first.create).toHaveBeenCalledOnce();
    expect(second.create).not.toHaveBeenCalled();
  });

  it('does not share state between store instances', async () => {
    const first = createDatabase();
    const second = createDatabase();
    first.findAll.mockResolvedValue([{ game_id: 'guess', result: 'won', score: 2 }]);
    expect(await new GameRecordStore(first.database).getUserStats('u1')).toMatchObject([
      { gameId: 'guess', wins: 1, totalScore: 2 },
    ]);
    expect(await new GameRecordStore(second.database).getUserStats('u1')).toEqual([]);
  });
});
