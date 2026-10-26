import { createMessages, type Locale } from 'zhin.js/i18n';
import type { MessageSender } from '@zhin.js/core';
import type { TttSessionRow } from './models.js';
import { X, O, type Cell, cellLabel } from './engine.js';

export const BOT_ID = '__ttt_bot__';

export function senderDisplayName(sender: Pick<MessageSender, 'id' | 'name'>): string {
  const name = sender.name?.trim();
  return name || sender.id;
}

export function playerDisplayName(playerId: string, storedName?: string, locale?: Locale): string {
  if (playerId === BOT_ID) return messages(locale, 'bot');
  const name = storedName?.trim();
  return name || playerId;
}

export function formatPlayerWithMark(
  playerId: string,
  storedName: string | undefined,
  mark: '✕' | '○',
  locale?: Locale,
): string {
  return `${playerDisplayName(playerId, storedName, locale)} (${mark})`;
}

export function formatRosterLine(session: TttSessionRow): string {
  return `${formatPlayerWithMark(session.player_x, session.player_x_name, '✕', session.locale ?? undefined)} vs ${formatPlayerWithMark(session.player_o, session.player_o_name, '○', session.locale ?? undefined)}`;
}

export function playerRefForMark(session: TttSessionRow, mark: Cell): { id: string; name?: string } {
  if (mark === X) return { id: session.player_x, name: session.player_x_name };
  return { id: session.player_o, name: session.player_o_name };
}

export function formatTurnStatus(session: TttSessionRow, moveCount: number): string {
  const mark = session.turn === 1 ? X : O;
  const { id, name } = playerRefForMark(session, mark);
  return messages(session.locale ?? undefined, 'turn', { count: moveCount, player: formatPlayerWithMark(id, name, cellLabel(mark) as '✕' | '○', session.locale ?? undefined) });
}

export function formatWinHeadline(session: TttSessionRow, winner: Cell): string {
  const { id, name } = playerRefForMark(session, winner);
  return messages(session.locale ?? undefined, 'win', { player: formatPlayerWithMark(id, name, cellLabel(winner) as '✕' | '○', session.locale ?? undefined) });
}

export function formatWinStatus(session: TttSessionRow, winner: Cell, boardAscii: string): string {
  return `${formatWinHeadline(session, winner)}\n${boardAscii}`;
}

const messages = createMessages({ bot: { 'zh-CN': '机器人', en: 'Bot' }, turn: { 'zh-CN': '第 {count} 手 · 轮到 {player}', en: 'Move {count} · {player} to play' }, win: { 'zh-CN': '🎉 {player} 获胜！', en: '🎉 {player} wins!' } });
