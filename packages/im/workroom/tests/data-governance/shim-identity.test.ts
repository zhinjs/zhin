import * as legacyCanonical from '../../src/workroom/canonical-value.js';
import * as canonical from '../../src/data-governance/canonical-value.js';
import * as legacyStore from '../../src/workroom/durable-file-store.js';
import * as store from '../../src/data-governance/durable-file-store.js';

describe('workroom shims re-export data-governance modules', () => {
  it.each([
    ['canonical-value', legacyCanonical, canonical],
    ['durable-file-store', legacyStore, store],
  ])('%s exposes identical exports', (_n, legacy, moved) => {
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(moved).sort());
    for (const key of Object.keys(moved)) {
      expect((legacy as any)[key]).toBe((moved as any)[key]);
    }
  });
});
