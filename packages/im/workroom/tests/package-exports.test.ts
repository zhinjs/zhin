import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as scheduler from '../src/scheduler.js';
import * as portfolio from '../src/portfolio.js';
import * as remote from '../src/remote.js';

describe('@zhin.js/workroom export surface (C4b)', () => {
  it('keeps scheduler / portfolio runtime values out of the package root', () => {
    for (const name of [
      'createWorkroomSchedulerPolicySnapshot',
      'decideWorkroomSchedule',
      'GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry',
      'InMemoryPortfolioJournalRepository',
    ]) {
      expect(name in root, `${name} must not be a root export`).toBe(false);
    }
  });

  it('exposes them from the frozen subpaths', () => {
    expect(typeof scheduler.createWorkroomSchedulerPolicySnapshot).toBe('function');
    expect(typeof scheduler.decideWorkroomSchedule).toBe('function');
    expect(typeof scheduler.GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry).toBe('function');
    expect(typeof portfolio.InMemoryPortfolioJournalRepository).toBe('function');
  });

  it('has no overlapping runtime export names between entries', () => {
    const entries = { root, scheduler, portfolio, remote };
    const seen = new Map<string, string>();
    for (const [entry, mod] of Object.entries(entries)) {
      for (const name of Object.keys(mod)) {
        expect(seen.get(name), `${name} exported by both ${seen.get(name)} and ${entry}`).toBeUndefined();
        seen.set(name, entry);
      }
    }
  });
});
