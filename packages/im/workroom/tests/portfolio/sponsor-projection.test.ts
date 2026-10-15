import { createPortfolioSponsorProjection } from '../../src/portfolio/sponsor-projection.js';
import { createPortfolioPolicySnapshot, type PortfolioCapacityRequest } from '../../src/portfolio/portfolio-journal.js';
import type { PortfolioAdmissionState } from '../../src/portfolio/portfolio-admission.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Portfolio Sponsor projection', () => {
  it('projects content-free lane, queue, budget/rate, blocker and fairness facts', () => {
    const policy = createPortfolioPolicySnapshot({
      revision: 1, globalBudgetMicros: 1_000, offerTtlTicks: 2, leaseTtlTicks: 5,
      leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
      reclaimTtlTicks: 2,
      pools: { model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 } },
      projects: {
        alpha: project('alpha', 'normal', 2, 100),
        beta: project('beta', 'low', 1, 50),
      },
    });
    const request = capacityRequest('request-alpha', 'alpha');
    const state: PortfolioAdmissionState = {
      portfolioId: 'portfolio-main', sequence: 7, now: 4, clockSequence: 6,
      clockDigest: SHA, usageSettlementCursor: -1, policy,
      requests: { [request.requestId]: { request, bundleAuthority: bundleAuthority(),
        requestedAt: 1, requestedSequence: 3 } },
      grants: {}, reclaims: {}, overrides: {}, normalizedService: { alpha: 6, beta: 2 },
      normalizedAtSequence: 5,
    };

    const projection = createPortfolioSponsorProjection(state);
    expect(projection).toMatchObject({
      version: 1, portfolioId: 'portfolio-main', sourceSequence: 7,
      projects: {
        alpha: {
          lane: 'normal', status: 'active', weight: 2,
          queueHead: { requestId: 'request-alpha', opaqueHeadId: 'head:request-alpha' },
          budget: { limitMicros: 100, reservedMicros: 0, spentMicros: 0, availableMicros: 100 },
          fairness: { normalizedService: 6, weight: 2 },
        },
        beta: { lane: 'low', fairness: { normalizedService: 2, weight: 1 } },
      },
    });
    expect(projection.projects.alpha?.blockers).toContain('capacity:model');
    expect(projection.projects.beta).not.toHaveProperty('queueHead');
    expect(JSON.stringify(projection)).not.toMatch(/prompt|message|memory|artifact|evidence|title/iu);
  });
});

function project(projectId: string, lane: 'normal' | 'low', weight: number, hardBudgetMicros: number) {
  return { projectId, revision: 1, lane, weight, hardBudgetMicros, allowedPools: ['model'],
    maxOutstandingRequests: 4, maxConcurrentGrants: 1, burstLimit: 2, starvationTicks: 3,
    status: 'active' as const };
}

function capacityRequest(requestId: string, projectId: string): PortfolioCapacityRequest {
  return {
    requestId, projectId, workRef: { runId: `run:${projectId}`, profileRevisionId: 'profile:1', profileDigest: SHA },
    schedulerRevision: 'scheduler:1', schedulerSequence: 1, localOrder: 1,
    projectPolicyRevision: 1, opaqueHeadId: `head:${requestId}`, payloadDigest: SHA,
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 2, rateUnits: 1, budgetUnits: 1 }] },
    preemptibility: 'checkpointable', starvationAt: 10,
  };
}

function bundleAuthority() {
  return { requestDigest: SHA, resourceBundleDigest: SHA, catalogGenerationId: 'catalog:1',
    catalogRevision: 1, catalogDigest: SHA, profileRevisionId: 'profile:1', profileDigest: SHA,
    profileCeilingDigest: SHA, validatedBundleDigest: SHA, reservedCostMicros: 10 };
}
