import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProviderDisplay } from '../../../src/instance/cli/provider-display.js';

describe('loadProviderDisplay (#1250)', () => {
  it('returns no names, without throwing, when the project has no inference graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provider-display-'));
    try {
      await expect(loadProviderDisplay(root)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
