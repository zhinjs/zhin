import { describe, it, expect } from 'vitest';
import {
  buildDailyReport,
  formatDailyReportText,
} from '../src/recommend/report.js';
import { DISCLAIMER, type NormalizedDraw } from '../src/types.js';
import type { LotteryDb } from '../src/db.js';

function makeDb(drawsByGame: Record<string, NormalizedDraw[]>): LotteryDb {
  return {
    models: {
      get: (name: string) => {
        if (name !== 'lottery_draws') return undefined;
        return {
          select: () => ({
            where: async (q: Record<string, unknown>) => {
              const gameId = String(q.game_id);
              return (drawsByGame[gameId] ?? []).map((d) => ({
                game_id: d.gameId,
                issue: d.issue,
                draw_time: d.drawTime,
                numbers: JSON.stringify(d.numbers),
                source: d.source,
              }));
            },
          }),
          insert: async () => ({}),
          delete: () => ({ where: async () => ({}) }),
        };
      },
    },
  };
}

const sampleDraws: NormalizedDraw[] = [
  {
    gameId: 'kl8',
    issue: '1',
    drawTime: '2024-01-01',
    numbers: { main: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
    source: 'fucai',
  },
];

describe('daily report', () => {
  it('builds multi-game report with disclaimer', async () => {
    const db = makeDb({ kl8: sampleDraws, ssq: [{
      gameId: 'ssq',
      issue: '1',
      drawTime: '',
      numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] },
      source: 'fucai',
    }] });
    const report = await buildDailyReport(db, ['kl8', 'ssq'], { pickCount: 5, historyLimit: 100 }, new Date('2026-07-11'));
    expect(report.picks.length).toBe(2);
    expect(report.disclaimer).toBe(DISCLAIMER);
    const text = formatDailyReportText(report);
    expect(text).toContain('【彩票每日推荐】2026-07-11');
    expect(text).toContain('快乐8');
    expect(text).toContain(DISCLAIMER);
  });

  it('uses the deterministic template', async () => {
    const report = await buildDailyReport(makeDb({ kl8: sampleDraws }), ['kl8'], { pickCount: 5, historyLimit: 100 });
    const text = formatDailyReportText(report);
    expect(text).toContain('【统计说明】');
  });

  it('uses AI explanation when provided', async () => {
    const report = await buildDailyReport(makeDb({ kl8: sampleDraws }), ['kl8'], { pickCount: 5, historyLimit: 100 });
    const text = formatDailyReportText(report, '今日热号偏多，仅供参考。');
    expect(text).toContain('今日热号偏多');
  });
});
