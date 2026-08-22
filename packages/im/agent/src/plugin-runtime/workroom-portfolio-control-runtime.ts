import { createToken } from '@zhin.js/plugin-runtime';
import {
  createPortfolioControlItem,
  createPortfolioControlOutboxEvent,
  replayPortfolioControlOutbox,
  type PortfolioControlAck,
  type PortfolioControlOutboxEventDraft,
  type PortfolioControlOutboxItem,
  type PortfolioControlOutboxRepository,
  type PortfolioWorkroomRoute,
} from '../portfolio/capacity-control-outbox.js';
import { replayPortfolioAdmission } from '../portfolio/portfolio-admission.js';
import type { PortfolioFact, PortfolioJournalRepository } from '../portfolio/portfolio-journal.js';
import type { GenerationOwnedPortfolioCapacityRuntime } from './workroom-portfolio-capacity.js';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import { PortfolioGrantAssignmentCompensatedError } from './workroom-portfolio-grant-assignment.js';

export interface PortfolioWorkroomRouteAuthorityPort {
  resolve(input: Readonly<{
    portfolioId: string; projectId: string; grantId: string; requestId: string; grantFence: number;
  }>): Promise<PortfolioWorkroomRoute | undefined>;
}

export interface PortfolioWorkroomControlDeliveryPort {
  deliver(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck>;
  reconcile(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck>;
}

export interface PortfolioWorkroomAckAuthorityPort {
  authenticate(item: PortfolioControlOutboxItem, ack: PortfolioControlAck): Promise<boolean>;
}

export const portfolioWorkroomRouteAuthorityToken = createToken<PortfolioWorkroomRouteAuthorityPort>(
  'zhin.agent.portfolio-workroom-route-authority',
  'Project-owned exact Workroom route for Capacity Grant/Reclaim control',
);
export const portfolioWorkroomControlDeliveryToken = createToken<PortfolioWorkroomControlDeliveryPort>(
  'zhin.agent.portfolio-workroom-control-delivery',
  'Typed idempotent owning Workroom Grant/Reclaim delivery and reconciliation',
);
export const portfolioWorkroomAckAuthorityToken = createToken<PortfolioWorkroomAckAuthorityPort>(
  'zhin.agent.portfolio-workroom-ack-authority',
  'Authenticated Assignment attempt/fence/checkpoint acknowledgement authority',
);
export const portfolioControlOutboxRepositoryToken = createToken<PortfolioControlOutboxRepository>(
  'zhin.agent.portfolio-control-outbox-repository',
  'Activatable durable Portfolio Grant/Reclaim delivery outbox',
);

export interface WorkroomPortfolioControlRuntimeOptions {
  readonly generation: number;
  readonly workerId: string;
  readonly journal: Pick<PortfolioJournalRepository, 'listPortfolioIds' | 'read'>;
  readonly outbox: PortfolioControlOutboxRepository;
  readonly capacity: Pick<GenerationOwnedPortfolioCapacityRuntime, 'consume' | 'acknowledgeReclaim'>;
  readonly route: PortfolioWorkroomRouteAuthorityPort;
  readonly delivery: PortfolioWorkroomControlDeliveryPort;
  readonly acknowledgements: PortfolioWorkroomAckAuthorityPort;
}

/** Durable source scanner + two-phase owning Workroom control worker. */
export class WorkroomPortfolioControlRuntime {
  constructor(readonly options: WorkroomPortfolioControlRuntimeOptions) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) throw new Error('generation is invalid');
    if (!options.workerId.trim()) throw new Error('workerId is invalid');
  }

  async drain(signal: AbortSignal): Promise<number> {
    let acknowledged = 0;
    for (const portfolioId of [...await this.options.journal.listPortfolioIds()].sort()) {
      signal.throwIfAborted();
      await this.#scan(portfolioId);
      acknowledged += await this.#deliver(portfolioId, signal);
    }
    return acknowledged;
  }

  async #scan(portfolioId: string): Promise<void> {
    const facts = await this.options.journal.read(portfolioId);
    const latestAdmission = replayPortfolioAdmission(portfolioId, facts);
    let outbox = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
    for (let sequence = outbox.sourceCursor + 1; sequence < facts.length; sequence += 1) {
      const fact = facts[sequence]!;
      let item: PortfolioControlOutboxItem | undefined;
      if (fact.type === 'capacity.grant_offered' || fact.type === 'capacity.reclaim_requested') {
        const state = replayPortfolioAdmission(portfolioId, facts.slice(0, sequence + 1));
        const grant = fact.type === 'capacity.grant_offered'
          ? fact.payload.grant
          : state.grants[fact.payload.reclaim.grantId];
        if (!grant) throw new Error('Portfolio Control source Grant is absent');
        const route = await this.options.route.resolve({
          portfolioId, projectId: grant.projectId, grantId: grant.grantId,
          requestId: grant.requestId, grantFence: grant.fence,
        });
        // The source Grant/Reclaim fact is itself the durable blocker. Keep the
        // scanner cursor before it so a later generation/provider can recover
        // without writing one blocker event per tick or failing Host startup.
        if (!route) {
          const latestGrant = latestAdmission.grants[grant.grantId];
          const latestReclaim = fact.type === 'capacity.reclaim_requested'
            ? latestAdmission.reclaims[fact.payload.reclaim.reclaimId]
            : undefined;
          const sourceStillActionable = fact.type === 'capacity.grant_offered'
            ? latestGrant?.status === 'offered'
            : latestReclaim?.status === 'pending';
          if (sourceStillActionable) return;
        } else {
          item = createPortfolioControlItem(fact, grant, route);
        }
      }
      await this.#append(portfolioId, {
        type: 'source.scanned', payload: {
          sourceSequence: fact.sequence,
          sourceEventId: fact.eventId,
          sourceEventDigest: factDigest(fact),
          ...(item ? { item } : {}),
        },
      });
      outbox = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
    }
  }

  async #deliver(portfolioId: string, signal: AbortSignal): Promise<number> {
    let count = 0;
    let state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
    const facts = await this.options.journal.read(portfolioId);
    const admission = replayPortfolioAdmission(portfolioId, facts);
    for (const itemId of Object.keys(state.items).sort()) {
      signal.throwIfAborted();
      let item = state.items[itemId]!;
      if (item.status === 'acknowledged' || item.status === 'closed') continue;
      if (item.status === 'pending') {
        const terminal = terminalFact(item, facts);
        if (terminal) {
          await this.#append(portfolioId, {
            type: 'item.closed', payload: {
              itemId,
              reason: terminal.reason,
              closedAt: terminal.fact.occurredAt,
              terminalSourceSequence: terminal.fact.sequence,
              terminalSourceEventId: terminal.fact.eventId,
              terminalSourceEventDigest: factDigest(terminal.fact),
            },
          });
          state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
          continue;
        }
      }
      if (item.status === 'dispatching') {
        if (item.claimExpiresAt! > admission.now) continue;
        await this.#append(portfolioId, {
          type: 'item.outcome_unknown', payload: {
            itemId, deliveryFence: item.deliveryFence, observedAt: admission.now,
          },
        });
        state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
        item = state.items[itemId]!;
      }
      if (item.status === 'pending') {
        const deadline = item.payload.kind === 'grant_offer'
          ? item.payload.grant.offerExpiresAt
          : item.payload.reclaim.deadline;
        if (deadline <= admission.now) continue;
        await this.#append(portfolioId, {
          type: 'item.claimed', payload: {
            itemId, workerId: this.options.workerId, deliveryFence: item.deliveryFence + 1,
            claimedAt: admission.now, claimExpiresAt: deadline,
          },
        });
        state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
        item = state.items[itemId]!;
      }
      let ack: PortfolioControlAck;
      try {
        ack = item.status === 'outcome_unknown'
          ? await this.options.delivery.reconcile(item, signal)
          : await this.options.delivery.deliver(item, signal);
      } catch (error) {
        if (error instanceof PortfolioGrantAssignmentCompensatedError) {
          await this.#append(portfolioId, {
            type: 'item.compensated', payload: {
              itemId, deliveryFence: item.deliveryFence, compensation: error.compensation,
            },
          });
          count += 1;
          state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
          continue;
        }
        if (item.status === 'dispatching') await this.#append(portfolioId, {
          type: 'item.outcome_unknown', payload: {
            itemId, deliveryFence: item.deliveryFence, observedAt: admission.now,
          },
        });
        continue;
      }
      if (!await this.options.acknowledgements.authenticate(item, ack)) {
        throw new Error('Owning Workroom acknowledgement is unauthenticated');
      }
      // Validate the full ack before making any Portfolio state change.
      const validationDraft: PortfolioControlOutboxEventDraft = {
        type: 'item.acknowledged', payload: { itemId, deliveryFence: item.deliveryFence, ack },
      };
      const probeEvents = await this.options.outbox.read(portfolioId);
      replayPortfolioControlOutbox(portfolioId, [
        ...probeEvents,
        createPortfolioControlOutboxEvent(portfolioId, probeEvents.length, validationDraft),
      ]);
      if (ack.kind === 'grant_accepted') {
        await this.options.capacity.consume({
          generation: this.options.generation, portfolioId, grantId: ack.grantId,
          projectId: ack.projectId, fence: ack.grantFence, assignmentRef: ack.assignmentRef,
        });
      } else {
        await this.options.capacity.acknowledgeReclaim({
          generation: this.options.generation, portfolioId, reclaimId: ack.reclaimId,
          projectId: ack.projectId, fence: ack.grantFence, outcome: ack.outcome,
          ...(ack.checkpoint ? { checkpointRef: ack.checkpoint.ref } : {}),
          ...(ack.checkpoint ? { checkpointDigest: ack.checkpoint.digest } : {}),
        });
      }
      await this.#append(portfolioId, validationDraft);
      count += 1;
      state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
    }
    return count;
  }

  async #append(portfolioId: string, draft: PortfolioControlOutboxEventDraft): Promise<void> {
    const state = replayPortfolioControlOutbox(portfolioId, await this.options.outbox.read(portfolioId));
    await this.options.outbox.append(portfolioId, state.sequence, draft);
  }
}

function factDigest(fact: PortfolioFact): string {
  return digest(fact);
}

function terminalFact(
  item: PortfolioControlOutboxItem,
  facts: readonly PortfolioFact[],
): Readonly<{
  reason: 'offer_expired' | 'reclaim_timed_out';
  fact: PortfolioFact;
}> | undefined {
  if (item.payload.kind === 'grant_offer') {
    const fact = facts.find(candidate => candidate.type === 'capacity.grant_expired'
      && candidate.payload.grantId === item.payload.grant.grantId
      && candidate.payload.fence === item.payload.grant.fence);
    return fact ? { reason: 'offer_expired', fact } : undefined;
  }
  const { reclaim, grant } = item.payload;
  const fact = facts.find(candidate => candidate.type === 'capacity.reclaim_timed_out'
    && candidate.payload.reclaimId === reclaim.reclaimId
    && candidate.payload.grantId === grant.grantId
    && candidate.payload.fence === grant.fence);
  return fact ? { reason: 'reclaim_timed_out', fact } : undefined;
}
