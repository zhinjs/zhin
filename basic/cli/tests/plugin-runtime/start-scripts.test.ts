import { describe, expect, it } from 'vitest';
import { isAcceptedStartScript, isForegroundStartScript, isLegacyScript, LEGACY_START_SCRIPTS, RECOMMENDED_START_SCRIPTS } from '../../src/plugin-runtime/migrate/start-scripts.js';

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
  });

  it('rewrites a bare zhin start in start / dev (background by default now), keeps other scripts', () => {
    for (const script of ['zhin start', ' zhin  start ', 'zhin start --daemon']) {
      expect(isLegacyScript(LEGACY_START_SCRIPTS, 'start', script), script).toBe(true);
      expect(isLegacyScript(LEGACY_START_SCRIPTS, 'dev', script), script).toBe(true);
    }
    expect(isLegacyScript(LEGACY_START_SCRIPTS, 'dev', 'zhin dev')).toBe(true);
    for (const script of ['zhin start --foreground', 'zhin runtime start', 'zhin start --mode production', undefined]) {
      expect(isLegacyScript(LEGACY_START_SCRIPTS, 'start', script), String(script)).toBe(false);
    }
    // The daemon script is meant to background.
    expect(isLegacyScript(LEGACY_START_SCRIPTS, 'daemon', 'zhin start --daemon')).toBe(false);
  });

  it('requires a foreground start script for process managers', () => {
    for (const script of [
      RECOMMENDED_START_SCRIPTS.start,
      'zhin start -f',
      'zhin runtime start',
      'zhin runtime start --mode production',
    ]) expect(isForegroundStartScript(script), script).toBe(true);
    for (const script of [
      'zhin start',
      'zhin start --daemon',
      RECOMMENDED_START_SCRIPTS.daemon,
      'zhin start && echo --foreground',
      'node index.js --foreground',
      undefined,
    ]) expect(isForegroundStartScript(script), String(script)).toBe(false);
  });
});
