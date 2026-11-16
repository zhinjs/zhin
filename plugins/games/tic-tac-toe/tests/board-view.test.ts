import { describe, it, expect } from 'vitest';
import { parseCellButtonId, parseTttPayload, buildBoardInteractive, TTT_PREFIX } from '../src/board-view.js';
import { buildGridFallbackMap } from '@zhin.js/game-kit';
import { emptyBoard, EMPTY } from '../src/engine.js';

describe('board-view', () => {
  it('parses payload', () => {
    expect(parseTttPayload('ttt:sabc:4')).toEqual({ sessionId: 'sabc', cell: 4 });
    expect(parseTttPayload('nope')).toBeNull();
    expect(parseCellButtonId('c4')).toBe(4);
    expect(parseCellButtonId('c9')).toBeNull();
  });

  it('builds fallback map for empty cells only', () => {
    const board = emptyBoard();
    board[4] = 1;
    const cells = board.map((cell) => ({
      state: cell,
      label: cell === EMPTY ? '·' : cell === 1 ? '✕' : '○',
      disabled: cell !== EMPTY,
    }));
    const map = buildGridFallbackMap(TTT_PREFIX, 's1', cells);
    expect(Object.keys(map).length).toBe(8);
    expect(map['1']).toMatch(/^ttt:s1:/);
  });

  it('tells players that replying 1–9 places a piece while the game is running (#1250)', () => {
    const board = emptyBoard();
    board[4] = 1;
    const content = buildBoardInteractive({ sessionId: 's1', board, statusLine: '轮到你', turnMark: 2 });
    const parts = content as Array<{ data: { text?: string; fallback?: { map: Record<string, string> } } }>;
    expect(parts[0]!.data.text).toContain('回复 1–9 在对应位置落子');
    // 按位置编号：5 号（中间）已占，不可用；9 号永远是右下角。
    expect(parts[1]!.data.fallback!.map['5']).toBeUndefined();
    expect(parts[1]!.data.fallback!.map['9']).toBe('ttt:s1:8');
  });

  it('omits ascii board when omitAsciiBoard is set', () => {
    const board = emptyBoard();
    board[0] = 1;
    const content = buildBoardInteractive({
      sessionId: 's1',
      board,
      statusLine: '平局。',
      turnMark: 1,
      terminal: true,
      omitAsciiBoard: true,
    });
    const text = (content as Array<{ type: string; data: { text: string } }>)[0]!.data.text;
    // 终局只剩「再来一局」按钮：只有统一回复提示，没有落子说明（#1250）。
    expect(text).toBe('平局。\n回复序号或按钮文字也可以');
    expect(text).not.toContain('-+-');
  });
});
