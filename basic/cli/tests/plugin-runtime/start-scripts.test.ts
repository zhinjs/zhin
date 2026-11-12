import { describe, expect, it } from 'vitest';
import { isAcceptedStartScript, LEGACY_START_SCRIPTS, RECOMMENDED_START_SCRIPTS } from '../../src/plugin-runtime/migrate/start-scripts.js';

describe('migration start scripts (ADR 0054 §6)', () => {
  it('recommends zhin start like create-zhin-app and accepts zhin runtime start as an alias', () => {
    expect(RECOMMENDED_START_SCRIPTS).toEqual({
      dev: 'zhin start --foreground --watch source config',
      start: 'zhin start --foreground --mode production --no-watch',
      daemon: 'zhin start --mode production --no-watch',
    });
    for (const script of ['zhin start', 'zhin start --foreground', 'zhin runtime start', 'zhin runtime start --mode production']) {
      expect(isAcceptedStartScript(script), script).toBe(true);
    }
    for (const script of ['zhin dev', 'zhin startx', 'node index.js', undefined]) expect(isAcceptedStartScript(script)).toBe(false);
    // `zhin start` is current, never treated as legacy.
    expect(Object.values(LEGACY_START_SCRIPTS).flat()).not.toContain('zhin start');
  });
});
