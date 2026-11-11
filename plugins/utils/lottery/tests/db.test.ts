import { describe, it, expect, vi } from 'vitest';
import { DRAWS_TABLE, loadDraws, parseStoredJson, syncGame, upsertDraws } from '../src/db.js';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import type { NormalizedDraw } from '../src/types.js';

/** Newest first, like the official APIs: issue numbers count down from `newest`. */
function officialDraws(newest: number, count: number): NormalizedDraw[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: 'ssq' as const,
    issue: String(newest - index).padStart(7, '0'),
    drawTime: '2026-01-01',
    numbers: { main: [1, 2, 3, 4, 5, 6], bonus: [7] },
    source: 'fucai' as const,
  }));
}

describe('parseStoredJson', () => {
  it('parses JSON string', () => {
    expect(parseStoredJson('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns object as-is', () => {
    const obj = { main: [1, 2] };
    expect(parseStoredJson(obj, {})).toBe(obj);
  });

  it('returns fallback for invalid input', () => {
    expect(parseStoredJson('[object Object]', { ok: false })).toEqual({ ok: false });
  });
});

describe('syncGame', () => {
  it('fetches historyLimit draws and reports only genuinely new rows', async () => {
    const db = createInMemoryLotteryDb();
    const model = db.models.get(DRAWS_TABLE)!;
    const insert = vi.spyOn(model, 'insert');
    const remove = vi.spyOn(model, 'delete');
    let newest = 2026060;
    const fetchDraws = vi.fn(async (_game: string, count: number) => officialDraws(newest, count));

    // First sync fills the table with exactly historyLimit rows.
    const first = await syncGame(db, 'ssq', 50, fetchDraws);
    expect(fetchDraws).toHaveBeenLastCalledWith('ssq', 50);
    expect(first.count).toBe(50);
    expect(insert).toHaveBeenCalledTimes(50);
    expect(remove).not.toHaveBeenCalled();

    // Nothing new upstream: no writes and nothing reported, however often it runs.
    for (let run = 0; run < 3; run += 1) {
      expect(await syncGame(db, 'ssq', 50, fetchDraws)).toEqual({ count: 0, inserted: [] });
    }
    expect(insert).toHaveBeenCalledTimes(50);
    expect(remove).not.toHaveBeenCalled();

    // Two new issues: exactly two inserts, the two oldest trimmed, both reported.
    newest += 2;
    const third = await syncGame(db, 'ssq', 50, fetchDraws);
    expect(third.inserted.map(draw => draw.issue)).toEqual(['2026062', '2026061']);
    expect(insert).toHaveBeenCalledTimes(52);
    expect(remove).toHaveBeenCalledTimes(2);
    const stored = await loadDraws(db, 'ssq', 1000);
    expect(stored).toHaveLength(50);
    expect(stored[0]!.issue).toBe('2026062');
    expect(stored.at(-1)!.issue).toBe('2026013');
  });

  it('never inserts a draw that the limit would trim again', async () => {
    const db = createInMemoryLotteryDb();
    const model = db.models.get(DRAWS_TABLE)!;
    // Upstream returns more than asked for: the surplus older issues must not be written or reported.
    const fetchDraws = async () => officialDraws(2026100, 100);
    const insert = vi.spyOn(model, 'insert');
    const result = await syncGame(db, 'ssq', 50, fetchDraws);
    expect(result.count).toBe(50);
    expect(insert).toHaveBeenCalledTimes(50);
    expect((await syncGame(db, 'ssq', 50, fetchDraws)).count).toBe(0);
    expect(insert).toHaveBeenCalledTimes(50);
  });
});

describe('upsertDraws', () => {
  it('reads the stored issues once per game instead of once per draw', async () => {
    const db = createInMemoryLotteryDb();
    const model = db.models.get(DRAWS_TABLE)!;
    const select = vi.spyOn(model, 'select');
    const draws = officialDraws(2026030, 30);
    expect((await upsertDraws(db, [...draws, draws[0]!])).count).toBe(30);
    expect(select).toHaveBeenCalledTimes(1);
    expect((await upsertDraws(db, draws)).count).toBe(0);
  });
});
