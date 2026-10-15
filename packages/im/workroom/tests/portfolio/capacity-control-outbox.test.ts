import {
  MemoryPortfolioControlOutboxRepository,
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
  type PortfolioControlAck,
  type PortfolioControlOutboxEventDraft,
} from '../../src/portfolio/capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { capacityGrant, grantAck, grantFact, route, sha } from './capacity-control-outbox-fixture.js';

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
