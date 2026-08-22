import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import lotteryCommand from '../commands/lottery/[[game]].ts';
import todayCommand from '../commands/lottery-today.ts';
import historyCommand from '../commands/lottery-history/[game].ts';
import { resolveLotteryConfig, lotteryEnabledGames } from '../src/config.js';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

const config = resolveLotteryConfig({});
const runtime = Object.freeze({
  db: createInMemoryLotteryDb(),
  config,
  enabledGames: Object.freeze(lotteryEnabledGames(config)),
  outbound: null,
});

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: (token: typeof lotteryRuntimeToken) => token === lotteryRuntimeToken ? runtime : neverToken(),
  args: [],
  params: {},
  input: undefined,
};

describe('@zhin.js/plugin-lottery runtime', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('lottery');
  });

  it('brands main lottery commands', () => {
    expect(parseCommandDefinition(lotteryCommand)).toBe(lotteryCommand);
    expect(parseCommandDefinition(todayCommand)).toBe(todayCommand);
  });

  it('resolves default config', () => {
    const cfg = resolveLotteryConfig({});
    expect(cfg.pickCount).toBe(5);
    expect(cfg.games).toContain('kl8');
    expect(cfg.pushTargets).toEqual([]);
  });

  it('resolves pushTargets for OutboundHost', () => {
    const cfg = resolveLotteryConfig({
      pushTargets: [
        { adapter: 'sandbox', channelId: 'u1', endpointKey: 'bot', channelType: 'private' },
        { adapter: '', channelId: 'bad' } as never,
      ],
    });
    expect(cfg.pushTargets).toEqual([
      { adapter: 'sandbox', endpointKey: 'bot', channelType: 'private', channelId: 'u1' },
    ]);
  });

  it('lottery-today works without host database (empty report)', async () => {
    const result = await todayCommand.execute({ ...emptyCtx });
    expect(String(result)).toMatch(/今日尚无推荐|可执行 lottery/);
  });

  it('lottery-history works without host database (empty draws)', async () => {
    const result = await historyCommand.execute({
      ...emptyCtx,
      params: { game: 'ssq' },
      args: ['5'],
    });
    expect(String(result)).toBe('暂无数据');
  });

  it('lottery pipeline no longer reports db not ready', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline test'));
    try {
      const result = await lotteryCommand.execute({
        ...emptyCtx,
        params: { game: 'ssq' },
      });
      // Sync may err without network, but memory store means no「数据库未就绪」.
      expect(String(result)).not.toContain('数据库未就绪');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

function neverToken(): never {
  throw new Error('unexpected token');
}
