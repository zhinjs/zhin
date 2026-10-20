import { describe, expect, it } from 'vitest';
import {
  ConfigPatchPathError,
  applyConfigPatches,
} from '../src/index.js';

describe('Root config document patches', () => {
  it('applies object and array changes without mutating the source', () => {
    const source = Object.freeze({
      plugins: { demo: { endpoints: [{ id: 'a' }, { id: 'b' }] } },
    });
    const result = applyConfigPatches(source, [
      { op: 'set', path: ['plugins', 'demo', 'endpoints', '0', 'id'], value: 'renamed' },
      { op: 'remove', path: ['plugins', 'demo', 'endpoints', '1'] },
      { op: 'set', path: ['http', 'port'], value: 8080 },
    ]);

    expect(result).toEqual({
      plugins: { demo: { endpoints: [{ id: 'renamed' }] } },
      http: { port: 8080 },
    });
    expect(source.plugins.demo.endpoints).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('rejects unsafe, non-numeric, and out-of-bounds paths', () => {
    const source = { plugins: { demo: { endpoints: [{ id: 'a' }] } } };
    expect(() => applyConfigPatches(source, [{
      op: 'set', path: ['__proto__', 'polluted'], value: true,
    }])).toThrow(ConfigPatchPathError);
    expect(() => applyConfigPatches(source, [{
      op: 'set', path: ['plugins', 'demo', 'endpoints', 'name'], value: true,
    }])).toThrow(/requires an array index/);
    expect(() => applyConfigPatches(source, [{
      op: 'remove', path: ['plugins', 'demo', 'endpoints', '4'],
    }])).toThrow(/out of bounds/);
  });

  it('validates root replacements', () => {
    expect(applyConfigPatches({}, [{ op: 'set', path: [], value: { log_level: 'debug' } }]))
      .toEqual({ log_level: 'debug' });
    expect(() => applyConfigPatches({}, [{ op: 'remove', path: [] }]))
      .toThrow(/root cannot be removed/);
    expect(() => applyConfigPatches({}, [{ op: 'set', path: [], value: [] }]))
      .toThrow(/root must be an object/);
  });
});
