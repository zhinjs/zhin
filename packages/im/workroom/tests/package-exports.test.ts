import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as scheduler from '../src/scheduler.js';
import * as portfolio from '../src/portfolio.js';
import * as remote from '../src/remote.js';
import * as dataGovernance from '../src/data-governance.js';

describe('@zhin.js/workroom export surface (C4b/C4c)', () => {
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

  it('keeps data-governance / workroom-data-* / workroom-payload-* runtime values out of the package root (C4c)', () => {
    for (const name of [
      'createFileWorkroomDataLifecycleRuntime',
      'installWorkroomDataGovernanceResources',
      'resolveWorkroomDataGovernanceRootAuthorities',
      'createGenerationOwnedWorkroomDataGovernanceStorage',
      'materializeDisclosureManifest',
      'EncryptedDatabasePayloadVault',
    ]) {
      expect(name in root, `${name} must not be a root export`).toBe(false);
    }
  });

  it('exposes them from the frozen ./data-governance subpath', () => {
    expect(typeof dataGovernance.createFileWorkroomDataLifecycleRuntime).toBe('function');
    expect(typeof dataGovernance.installWorkroomDataGovernanceResources).toBe('function');
    expect(typeof dataGovernance.resolveWorkroomDataGovernanceRootAuthorities).toBe('function');
    expect(typeof dataGovernance.createGenerationOwnedWorkroomDataGovernanceStorage).toBe('function');
    expect(typeof dataGovernance.materializeDisclosureManifest).toBe('function');
    expect(typeof dataGovernance.EncryptedDatabasePayloadVault).toBe('function');
  });

  it('keeps the fail-closed legacy payload guard on the package root', () => {
    expect(typeof root.LegacyEmbeddedPayloadDetectedError).toBe('function');
  });

  it('has no overlapping runtime export names between entries', () => {
    const entries = { root, scheduler, portfolio, remote, dataGovernance };
    const seen = new Map<string, string>();
    for (const [entry, mod] of Object.entries(entries)) {
      for (const name of Object.keys(mod)) {
        expect(seen.get(name), `${name} exported by both ${seen.get(name)} and ${entry}`).toBeUndefined();
        seen.set(name, entry);
      }
    }
  });
});
