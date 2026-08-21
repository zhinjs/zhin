import {
  WorkroomPortfolioSponsorRuntime,
  createCatalogPortfolioSponsorCommandAuthority,
  type PortfolioSponsorCommandAuthorityPort,
} from '../../src/plugin-runtime/workroom-portfolio-sponsor.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  type PortfolioGovernanceProof,
  type PortfolioProjectPolicy,
} from '../../src/portfolio/portfolio-journal.js';
import { PortfolioAdmissionApplication } from '../../src/portfolio/portfolio-admission.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Workroom Portfolio Sponsor Runtime', () => {
  it('requires the authenticated principal in every current Catalog Project Sponsor set', async () => {
    const authority = createCatalogPortfolioSponsorCommandAuthority({
      read: async () => ({ revision: 'catalog-revision:7', definitions: {
        alpha: { name: 'Alpha', members: [], sponsors: ['human:alice'] },
        beta: { name: 'Beta', members: [], sponsors: ['human:alice'] },
      } }),
    });
    const input = {
      generation: 7, portfolioId: 'portfolio-main', sourceSequence: 3,
      command: { kind: 'transfer_budget' as const, commandId: 'transfer:catalog',
        fromProjectId: 'alpha', toProjectId: 'beta', amountMicros: 1,
        expectedFromRevision: 1, expectedToRevision: 1 },
      commandDigest: SHA,
      projectCandidates: [project('alpha', 99), project('beta', 51)],
    };
    await expect(authority.authorize({ ...input,
      authenticatedPrincipal: { principalId: 'human:mallory' },
    })).resolves.toBeUndefined();
    await expect(authority.authorize({ ...input,
      authenticatedPrincipal: { principalId: 'human:alice' },
    })).resolves.toMatchObject({
      authorizedBy: expect.stringContaining('catalog-revision%3A7'),
      projectProofs: { alpha: { principalId: 'human:alice', expectedRevision: 0 } },
    });
  });

  it('atomically transfers budget with exact Sponsor proofs and conserved total', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const application = new PortfolioAdmissionApplication({
      portfolioId: 'portfolio-main', repository,
      ids: { eventId: (type, identity) => `${type}:${identity}` },
    });
    const snapshot = policy();
    await application.pinPolicy(snapshot, proof(snapshot.digest, 0));
    const runtime = new WorkroomPortfolioSponsorRuntime({
      generation: 7, repository, authority: sponsorAuthority(),
    });

    const projection = await runtime.execute('portfolio-main', {
      kind: 'transfer_budget', commandId: 'transfer:1', fromProjectId: 'alpha', toProjectId: 'beta',
      amountMicros: 20, expectedFromRevision: 1, expectedToRevision: 1,
    }, sponsorPrincipal());
    expect(projection.projects).toMatchObject({
      alpha: { policyRevision: 2, budget: { limitMicros: 80 } },
      beta: { policyRevision: 2, budget: { limitMicros: 70 } },
    });
    const facts = await repository.read('portfolio-main');
    expect(facts.slice(-2).map(fact => [fact.type, fact.payload])).toMatchObject([
      ['project.policy_updated', { policy: { projectId: 'alpha', revision: 2, hardBudgetMicros: 80 } }],
      ['project.policy_updated', { policy: { projectId: 'beta', revision: 2, hardBudgetMicros: 70 } }],
    ]);
  });

  it('supports typed pause/resume but rejects discussion-shaped writes', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const application = new PortfolioAdmissionApplication({
      portfolioId: 'portfolio-main', repository,
      ids: { eventId: (type, identity) => `${type}:${identity}` },
    });
    const snapshot = policy();
    await application.pinPolicy(snapshot, proof(snapshot.digest, 0));
    const runtime = new WorkroomPortfolioSponsorRuntime({
      generation: 7, repository, authority: sponsorAuthority(),
    });
    expect((await runtime.execute('portfolio-main', {
      kind: 'set_lane', commandId: 'lane:1', projectId: 'alpha',
      expectedProjectRevision: 1, lane: 'urgent',
    }, sponsorPrincipal())).projects.alpha?.lane).toBe('urgent');
    expect((await runtime.execute('portfolio-main', {
      kind: 'set_status', commandId: 'pause:1', projectId: 'alpha',
      expectedProjectRevision: 2, status: 'paused',
    }, sponsorPrincipal())).projects.alpha?.status).toBe('paused');
    expect((await runtime.execute('portfolio-main', {
      kind: 'set_status', commandId: 'resume:1', projectId: 'alpha',
      expectedProjectRevision: 3, status: 'active',
    }, sponsorPrincipal())).projects.alpha?.status).toBe('active');
    const beforeDiscussion = (await repository.read('portfolio-main')).length;
    const discussionWrite = {
      kind: 'set_status' as const, commandId: 'discussion:1', projectId: 'alpha',
      expectedProjectRevision: 4, status: 'paused' as const, discussion: 'please pause it',
    };
    await expect(runtime.execute('portfolio-main', discussionWrite, sponsorPrincipal())).rejects.toThrow('exact schema');
    expect(await repository.read('portfolio-main')).toHaveLength(beforeDiscussion);
  });
});

function sponsorPrincipal() { return { principalId: 'sponsor:main' }; }

function sponsorAuthority(): PortfolioSponsorCommandAuthorityPort {
  return {
    authorize: async input => ({
      commandDigest: input.commandDigest,
      sourceSequence: input.sourceSequence,
      authorizedBy: 'portfolio-sponsor-authority:1',
      projectProofs: Object.fromEntries(input.projectCandidates.map(candidate => [
        candidate.projectId,
        proof(digest(candidate), candidate.revision - 1),
      ])),
    }),
  };
}

function policy() {
  return createPortfolioPolicySnapshot({
    revision: 1, globalBudgetMicros: 1_000, offerTtlTicks: 2, leaseTtlTicks: 5,
    leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
    reclaimTtlTicks: 2,
    pools: { model: { poolId: 'model', capacityUnits: 2, rateUnitsPerWindow: 100,
      rateWindowTicks: 10, priceMicrosPerBudgetUnit: 10 } },
    projects: { alpha: project('alpha', 100), beta: project('beta', 50) },
  });
}

function project(projectId: string, hardBudgetMicros: number): PortfolioProjectPolicy {
  return { projectId, revision: 1, lane: 'normal', weight: 1, hardBudgetMicros,
    allowedPools: ['model'], maxOutstandingRequests: 4, maxConcurrentGrants: 1,
    burstLimit: 2, starvationTicks: 3, status: 'active' };
}

function proof(targetDigest: string, expectedRevision: number): PortfolioGovernanceProof {
  return { principalId: 'sponsor:main', authorizedBy: 'portfolio-authority:1', reasonDigest: SHA,
    targetDigest, expectedRevision };
}
