import type { Message, SendContent } from 'zhin.js';
import {
  buildGridKeyboard,
  buildGridFallbackMap,
  parseGridPayload,
  parseCellButtonId as parseButtonId,
  channelKey,
  type GridCell,
} from '@zhin.js/game-kit';
import {
  asciiBoard,
  cellLabel,
  type Board,
  type Cell,
  EMPTY,
  X,
  O,
} from './engine.js';

/** 游戏前缀（用于 payload） */
export const TTT_PREFIX = 'ttt';

export { channelKey };

/** 将井字棋棋盘转为通用 GridCell 数组 */
function boardToCells(board: Board, highlight?: number[]): GridCell<Cell>[] {
  const highlightSet = new Set(highlight ?? []);
  return board.map((cell, i) => ({
    state: cell,
    label: cell === EMPTY ? '·' : cellLabel(cell),
    disabled: cell !== EMPTY,
    highlight: highlightSet.has(i),
  }));
}

/** 井字棋 ASCII 棋盘渲染器（适配 GridCell） */
function renderTttAscii(
  cells: GridCell<Cell>[],
  rows: number,
  cols: number,
  highlight?: number[],
): string {
  const board = cells.map((c) => c.state);
  return asciiBoard(board as Board, highlight);
}

export function buildBoardInteractive(options: {
  sessionId: string;
  board: Board;
  statusLine: string;
  turnMark: Cell;
  terminal?: boolean;
  omitAsciiBoard?: boolean;
  highlight?: number[];
  channelType?: string;
}): SendContent {
  const { sessionId, board, statusLine, terminal, omitAsciiBoard, highlight, channelType } = options;

  return buildGridKeyboard({
    gamePrefix: TTT_PREFIX,
    sessionId,
    rows: 3,
    cols: 3,
    cells: boardToCells(board, highlight),
    statusLine,
    terminal,
    omitAsciiBoard,
    renderAscii: renderTttAscii,
    highlight,
    fallbackHint: '落子：回复数字 1-9（仅空格）',
    postChoices: terminal
      ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' }]
      : undefined,
    channelType,
  });
}

export function buildFallbackMap(sessionId: string, board: Board): Record<string, string> {
  return buildGridFallbackMap(TTT_PREFIX, sessionId, boardToCells(board));
}

export function parseTttPayload(payload: string): { sessionId: string; cell: number } | null {
  const result = parseGridPayload(payload, TTT_PREFIX);
  if (!result) return null;
  if (result.cell > 8) return null;
  return { sessionId: result.sessionId, cell: result.cell };
}

/** QQ 等平台回调可能只带 button_id（如 c4），不含 ttt: 前缀 payload */
export function parseCellButtonId(value: string): number | null {
  const cell = parseButtonId(value);
  if (cell === null || cell > 8) return null;
  return cell;
}

export function markName(mark: Cell): string {
  return mark === X ? '✕' : '○';
}
