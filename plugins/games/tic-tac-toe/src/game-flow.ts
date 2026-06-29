import type { Adapter, Message, Plugin } from 'zhin.js';
import { recordGameOutcome } from '@zhin.js/game-shared';
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

export async function sendOrEditBoard(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
  session: TttSessionRow,
  statusLine: string,
  terminal = false,
  highlight?: number[],
): Promise<string> {
  const board = parseBoard(session.board);
  const content = buildBoardInteractive({
    sessionId: session.id,
    board,
    statusLine,
    turnMark: session.turn as Cell,
    terminal,
    omitAsciiBoard: message.$adapter === 'qq',
    highlight,
    channelType: message.$channel.type,
  });

  const adapter = plugin.root.inject(message.$adapter) as Adapter;

  if (session.board_message_id) {
    const msgId = await adapter.editMessage({
      messageId: session.board_message_id,
      context: String(message.$adapter),
      endpoint: message.$endpoint,
      id: message.$channel.id,
      type: message.$channel.type,
      content,
    });
    if (msgId !== session.board_message_id) {
      await services.session.updateSession(session.id, { board_message_id: msgId });
    }
    return msgId;
  }

  const msgId = await message.$reply?.(content);
  if (msgId) {
    await services.session.updateSession(session.id, { board_message_id: msgId });
  }
  return msgId ?? '';
}

export async function restartFromTerminal(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
  sessionId: string,
): Promise<string | null> {
  const session = await services.session.getById(sessionId);
  if (!session) return '对局不存在。';
  const mark = playerMark(message.$sender.id, {
    playerX: session.player_x,
    playerO: session.player_o,
  });
  if (!mark) return '你不是本局玩家。';
  await services.session.updateSession(session.id, { status: 'aborted', winner: 0 });
  const hint = await startBotGame(plugin, services, message);
  return hint.includes('已有') ? hint : null;
}

function turnCell(session: TttSessionRow): Cell {
  return session.turn === 1 ? X : O;
}

function playerIdForTurn(session: TttSessionRow): string {
  return session.turn === 1 ? session.player_x : session.player_o;
}

export async function handleMove(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
  sessionId: string,
  cell: number,
): Promise<string | null> {
  const session = await services.session.getById(sessionId);
  if (!session || session.status !== 'active') {
    return '对局不存在或已结束。';
  }
  if (session.channel_key !== `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`) {
    return '请在开局频道落子。';
  }

  const mark = playerMark(message.$sender.id, {
    playerX: session.player_x,
    playerO: session.player_o,
  });
  if (!mark) {
    return '你不是本局玩家。';
  }
  if (mark !== turnCell(session)) {
    const turn = turnCell(session);
    const { id, name } = playerRefForMark(session, turn);
    return `还没轮到你（当前轮到 ${formatPlayerWithMark(id, name, cellLabel(turn) as '✕' | '○')}）。`;
  }

  const board = parseBoard(session.board);
  if (!validMove(board, cell)) {
    return '该位置不可落子。';
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

  if (win || draw) {
    const humanId = isBotSession(updated)
      ? (updated.player_x === BOT_ID ? updated.player_o : updated.player_x)
      : message.$sender.id;
    const humanName = isBotSession(updated)
      ? (updated.player_x === BOT_ID ? updated.player_o_name : updated.player_x_name)
      : String(message.$sender.name ?? message.$sender.id);
    const humanMsg = {
      ...message,
      $sender: { ...message.$sender, id: humanId, name: humanName },
    } as Message<any>;
    if (win) {
      const humanMark = playerMark(humanId, {
        playerX: updated.player_x,
        playerO: updated.player_o,
      });
      const humanWon = humanMark === win.winner;
      void recordGameOutcome(humanMsg, 'ttt', humanWon ? 'won' : 'lost', humanWon ? 20 : 0);
    } else {
      void recordGameOutcome(humanMsg, 'ttt', 'draw');
    }
  }

  if (win) {
    const status = formatWinHeadline(updated, win.winner);
    await sendOrEditBoard(plugin, services, message, updated, status, true, win.line);
    return null;
  }
  if (draw) {
    await sendOrEditBoard(plugin, services, message, updated, '平局。', true);
    return null;
  }

  // 人机：玩家落子后立刻由服务端代下，避免先发「轮到机器人」再发终盘（QQ 被动消息多耗一次）
  if (isBotSession(updated) && playerIdForTurn(updated) === BOT_ID) {
    await runBotMove(plugin, services, message, updated);
    return null;
  }

  const status = formatTurnStatus(updated, moveCount);
  await sendOrEditBoard(plugin, services, message, updated, status, false);

  return null;
}

async function runBotMove(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
  session: TttSessionRow,
): Promise<void> {
  const board = parseBoard(session.board);
  const aiMark = session.player_o === BOT_ID ? O : X;
  const cell = bestMove(board, aiMark);
  if (cell < 0) return;

  const fakeMessage = {
    ...message,
    $sender: { ...message.$sender, id: BOT_ID, name: '机器人' },
  } as Message<any>;

  await handleMove(plugin, services, fakeMessage, session.id, cell);
}

export async function startBotGame(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
): Promise<string> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.session.getActiveByChannel(ch);
  if (active) return '当前频道已有进行中的对局。';

  const session = await services.session.createSession({
    message,
    playerX: message.$sender.id,
    playerO: BOT_ID,
    playerXName: senderDisplayName(message.$sender),
    playerOName: '机器人',
    boardJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });

  const status = `${formatRosterLine(session)} · 你先手 (✕)`;
  await sendOrEditBoard(plugin, services, message, session, status, false);
  return '开局成功！点击棋盘或回复数字落子。';
}

export async function startPvpGame(
  plugin: Plugin,
  services: SessionServices,
  message: Message<any>,
  playerX: TttPlayerRef,
  playerO: TttPlayerRef,
): Promise<void> {
  const session = await services.session.createSession({
    message,
    playerX: playerX.id,
    playerO: playerO.id,
    playerXName: playerX.displayName,
    playerOName: playerO.displayName,
    boardJson: JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
  const opener = formatPlayerWithMark(session.player_x, session.player_x_name, '✕');
  const status = `${formatRosterLine(session)} · 先手：${opener}`;
  await sendOrEditBoard(plugin, services, message, session, status, false);
}
