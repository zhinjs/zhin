import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePortfolioControlOutboxRepository } from '../../src/portfolio/file-capacity-control-outbox.js';
import {
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
  type PortfolioControlCompensation,
} from '../../src/portfolio/capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { PortfolioCapacityGrant, PortfolioFact } from '../../src/portfolio/portfolio-journal.js';

describe('File Portfolio Capacity control outbox', () => {
  it('recovers a durable scanner cursor and exact source identity after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-portfolio-control-'));
    const directory = join(root, 'outbox');
    await mkdir(root, { recursive: true });
    const grant = capacityGrant();
    const fact = grantFact(grant);
    const item = createPortfolioControlItem(fact, grant, route('project-a'));
    const first = new FilePortfolioControlOutboxRepository(directory);
    await first.append('portfolio-main', -1, {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
      },
    });
    const restarted = new FilePortfolioControlOutboxRepository(directory);
    expect(replayPortfolioControlOutbox('portfolio-main', await restarted.read('portfolio-main')))
      .toMatchObject({ sourceCursor: 0, items: { [item.itemId]: { sourceEventDigest: digest(fact) } } });
    expect(await readdir(directory)).toHaveLength(1);
    await expect(restarted.append('portfolio-main', -1, {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
      },
    })).rejects.toThrow('sequence conflict');
  });

  it('recovers outcome_unknown into one durable compensated tombstone after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-portfolio-compensation-'));
    const directory = join(root, 'outbox');
    const grant = capacityGrant();
    const fact = grantFact(grant);
    const item = createPortfolioControlItem(fact, grant, route(grant.projectId));
    const first = new FilePortfolioControlOutboxRepository(directory);
    await first.append('portfolio-main', -1, { type: 'source.scanned', payload: {
      sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
    } });
    await first.append('portfolio-main', 0, { type: 'item.claimed', payload: {
      itemId: item.itemId, workerId: 'worker:1', deliveryFence: 1, claimedAt: 1, claimExpiresAt: 3,
    } });
    await first.append('portfolio-main', 1, { type: 'item.outcome_unknown', payload: {
      itemId: item.itemId, deliveryFence: 1, observedAt: 2,
    } });
    const compensation = compensated(item.itemId);
    await first.append('portfolio-main', 2, { type: 'item.compensated', payload: {
      itemId: item.itemId, deliveryFence: 1, compensation,
    } });

    const restarted = new FilePortfolioControlOutboxRepository(directory);
    expect(replayPortfolioControlOutbox('portfolio-main', await restarted.read('portfolio-main')))
      .toMatchObject({ sequence: 3, items: { [item.itemId]: {
        status: 'closed', deliveryFence: 1, compensation,
      } } });
    await expect(restarted.append('portfolio-main', 2, { type: 'item.compensated', payload: {
      itemId: item.itemId, deliveryFence: 1, compensation,
    } })).rejects.toThrow('sequence conflict');
  });
});

function compensated(itemId: string): PortfolioControlCompensation {
  const body = { version: 1 as const, itemId, portfolioId: 'portfolio-main', projectId: 'project-a',
    grantId: 'grant-1', grantFence: 4, deliveryFence: 1, assignmentRef: 'assignment:stale',
    reason: 'task_stale' as const, kernelSequence: 17, kernelFactDigest: sha('a'), proofDigest: sha('b') };
  return { ...body, digest: digest(body) };
}

function capacityGrant(): PortfolioCapacityGrant {
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
function grantFact(grant: PortfolioCapacityGrant): Extract<PortfolioFact, { type: 'capacity.grant_offered' }> {
  return { version: 1, portfolioId: 'portfolio-main', sequence: 0,
    eventId: 'capacity.grant_offered:grant-1', occurredAt: 1,
    type: 'capacity.grant_offered', payload: { grant } };
}
function route(projectId: string) {
  return { projectId, routeRef: 'workroom-route:1', routeDigest: sha('8'),
    authorityRef: 'catalog:1', authorityDigest: sha('9') };
}
function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
