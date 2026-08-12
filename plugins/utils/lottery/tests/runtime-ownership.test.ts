import { describe, expect, it } from 'vitest';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import { resolveLotteryConfig } from '../src/config.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

describe('lottery generation-owned registrations', () => {
  it('keeps database and outbound resources inside each owner runtime', () => {
    const first = Object.freeze({
      db: createInMemoryLotteryDb(),
      config: resolveLotteryConfig({}),
      enabledGames: Object.freeze([]),
      outbound: async () => undefined,
    });
    const second = Object.freeze({
      db: createInMemoryLotteryDb(),
      config: resolveLotteryConfig({}),
      enabledGames: Object.freeze([]),
      outbound: null,
    });
    const useFirst = (token: typeof lotteryRuntimeToken) => token === lotteryRuntimeToken ? first : neverToken();
    const useSecond = (token: typeof lotteryRuntimeToken) => token === lotteryRuntimeToken ? second : neverToken();

    expect(useFirst(lotteryRuntimeToken)).toBe(first);
    expect(useSecond(lotteryRuntimeToken)).toBe(second);
    expect(first.db).not.toBe(second.db);
    expect(first.outbound).not.toBe(second.outbound);
  });
});

function neverToken(): never {
  throw new Error('unexpected token');
}
