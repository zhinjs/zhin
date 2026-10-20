import { describe, it, expect } from 'vitest';
import { disableTool, normalizeToolDenylist, isDisabledToolRef } from '../../src/authoring/disable-tool.js';

describe('disableTool', () => {
  it('creates sentinel and normalizes denylist', () => {
    const ref = disableTool('bash');
    expect(isDisabledToolRef(ref)).toBe(true);
    expect(normalizeToolDenylist([ref, 'web_search', ''])).toEqual(['bash', 'web_search']);
  });
});
