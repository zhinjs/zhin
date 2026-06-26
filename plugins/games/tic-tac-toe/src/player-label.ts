import type { MessageSender } from 'zhin.js';
import type { TttSessionRow } from './models.js';
import { X, O, type Cell, cellLabel } from './engine.js';

export const BOT_ID = '__ttt_bot__';

export function senderDisplayName(sender: Pick<MessageSender, 'id' | 'name'>): string {
  const name = sender.name?.trim();
  return name || sender.id;
}

export function playerDisplayName(playerId: string, storedName?: string): string {
  if (playerId === BOT_ID) return '机器人';
  const name = storedName?.trim();
  return name || playerId;
}

export function formatPlayerWithMark(
  playerId: string,
  storedName: string | undefined,
  mark: '✕' | '○',
): string {
  return `${playerDisplayName(playerId, storedName)} (${mark})`;
}

export function formatRosterLine(session: TttSessionRow): string {
  return `${formatPlayerWithMark(session.player_x, session.player_x_name, '✕')} vs ${formatPlayerWithMark(session.player_o, session.player_o_name, '○')}`;
}

export function playerRefForMark(session: TttSessionRow, mark: Cell): { id: string; name?: string } {
  if (mark === X) return { id: session.player_x, name: session.player_x_name };
  return { id: session.player_o, name: session.player_o_name };
}

export function formatTurnStatus(session: TttSessionRow, moveCount: number): string {
  const mark = session.turn === 1 ? X : O;
  const { id, name } = playerRefForMark(session, mark);
  return `第 ${moveCount} 手 · 轮到 ${formatPlayerWithMark(id, name, cellLabel(mark) as '✕' | '○')}`;
}

export function formatWinHeadline(session: TttSessionRow, winner: Cell): string {
  const { id, name } = playerRefForMark(session, winner);
  return `🎉 ${formatPlayerWithMark(id, name, cellLabel(winner) as '✕' | '○')} 获胜！`;
}

export function formatWinStatus(session: TttSessionRow, winner: Cell, boardAscii: string): string {
  return `${formatWinHeadline(session, winner)}\n${boardAscii}`;
}
