import { describe, it, expect } from 'vitest';
import {
  applyMove,
  bestMove,
  checkWinner,
  emptyBoard,
  isDraw,
  validMove,
  X,
  O,
} from '../src/engine.js';

describe('tic-tac-toe engine', () => {
  it('detects row win', () => {
    const board = applyMove(applyMove(applyMove(emptyBoard(), 0, X), 3, O), 1, X);
    const b2 = applyMove(board, 4, O);
    const b3 = applyMove(b2, 2, X);
    expect(checkWinner(b3)?.winner).toBe(X);
  });

  it('blocks column threat', () => {
    let board = emptyBoard();
    board = applyMove(board, 0, X);
    board = applyMove(board, 3, X);
    board = applyMove(board, 1, O);
    expect(bestMove(board, O)).toBe(6);
  });

  it('validMove rejects occupied', () => {
    const board = applyMove(emptyBoard(), 4, X);
    expect(validMove(board, 4)).toBe(false);
    expect(validMove(board, 0)).toBe(true);
  });

  it('detects draw', () => {
    const board = [X, O, X, X, O, O, O, X, O];
    expect(isDraw(board)).toBe(true);
  });
});
