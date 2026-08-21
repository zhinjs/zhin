import {
  PortfolioCheckpointAckPendingError,
  WorkroomPortfolioCheckpointAckAdapter,
} from '../../src/plugin-runtime/workroom-portfolio-checkpoint-ack.js';
import {
  createPortfolioControlItem,
  createPortfolioControlOutboxEvent,
  replayPortfolioControlOutbox,
} from '../../src/portfolio/capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { PortfolioCapacityGrant, PortfolioFact } from '../../src/portfolio/portfolio-journal.js';
import type { WorkroomPreemptionCheckpointAck } from '../../src/workroom/workroom-preemption.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Workroom Portfolio checkpoint acknowledgement adapter', () => {
  it('turns one exact persisted P2 takeover checkpoint into an authenticated P11 ack', async () => {
    const item = dispatchingReclaimItem();
    const persisted = checkpointAck();
    const adapter = new WorkroomPortfolioCheckpointAckAdapter({ find: async () => persisted });

    const ack = await adapter.deliver(item, new AbortController().signal);
    expect(ack).toMatchObject({
      kind: 'reclaim_acknowledged', assignmentRef: 'assignment:alpha', assignmentAttempt: 2,
      assignmentFence: 7, outcome: 'checkpointed', checkpoint: persisted.checkpoint,
      producer: persisted.producer, deliveryFence: 1,
    });
    await expect(adapter.authenticate(item, ack)).resolves.toBe(true);
    await expect(adapter.authenticate(item, { ...ack, observedAt: 999 })).resolves.toBe(false);
  });

  it('stays pending without a persisted P2 acknowledgement', async () => {
    const item = dispatchingReclaimItem();
    const adapter = new WorkroomPortfolioCheckpointAckAdapter({ find: async () => undefined });
    await expect(adapter.reconcile(item, new AbortController().signal))
      .rejects.toBeInstanceOf(PortfolioCheckpointAckPendingError);
  });
});

function dispatchingReclaimItem() {
  const grant = capacityGrant();
  const fact: Extract<PortfolioFact, { type: 'capacity.reclaim_requested' }> = {
    version: 1, portfolioId: 'portfolio-main', sequence: 0,
    eventId: 'reclaim:1', occurredAt: 10, type: 'capacity.reclaim_requested',
    payload: { reclaim: { reclaimId: 'reclaim:1', grantId: grant.grantId,
      projectId: grant.projectId, requestedAt: 10, deadline: 20,
      reason: 'higher_portfolio_priority', status: 'pending' } },
    digest: SHA,
  };
  const pending = createPortfolioControlItem(fact, grant, {
    projectId: 'alpha', routeRef: 'workroom:alpha', routeDigest: SHA,
    authorityRef: 'catalog:7', authorityDigest: SHA,
  });
  const scanned = createPortfolioControlOutboxEvent('portfolio-main', 0, {
    type: 'source.scanned', payload: {
      sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item: pending,
    },
  });
  const claimed = createPortfolioControlOutboxEvent('portfolio-main', 1, {
    type: 'item.claimed', payload: {
      itemId: pending.itemId, workerId: 'worker:7', deliveryFence: 1,
      claimedAt: 10, claimExpiresAt: 20,
    },
  });
  return replayPortfolioControlOutbox('portfolio-main', [scanned, claimed]).items[pending.itemId]!;
}

function checkpointAck(): WorkroomPreemptionCheckpointAck {
  const body = {
    version: 1 as const, decisionId: 'preemption:1', projectId: 'alpha', runId: 'run:alpha',
    victimTaskKey: 'background', reservedTaskKey: 'urgent', assignmentId: 'assignment:alpha',
    assignmentAttempt: 2, assignmentFence: 7, takeoverFence: 8, envelopeDigest: SHA,
    observationId: 'observation:1', observationDigest: SHA,
    checkpoint: { ref: 'checkpoint:alpha:1', digest: SHA },
    producer: { principalId: 'executor:alpha', authorityRef: 'assignment-envelope:alpha', authorityDigest: SHA },
    acknowledgedAt: 12,
  };
  return { ...body, digest: digest(body) };
}

function capacityGrant(): PortfolioCapacityGrant {
  return {
    grantId: 'grant:alpha', requestId: 'request:alpha', projectId: 'alpha', fence: 3,
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 }] },
    requestDigest: SHA, resourceBundleDigest: SHA, catalogGenerationId: 'catalog-generation:7',
    catalogRevision: 7, catalogDigest: SHA, profileRevisionId: 'profile:7', profileDigest: SHA,
    profileCeilingDigest: SHA, validatedBundleDigest: SHA, reservedCostMicros: 10,
    portfolioPolicyRevision: 1, portfolioPolicyDigest: SHA, projectPolicyRevision: 1,
    lane: 'normal', issuedAt: 1, issuedSequence: 2, offerExpiresAt: 5,
    status: 'reclaim_requested', consumedAt: 2, leaseExpiresAt: 20,
    assignmentRef: 'assignment:alpha', maxLeaseExpiresAt: 30, renewalCount: 0,
  };
}
