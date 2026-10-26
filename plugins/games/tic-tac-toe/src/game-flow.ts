import { createMessages, resolveLocale } from 'zhin.js/i18n';
import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
import type { TttSessionRow } from './models.js';
import { buildBoardInteractive } from './board-view.js';
import {
  applyMove,
  bestMove,
  checkWinner,
  isDraw,
  parseBoard,
  playerMark,
  validMove,
  X,
  O,
  type Cell,
  cellLabel,
} from './engine.js';
import {
  BOT_ID,
  formatPlayerWithMark,
  formatRosterLine,
  formatTurnStatus,
  formatWinHeadline,
  playerRefForMark,
  senderDisplayName,
} from './player-label.js';
import type { SessionServices, TttPlayerRef } from './session-service.js';

export { BOT_ID };

export function isBotSession(session: TttSessionRow): boolean {
  return session.player_o === BOT_ID || session.player_x === BOT_ID;
}

/** Render the canonical board reply; delivery belongs to the Runtime Host. */
export function renderBoard(
  message: GameMessageLike,
  session: TttSessionRow,
  statusLine: string,
  terminal = false,
  highlight?: number[],
): GameReply {
  const board = parseBoard(session.board);
  const content = buildBoardInteractive({
    locale: session.locale ?? undefined,
    sessionId: session.id,
    board,
    statusLine,
    turnMark: session.turn as Cell,
    terminal,
    omitAsciiBoard: message.$adapter === 'qq',
    highlight,
    channelType: message.$channel.type,
  });

  return content;
}

export async function restartFromTerminal(
  services: SessionServices,
  message: GameMessageLike,
  sessionId: string,
): Promise<GameReply | null> {
  const session = await services.session.getById(sessionId);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text1');
  if (session.status === 'active') return messages(locale, 'text2');
  const mark = playerMark(message.$sender.id, {
    playerX: session.player_x,
    playerO: session.player_o,
  });
  if (!mark) return messages(locale, 'text3');
  await services.session.updateSession(session.id, { status: 'aborted', winner: 0 });
  // PvP 局重开仍是 PvP（原班人马），不静默降级为人机
  if (!isBotSession(session)) {
    const board = await startPvpGame(
      services,
      message,
      { id: session.player_x, displayName: session.player_x_name },
      { id: session.player_o, displayName: session.player_o_name },
    );
    return board;
  }
  const hint = await startBotGame(services, message);
  return hint;
}

function turnCell(session: TttSessionRow): Cell {
  return session.turn === 1 ? X : O;
}

function playerIdForTurn(session: TttSessionRow): string {
  return session.turn === 1 ? session.player_x : session.player_o;
}

export async function handleMove(
  services: SessionServices,
  message: GameMessageLike,
  sessionId: string,
  cell: number,
): Promise<GameReply | null> {
  const session = await services.session.getById(sessionId);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session || session.status !== 'active') {
    return messages(locale, 'text4');
  }
  if (session.channel_key !== `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`) {
    return messages(locale, 'text5');
  }

  const mark = playerMark(message.$sender.id, {
    playerX: session.player_x,
    playerO: session.player_o,
  });
  if (!mark) {
    return messages(locale, 'text3');
  }
  if (mark !== turnCell(session)) {
    const turn = turnCell(session);
    const { id, name } = playerRefForMark(session, turn);
    return messages(locale, 'text6', { p0: formatPlayerWithMark(id, name, cellLabel(turn) as '✕' | '○', locale) });
  }

  const board = parseBoard(session.board);
  if (!validMove(board, cell)) {
    return messages(locale, 'text7');
  }

  const nextBoard = applyMove(board, cell, mark);
  const win = checkWinner(nextBoard);
  const draw = !win && isDraw(nextBoard);
  const moveCount = session.move_count + 1;

  await services.session.recordMove(session.id, message.$sender.id, cell, moveCount);
  await services.session.updateSession(session.id, {
    board: JSON.stringify(nextBoard),
    move_count: moveCount,
    turn: session.turn === 1 ? 2 : 1,
    status: win ? 'won' : draw ? 'draw' : 'active',
    winner: win ? win.winner : 0,
  });

  const updated = (await services.session.getById(session.id))!;

  if (win) {
    const status = formatWinHeadline(updated, win.winner);
    return renderBoard(message, updated, status, true, win.line);
  }
  if (draw) {
    return renderBoard(message, updated, messages(locale, 'text8'), true);
  }

  // 人机：玩家落子后立刻由服务端代下，避免先发「轮到机器人」再发终盘（QQ 被动消息多耗一次）
  if (isBotSession(updated) && playerIdForTurn(updated) === BOT_ID) {
    return runBotMove(services, message, updated);
  }

  const status = formatTurnStatus(updated, moveCount);
  return renderBoard(message, updated, status, false);
}

async function runBotMove(
  services: SessionServices,
  message: GameMessageLike,
  session: TttSessionRow,
): Promise<GameReply | null> {
  const board = parseBoard(session.board);
  const aiMark = session.player_o === BOT_ID ? O : X;
  const cell = bestMove(board, aiMark);
  if (cell < 0) return null;

  const fakeMessage = {
    ...message,
    $sender: { ...message.$sender, id: BOT_ID, name: '机器人' },
  } as GameMessageLike;

  return handleMove(services, fakeMessage, session.id, cell);
}

export async function startBotGame(
  services: SessionServices,
  message: GameMessageLike,
): Promise<GameReply> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.session.getActiveByChannel(ch);
  const locale = resolveLocale(active ? active.locale : message.locale);
  if (active) return messages(locale, 'text9');

  const session = await services.session.createSession({
    message,
    playerX: message.$sender.id,
    playerO: BOT_ID,
    playerXName: senderDisplayName(message.$sender),
    playerOName: '机器人',
    boardJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });

  const status = messages(locale, 'text10', { p0: formatRosterLine(session) });
  const board = renderBoard(message, session, status, false);
  const success = messages(locale, 'text11');
  return Array.isArray(board) ? [...board, success] : [board, success];
}

export async function startPvpGame(
  services: SessionServices,
  message: GameMessageLike,
  playerX: TttPlayerRef,
  playerO: TttPlayerRef,
): Promise<GameReply> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.session.getActiveByChannel(ch);
  const locale = resolveLocale(active ? active.locale : message.locale);
  if (active) return messages(locale, 'text9');

  const session = await services.session.createSession({
    message,
    playerX: playerX.id,
    playerO: playerO.id,
    playerXName: playerX.displayName,
    playerOName: playerO.displayName,
    boardJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
  const opener = formatPlayerWithMark(session.player_x, session.player_x_name, '✕');
  const status = messages(locale, 'text12', { p0: formatRosterLine(session), p1: opener });
  return renderBoard(message, session, status, false);
}

const messages = createMessages({
  text1: { 'zh-CN': "对局不存在。", en: "This game no longer exists." },
  text2: { 'zh-CN': "对局尚未结束，无法重开。", en: "Finish the current game before restarting." },
  text3: { 'zh-CN': "你不是本局玩家。", en: "You are not a player in this game." },
  text4: { 'zh-CN': "对局不存在或已结束。", en: "This game does not exist or has ended." },
  text5: { 'zh-CN': "请在开局频道落子。", en: "Make your move in the channel where this game started." },
  text6: { 'zh-CN': "还没轮到你（当前轮到 {p0}）。", en: "It is not your turn ({p0} to play)." },
  text7: { 'zh-CN': "该位置不可落子。", en: "That cell is unavailable." },
  text8: { 'zh-CN': "平局。", en: "Draw." },
  text9: { 'zh-CN': "当前频道已有进行中的对局。", en: "This channel already has an active game." },
  text10: { 'zh-CN': "{p0} · 你先手 (✕)", en: "{p0} · You play first (✕)" },
  text11: { 'zh-CN': "\n\n开局成功！点击空格或回复数字 1–9 落子。", en: "\n\nGame started! Choose an empty cell or reply with a number 1–9." },
  text12: { 'zh-CN': "{p0} · 先手：{p1}", en: "{p0} · First player: {p1}" },
});
