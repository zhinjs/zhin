import { describe, it, expect } from 'vitest';
import { parseCellButtonId, parseTttPayload, buildBoardInteractive, TTT_PREFIX } from '../src/board-view.js';
import { buildGridFallbackMap } from '@zhin.js/game-shared';
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
    expect(text).toBe('平局。');
    expect(text).not.toContain('-+-');
  });
});
