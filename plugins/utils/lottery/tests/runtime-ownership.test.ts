import { describe, expect, it } from 'vitest';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import { getLotteryDb, registerLotteryDb } from '../src/db-store.js';
import {
  getLotteryAgentDeps,
  registerLotteryAgentDeps,
  type LotteryAgentDeps,
} from '../src/lottery-agent-deps.js';
import {
  getLotteryOutboundPush,
  registerLotteryOutboundPush,
} from '../src/push.js';
import { resolveLotteryRuntime } from '../src/runtime-state.js';

function deps(id: string): LotteryAgentDeps {
  const db = createInMemoryLotteryDb();
  return {
    getDb: () => db,
    getConfig: () => ({ pickCount: 1, historyLimit: 10, kl8: {} }),
    enabledGames: () => [],
    scheduleCron: () => id,
    scheduleEnabled: () => true,
    pipelinePush: false,
  };
}

describe('lottery generation-owned registrations', () => {
  it('resolves the database from the capability owner resource', () => {
    const db = createInMemoryLotteryDb();
    const runtime = { db };

    expect(resolveLotteryRuntime({
      owner: { id: 'root/lottery' },
      use: () => runtime,
    })).toBe(runtime);
  });

  it('keeps the newest database and deps when an older generation disposes', () => {
    const previousDb = createInMemoryLotteryDb();
    const nextDb = createInMemoryLotteryDb();
    const previousDeps = deps('previous');
    const nextDeps = deps('next');
    const disposePreviousDb = registerLotteryDb(previousDb);
    const disposeNextDb = registerLotteryDb(nextDb);
    const disposePreviousDeps = registerLotteryAgentDeps(previousDeps);
    const disposeNextDeps = registerLotteryAgentDeps(nextDeps);

    disposePreviousDb();
    disposePreviousDeps();
    expect(getLotteryDb()).toBe(nextDb);
    expect(getLotteryAgentDeps()).toBe(nextDeps);

    disposeNextDb();
    disposeNextDeps();
  });

  it('lets a disabled generation shadow an older outbound sender', () => {
    const previous = async () => undefined;
    const disposePrevious = registerLotteryOutboundPush(previous);
    const disposeDisabled = registerLotteryOutboundPush(null);

    expect(getLotteryOutboundPush()).toBeNull();
    disposeDisabled();
    expect(getLotteryOutboundPush()).toBe(previous);
    disposePrevious();
  });
});
