import { describe, expect, it, beforeEach } from 'vitest';
import {
  markBootstrapStart,
  markBootstrapPhase,
  markBootstrapReady,
  formatBootstrapTitle,
  getBootstrapPhaseTimings,
} from '../src/setup/startup-summary.js';

describe('bootstrap phase timings', () => {
  beforeEach(() => {
    markBootstrapStart();
  });

  it('formats title with DB / AI / IM segments', () => {
    markBootstrapPhase('db');
    markBootstrapPhase('ai');
    markBootstrapReady();
    const title = formatBootstrapTitle().replace(/\x1b\[[0-9;]*m/g, '');
    expect(title).toContain('Zhin 已就绪');
    expect(title).toContain('ms');
    expect(title).toContain('DB');
    expect(title).toContain('AI');
    expect(title).toContain('IM');
    const timings = getBootstrapPhaseTimings();
    expect(timings?.total).toBeGreaterThanOrEqual(0);
    expect(timings?.db).toBeGreaterThanOrEqual(0);
    expect(timings?.ai).toBeGreaterThanOrEqual(0);
    expect(timings?.im).toBeGreaterThanOrEqual(0);
  });
});
