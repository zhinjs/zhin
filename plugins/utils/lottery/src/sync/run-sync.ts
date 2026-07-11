import type { GameId, NormalizedDraw } from '../types.js';
import { syncGame, type LotteryDb } from '../db.js';

export async function runDataSync(
  getDb: () => LotteryDb | null,
  enabledGames: () => GameId[],
  historyLimit: number,
  gameId?: GameId,
): Promise<{ text: string; newSummary: string; inserted: NormalizedDraw[] }> {
  const db = getDb();
  if (!db) return { text: 'db not ready', newSummary: '', inserted: [] };
  const ids = gameId ? [gameId] : enabledGames();
  const parts: string[] = [];
  const newParts: string[] = [];
  const inserted: NormalizedDraw[] = [];
  for (const id of ids) {
    try {
      const { count, inserted: ins } = await syncGame(db, id, historyLimit);
      parts.push(`${id}:+${count}`);
      inserted.push(...ins);
      if (ins.length) {
        newParts.push(`${id}:${ins.map((d) => d.issue).join(',')}`);
      }
    } catch {
      parts.push(`${id}:err`);
    }
  }
  return {
    text: `sync ${parts.join(', ')}`,
    newSummary: newParts.join('; '),
    inserted,
  };
}
