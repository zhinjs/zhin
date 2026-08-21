import {
  MemoryPortfolioControlOutboxRepository,
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
  type PortfolioControlAck,
  type PortfolioControlOutboxEventDraft,
} from '../../src/portfolio/capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { PortfolioCapacityGrant, PortfolioFact } from '../../src/portfolio/portfolio-journal.js';

describe('Portfolio Capacity control outbox', () => {
  it('binds source sequence/digest, Project route and authenticated Assignment ack', async () => {
    const grant = capacityGrant();
    const fact = grantFact(grant);
    const item = createPortfolioControlItem(fact, grant, route('project-a'));
    const repository = new MemoryPortfolioControlOutboxRepository();
    await append(repository, 'portfolio-main', {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
      },
    });
    await append(repository, 'portfolio-main', {
      type: 'item.claimed', payload: {
        itemId: item.itemId, workerId: 'worker-1', deliveryFence: 1, claimedAt: 1, claimExpiresAt: 3,
      },
    });
    const claimed = replayPortfolioControlOutbox('portfolio-main', await repository.read('portfolio-main')).items[item.itemId]!;
    const ack = grantAck(claimed);
    await append(repository, 'portfolio-main', {
      type: 'item.acknowledged', payload: { itemId: item.itemId, deliveryFence: 1, ack },
    });
    expect(replayPortfolioControlOutbox('portfolio-main', await repository.read('portfolio-main')))
      .toMatchObject({ sourceCursor: 0, items: { [item.itemId]: { status: 'acknowledged' } } });
    expect(() => createPortfolioControlItem(fact, grant, route('project-b'))).toThrow('Project');
    await expect(append(repository, 'portfolio-main', {
      type: 'source.scanned', payload: {
        sourceSequence: 2, sourceEventId: 'gap', sourceEventDigest: sha('1'),
      },
    })).rejects.toThrow('cursor gap');

    const leakedDraft = {
      type: 'source.scanned' as const,
      payload: {
        sourceSequence: 1, sourceEventId: 'leak', sourceEventDigest: sha('2'),
        prompt: 'governed Workroom content must not enter Portfolio control',
      },
    };
    await expect(append(repository, 'portfolio-main', leakedDraft)).rejects.toThrow('exact schema');
  });
});

async function append(
  repository: MemoryPortfolioControlOutboxRepository,
  portfolioId: string,
  draft: PortfolioControlOutboxEventDraft,
) {
  const state = replayPortfolioControlOutbox(portfolioId, await repository.read(portfolioId));
  return await repository.append(portfolioId, state.sequence, draft);
}

export function capacityGrant(): PortfolioCapacityGrant {
  return {
    grantId: 'grant-1', requestId: 'request-1', projectId: 'project-a', fence: 4,
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 }] },
    requestDigest: sha('1'), resourceBundleDigest: sha('2'), catalogGenerationId: 'catalog-generation:1',
    catalogRevision: 1, catalogDigest: sha('3'), profileRevisionId: 'profile:1', profileDigest: sha('4'),
    profileCeilingDigest: sha('5'), validatedBundleDigest: sha('6'), reservedCostMicros: 10,
    portfolioPolicyRevision: 1, portfolioPolicyDigest: sha('7'), projectPolicyRevision: 1,
    lane: 'normal', issuedAt: 1, issuedSequence: 0, offerExpiresAt: 3, status: 'offered',
  };
}

export function grantFact(grant: PortfolioCapacityGrant): Extract<PortfolioFact, { type: 'capacity.grant_offered' }> {
  return {
    version: 1, portfolioId: 'portfolio-main', sequence: 0, eventId: 'capacity.grant_offered:grant-1',
    occurredAt: 1, type: 'capacity.grant_offered', payload: { grant },
  };
}

export function route(projectId: string) {
  return { projectId, routeRef: 'workroom-route:1', routeDigest: sha('8'),
    authorityRef: 'catalog:1', authorityDigest: sha('9') };
}

export function grantAck(item: ReturnType<typeof replayPortfolioControlOutbox>['items'][string]): PortfolioControlAck {
  if (item.payload.kind !== 'grant_offer') throw new Error('test expects grant');
  const body = {
    version: 1 as const, kind: 'grant_accepted' as const, ackId: 'ack-1', portfolioId: item.portfolioId,
    projectId: item.projectId, itemId: item.itemId, grantId: item.payload.grant.grantId,
    requestId: item.payload.grant.requestId, grantFence: item.payload.grant.fence,
    deliveryFence: item.deliveryFence, assignmentRef: 'assignment-1', assignmentAttempt: 2,
    assignmentFence: 9, producer: { principalId: 'workroom-kernel:project-a',
      authorityRef: 'kernel-authority:1', authorityDigest: sha('a') }, observedAt: 2,
  };
  return { ...body, digest: digest(body) };
}

export function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
