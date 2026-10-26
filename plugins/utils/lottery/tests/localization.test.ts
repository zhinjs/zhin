import { describe, expect, it, vi } from 'vitest';
import { outboundHostToken, scheduleHostToken } from 'zhin.js';
import { projectLocaleToken, type Locale } from 'zhin.js/i18n';
import plugin from '../plugin.js';
import today from '../commands/lottery-today/index.js';
import history from '../commands/lottery-history/[game]/index.js';
import stats from '../commands/lottery-stats/[game]/index.js';
import computeTool from '../skills/lottery/tools/compute-recommend/index.js';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import { resolveLotteryConfig } from '../src/config.js';
import { upsertDraws } from '../src/db.js';
import { formatPickLine, formatPickStats, recommendGame } from '../src/recommend/game-pick.js';
import { buildDailyReport, formatDailyReportText, loadTodayReport, saveDailyReport } from '../src/recommend/report.js';
import { lotteryRuntimeToken, type LotteryRuntime } from '../src/runtime-state.js';
import type { GameId, NormalizedDraw } from '../src/types.js';

const draw: NormalizedDraw = {
  gameId: 'ssq', issue: '001', drawTime: '2026-01-01',
  numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] }, source: 'fucai',
};
function makeRuntime(): LotteryRuntime {
  return { db: createInMemoryLotteryDb(), config: resolveLotteryConfig({}), enabledGames: ['ssq'], outbound: null };
}
function commandContext(runtime: LotteryRuntime, locale: Locale, formatCommand = (_path: string): string | undefined => undefined) {
  return { owner: {} as never, generation: 0, locale, config: {}, params: {}, args: [], input: undefined,
    use: (() => runtime) as never, formatCommand };
}

describe('lottery localization', () => {
  it.each<GameId>(['kl8', 'ssq', 'dlt', 'fc3d', 'pl3', 'pl5'])('changes only presentation for %s', (gameId) => {
    const options = { pickCount: 5, tieSeed: 'same-seed' };
    const zh = recommendGame(gameId, [], { ...options, locale: 'zh-CN' });
    const en = recommendGame(gameId, [], { ...options, locale: 'en' });
    expect(en.numbers).toEqual(zh.numbers);
    expect(en.weights).toEqual(zh.weights);
    expect(en.stats.hot).toEqual(zh.stats.hot);
    expect(en.stats.cold).toEqual(zh.stats.cold);
    expect(en.stats.pro?.sum).toBe(zh.stats.pro?.sum);
    expect(en.kl8Groups?.map(({ numbers, weights }) => ({ numbers, weights })))
      .toEqual(zh.kl8Groups?.map(({ numbers, weights }) => ({ numbers, weights })));
    expect(formatPickLine(en) + formatPickStats(en)).not.toMatch(/\p{Script=Han}/u);
  });

  it('persists the creation language and leaves previously authored text unchanged', async () => {
    const runtime = makeRuntime();
    await upsertDraws(runtime.db, [draw]);
    const report = await buildDailyReport(runtime.db, ['ssq'], { pickCount: 5, historyLimit: 10, locale: 'en' });
    await saveDailyReport(runtime.db, report, '');
    const loaded = await loadTodayReport(runtime.db);
    expect(loaded?.locale).toBe('en');
    expect(loaded?.picks[0]?.locale).toBe('en');
    const rendered = String(await today.execute(commandContext(runtime, 'zh-CN')));
    expect(rendered).toContain('[Daily lottery report]');
    expect(rendered).toContain('not betting advice or a guarantee of winning');
    expect(rendered).not.toMatch(/\p{Script=Han}/u);
    expect(formatDailyReportText({ ...report, body: '原作者保留的正文，not translated.' })).toBe('原作者保留的正文，not translated.');
  });

  it('uses the current command/tool locale and the actual configured invocation head', async () => {
    const runtime = makeRuntime();
    const formatter = vi.fn((path: string) => path === 'lottery' ? '!bot lucky lottery' : undefined);
    expect(await today.execute(commandContext(runtime, 'en', formatter))).toContain('Run !bot lucky lottery');
    expect(formatter).toHaveBeenCalledWith('lottery');
    expect(await today.execute(commandContext(runtime, 'en'))).toBe('No report for today yet. Wait for the scheduled run.');
    expect(await history.execute({ ...commandContext(runtime, 'en'), params: { game: 'invalid' } })).toBe('Specify a lottery game.');
    expect(await computeTool.execute({ game: 'invalid' }, { locale: 'en', use: () => runtime } as never)).toBe('Invalid lottery game.');
    await upsertDraws(runtime.db, [draw]);
    const result = await stats.execute({ ...commandContext(runtime, 'en'), params: { game: 'ssq' } });
    expect(result).toContain('Sample: 1 draws');
    expect(result).not.toMatch(/\p{Script=Han}/u);
  });

  it('captures the project language for the scheduled pipeline and keeps the unified outbound host', async () => {
    let projectLocale: Locale = 'en';
    let runtime: LotteryRuntime | undefined;
    let tick: (() => Promise<void>) | undefined;
    const send = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const schedule = { register: vi.fn((task: { execute: () => Promise<void> }) => { tick = task.execute; return dispose; }) };
    const lifecycle = { add: vi.fn() };
    await (plugin.setup as (context: unknown) => Promise<void>)({
      config: { get: () => ({ games: ['ssq'], scheduleEnabled: true, backtestEnabled: false, weightPersistEnabled: false,
        pushTargets: [{ adapter: 'sandbox', endpointKey: 'bot', channelType: 'private', channelId: 'user' }] }) },
      resources: {
        has: (token: unknown) => token === scheduleHostToken || token === outboundHostToken,
        use: (token: unknown) => token === projectLocaleToken ? projectLocale : token === scheduleHostToken ? schedule : { send },
        provide: (token: unknown, value: LotteryRuntime) => { expect(token).toBe(lotteryRuntimeToken); runtime = value; },
      }, lifecycle,
    });
    expect(runtime?.locale).toBe('en');
    await upsertDraws(runtime!.db, [draw]);
    projectLocale = 'zh-CN';
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fixture'));
    try { await tick!(); } finally { fetch.mockRestore(); }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ adapter: 'sandbox', endpointKey: 'bot', conversation: { kind: 'private', id: 'user' }, content: expect.stringContaining('[Daily lottery report]') });
    expect(lifecycle.add).toHaveBeenCalledWith(dispose);
  });
});
