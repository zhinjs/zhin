import { describe, it, expect } from 'vitest';
import {
  buildGridKeyboard,
  buildGridFallbackMap,
  parseGridPayload,
  parseCellButtonId,
  type GridCell,
} from '../src/grid-keyboard.js';

describe('grid-keyboard', () => {
  describe('parseGridPayload', () => {
    it('parses valid payload', () => {
      expect(parseGridPayload('ttt:s123:4')).toEqual({
        prefix: 'ttt',
        sessionId: 's123',
        cell: 4,
      });
    });

    it('parses payload with expected prefix', () => {
      expect(parseGridPayload('ttt:s123:4', 'ttt')).toEqual({
        prefix: 'ttt',
        sessionId: 's123',
        cell: 4,
      });
    });

    it('rejects mismatched prefix', () => {
      expect(parseGridPayload('ttt:s123:4', 'gomoku')).toBeNull();
    });

    it('rejects invalid payload', () => {
      expect(parseGridPayload('invalid')).toBeNull();
      expect(parseGridPayload('ttt:s123')).toBeNull();
      expect(parseGridPayload(':s123:4')).toBeNull();
    });

    it('handles large cell indices', () => {
      expect(parseGridPayload('gomoku:abc:224')).toEqual({
        prefix: 'gomoku',
        sessionId: 'abc',
        cell: 224,
      });
    });
  });

  describe('parseCellButtonId', () => {
    it('parses valid button id', () => {
      expect(parseCellButtonId('c0')).toBe(0);
      expect(parseCellButtonId('c4')).toBe(4);
      expect(parseCellButtonId('c224')).toBe(224);
    });

    it('rejects invalid button id', () => {
      expect(parseCellButtonId('x4')).toBeNull();
      expect(parseCellButtonId('c')).toBeNull();
      expect(parseCellButtonId('')).toBeNull();
    });
  });

  describe('buildGridFallbackMap', () => {
    it('includes only enabled cells', () => {
      const cells: GridCell[] = [
        { state: 0, label: '·', disabled: false },
        { state: 1, label: 'X', disabled: true },
        { state: 0, label: '·', disabled: false },
      ];
      const map = buildGridFallbackMap('test', 's1', cells);
      expect(Object.keys(map)).toHaveLength(2);
      expect(map['1']).toBe('test:s1:0');
      expect(map['2']).toBe('test:s1:2');
    });

    it('returns empty map when all disabled', () => {
      const cells: GridCell[] = [
        { state: 1, label: 'X', disabled: true },
        { state: 2, label: 'O', disabled: true },
      ];
      const map = buildGridFallbackMap('test', 's1', cells);
      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe('buildGridKeyboard', () => {
    it('creates 3x3 keyboard', () => {
      const cells: GridCell[] = Array(9).fill(null).map(() => ({
        state: 0,
        label: '·',
        disabled: false,
      }));
      const content = buildGridKeyboard({
        gamePrefix: 'ttt',
        sessionId: 's1',
        rows: 3,
        cols: 3,
        cells,
        statusLine: 'Your turn',
      });
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
      expect((content[0] as { type: string }).type).toBe('text');
      expect((content[1] as { type: string }).type).toBe('keyboard');
    });

    it('omits ASCII board when flag is set', () => {
      const cells: GridCell[] = Array(9).fill(null).map(() => ({
        state: 0,
        label: '·',
        disabled: false,
      }));
      const asciiRenderer = () => 'ASCII_BOARD';
      const content = buildGridKeyboard({
        gamePrefix: 'ttt',
        sessionId: 's1',
        rows: 3,
        cols: 3,
        cells,
        statusLine: 'Test',
        renderAscii: asciiRenderer,
        omitAsciiBoard: true,
      });
      const textData = (content[0] as { data: { text: string } }).data.text;
      expect(textData).not.toContain('ASCII_BOARD');
    });

    it('includes ASCII board when flag is false', () => {
      const cells: GridCell[] = Array(9).fill(null).map(() => ({
        state: 0,
        label: '·',
        disabled: false,
      }));
      const asciiRenderer = () => 'ASCII_BOARD';
      const content = buildGridKeyboard({
        gamePrefix: 'ttt',
        sessionId: 's1',
        rows: 3,
        cols: 3,
        cells,
        statusLine: 'Test',
        renderAscii: asciiRenderer,
        omitAsciiBoard: false,
      });
      const textData = (content[0] as { data: { text: string } }).data.text;
      expect(textData).toContain('ASCII_BOARD');
    });
  });
});
