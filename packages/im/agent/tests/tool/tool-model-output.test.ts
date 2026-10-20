import { describe, it, expect } from 'vitest';
import { applyToolToModelOutput } from '../../src/tool/tool-model-output.js';

describe('applyToolToModelOutput', () => {
  it('stringifies raw result when no hook', async () => {
    expect(await applyToolToModelOutput({}, { ok: true }, {})).toBe('{"ok":true}');
    expect(await applyToolToModelOutput({}, 'plain', {})).toBe('plain');
  });

  it('delegates to toModelOutput when provided', async () => {
    const text = await applyToolToModelOutput(
      { toModelOutput: ({ result }) => `custom:${result}` },
      42,
      { n: 1 },
    );
    expect(text).toBe('custom:42');
  });
});
