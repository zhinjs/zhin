import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initGameRecordHost,
  recordGameOutcome,
  resetGameRecordsForTests,
  type GameRecordDatabaseHost,
} from '../src/game-records.js';

function createHost() {
  const insert = vi.fn(async () => undefined);
  const model = {
    select: () => ({ where: async () => [] }),
    insert,
    delete: () => ({ where: async () => undefined }),
    update: () => ({ where: async () => undefined }),
  };
  const define = vi.fn();
  const host: GameRecordDatabaseHost = {
    define,
    models: { get: () => model },
  };
  return { host, define, insert };
}

const message = {
  $adapter: 'process',
  $endpoint: 'terminal',
  $sender: { id: 'u1', name: 'User' },
  $channel: { type: 'private', id: 'u1' },
} as never;

describe('Plugin Runtime game record ownership', () => {
  beforeEach(() => resetGameRecordsForTests());

  it('defines each new Host and keeps the newest generation after old disposal', async () => {
    const previous = createHost();
    const next = createHost();
    const disposePrevious = initGameRecordHost(previous.host);
    const disposeNext = initGameRecordHost(next.host);

    disposePrevious();
    await recordGameOutcome(message, 'guess', 'won');

    expect(previous.define).toHaveBeenCalledOnce();
    expect(next.define).toHaveBeenCalledOnce();
    expect(previous.insert).not.toHaveBeenCalled();
    expect(next.insert).toHaveBeenCalledOnce();
    disposeNext();
  });

  it('defines a shared Host only once for multiple game plugins', () => {
    const shared = createHost();
    const disposeFirst = initGameRecordHost(shared.host);
    const disposeSecond = initGameRecordHost(shared.host);

    expect(shared.define).toHaveBeenCalledOnce();
    disposeFirst();
    disposeSecond();
  });
});
