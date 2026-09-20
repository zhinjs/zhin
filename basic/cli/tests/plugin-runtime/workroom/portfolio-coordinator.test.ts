import {
  GenerationOwnedPortfolioCapacityRuntime,
  portfolioCapacityRuntimeToken,
  portfolioJournalRepositoryToken,
} from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { WorkroomPortfolioCoordinator } from '../../../src/plugin-runtime/workroom/portfolio-coordinator.js';

describe('WorkroomPortfolioCoordinator', () => {
  it('rejects a Capacity runtime owned by another generation before publishing Portfolio state', () => {
    const resources = new Scope(rootPluginId());
    resources.provide(portfolioCapacityRuntimeToken, new GenerationOwnedPortfolioCapacityRuntime({
      generation: 1,
      repository: {} as never,
      policyAuthority: {} as never,
      bundleAuthority: {} as never,
      kernelAuthority: {} as never,
      usageAuthority: {} as never,
      clockAuthority: {} as never,
    }));

    expect(() => new WorkroomPortfolioCoordinator({
      generation: 2,
      resources,
      runtime: {} as never,
      profiles: {} as never,
      persistence: {} as never,
    })).toThrow('Workroom Portfolio Capacity runtime generation is stale');
    expect(resources.has(portfolioJournalRepositoryToken)).toBe(false);
  });
});
