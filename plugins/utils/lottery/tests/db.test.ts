import { describe, it, expect } from 'vitest';
import { parseStoredJson } from '../src/db.js';

describe('parseStoredJson', () => {
  it('parses JSON string', () => {
    expect(parseStoredJson('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns object as-is', () => {
    const obj = { main: [1, 2] };
    expect(parseStoredJson(obj, {})).toBe(obj);
  });

  it('returns fallback for invalid input', () => {
    expect(parseStoredJson('[object Object]', { ok: false })).toEqual({ ok: false });
  });
});
