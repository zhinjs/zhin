import { describe, it, expect } from 'vitest';
import { segment } from '../src/utils.js';
import {
  resolveKeyboardSegments,
  collectKeyboardFallbackMaps,
  getActionFromMessage,
  isActionMessage,
  actionSegment,
  stripInteractiveCommandText,
  resolvePayloadFromText,
  isKeyboardSegment,
  isActionSegment,
} from '../src/built/interactive-segments/index.js';

describe('resolveKeyboardSegments', () => {
  const board = [
    segment.text('轮到 X'),
    segment.keyboard([
      [
        segment.button({ id: 'c0', label: '·', payload: 'ttt:s1:0' }),
        segment.button({ id: 'c1', label: '✕', payload: 'ttt:s1:1', disabled: true }),
      ],
    ], { fallback: { hint: '落子 1-9', map: { '1': 'ttt:s1:0', '2': 'ttt:s1:1' } } }),
  ];

  it('keeps keyboard segment when policy is native', () => {
    const out = resolveKeyboardSegments(board, 'native');
    const arr = Array.isArray(out) ? out : [out];
    expect(arr.some((s) => typeof s !== 'string' && s.type === 'keyboard')).toBe(true);
  });

  it('degrades keyboard to text when policy is text', () => {
    const out = resolveKeyboardSegments(board, 'text');
    const raw = segment.raw(out);
    expect(raw).toContain('轮到 X');
    expect(raw).toContain('落子 1-9');
    expect(raw).toContain('1.');
  });
});

describe('interactive segment data guards', () => {
  it('validates nested button, fallback and command fields before asserting keyboard data', () => {
    const button = { id: 'a', label: 'A', payload: 'action:a', disabled: false, style: 'primary', mode: 'command', command: { enter: true, reply: false } };
    expect(isKeyboardSegment({ type: 'keyboard', data: { rows: [[button]], fallback: { hint: 'choose', map: { '1': 'action:a' } } } })).toBe(true);
    for (const data of [
      undefined, null, [], {}, { rows: null }, { rows: {} }, { rows: ['row'] },
      { rows: [[null]] }, { rows: [[{ ...button, payload: 42 }]] },
      { rows: [[{ ...button, disabled: 'false' }]] }, { rows: [[{ ...button, style: 'unknown' }]] },
      { rows: [[{ ...button, mode: 'unknown' }]] }, { rows: [[{ ...button, command: [] }]] },
      { rows: [[{ ...button, command: { enter: 1 } }]] }, { rows: [[{ ...button, command: { reply: 'yes' } }]] },
      { rows: [], fallback: { hint: 'choose', map: { '1': 42 } } },
      { rows: [], fallback: { hint: 42, map: {} } }, { rows: [], fallback: { hint: 'choose', map: [] } },
    ]) expect(isKeyboardSegment({ type: 'keyboard', data })).toBe(false);
  });

  it('only asserts action data with string identity, payload and optional source id', () => {
    expect(isActionSegment(actionSegment({ id: 'a', payload: 'action:a', sourceMessageId: 'message-1' }))).toBe(true);
    for (const data of [undefined, null, [], {}, { id: 'a' }, { id: 'a', payload: 42 }, { id: 42, payload: 'action:a' }, { id: 'a', payload: 'action:a', sourceMessageId: 42 }]) {
      expect(isActionSegment({ type: 'action', data })).toBe(false);
    }
  });
});

describe('action segments', () => {
  it('reads action payloads', () => {
    const msg = { segments: [actionSegment({ id: 'a', payload: 'ttt:s1:4' })] } as any;
    expect(getActionFromMessage(msg)?.payload).toBe('ttt:s1:4');
    expect(isActionMessage(msg)).toBe(true);
  });

  it('isActionMessage is false for text messages', () => {
    const msg = { segments: [{ type: 'text', data: { text: 'hello' } }] } as any;
    expect(isActionMessage(msg)).toBe(false);
  });
});

describe('stripInteractiveCommandText / resolvePayloadFromText', () => {
  it('strips @bot prefix and at segments', () => {
    expect(stripInteractiveCommandText('@mybot hub:g1:g_ttt')).toBe('hub:g1:g_ttt');
    expect(stripInteractiveCommandText('<at id=\'123\'/> hub:g1:g_ttt')).toBe('hub:g1:g_ttt');
  });

  it('resolves direct payload from normalized text', () => {
    expect(resolvePayloadFromText('@bot ttt:s1:4')).toBe('ttt:s1:4');
  });

  it('resolves numeric fallback via map', () => {
    const map = { '1': 'hub:scope:g_ttt', '2': 'hub:scope:g_rps' };
    expect(resolvePayloadFromText('2', map)).toBe('hub:scope:g_rps');
    expect(resolvePayloadFromText('@bot 1', map)).toBe('hub:scope:g_ttt');
  });
});

describe('collectKeyboardFallbackMaps', () => {
  it('显式 fallback.map 优先，无显式时按按钮顺序自动编号', () => {
    const content = [
      segment.text('menu'),
      segment.keyboard([
        [segment.button({ id: 'a', label: '甲', payload: 'x:s:a' })],
      ], { fallback: { hint: 'h', map: { '3': 'x:s:a' } } }),
      segment.keyboard([
        [
          segment.button({ id: 'b', label: '乙', payload: 'y:s:b' }),
          segment.button({ id: 'c', label: '丙', payload: 'y:s:c' }),
        ],
      ]),
    ];
    expect(collectKeyboardFallbackMaps(content)).toEqual([
      { '3': 'x:s:a' },
      { '1': 'y:s:b', '2': 'y:s:c' },
    ]);
    expect(collectKeyboardFallbackMaps('plain')).toEqual([]);
    expect(collectKeyboardFallbackMaps(undefined)).toEqual([]);
  });
});
