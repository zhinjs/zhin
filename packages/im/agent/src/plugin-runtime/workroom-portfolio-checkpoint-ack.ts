import type {
  PortfolioControlAck,
  PortfolioControlOutboxItem,
} from '../portfolio/capacity-control-outbox.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import {
  readWorkroomPreemptionCheckpointAck,
  replayWorkroomPreemptions,
  type WorkroomPreemptionCheckpointAck,
} from '../workroom/workroom-preemption.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type {
  PortfolioWorkroomAckAuthorityPort,
  PortfolioWorkroomControlDeliveryPort,
} from './workroom-portfolio-control-runtime.js';
import { createToken } from '@zhin.js/plugin-runtime';

export const workroomPortfolioCheckpointAckAdapterToken = createToken<WorkroomPortfolioCheckpointAckAdapter>(
  'zhin.agent.workroom-portfolio-checkpoint-ack-adapter',
  'P2 persisted checkpoint fact to P11 Portfolio reclaim acknowledgement adapter',
);

export interface WorkroomPersistedCheckpointAckReaderPort {
  find(input: Readonly<{
    projectId: string;
    assignmentId: string;
  }>): Promise<WorkroomPreemptionCheckpointAck | undefined>;
}

export class PortfolioCheckpointAckPendingError extends Error {
  constructor(readonly itemId: string) {
    super(`Persisted Workroom checkpoint acknowledgement is pending for ${itemId}`);
    this.name = 'PortfolioCheckpointAckPendingError';
  }
}

export class PortfolioGrantAcceptanceUnavailableError extends Error {
  constructor(readonly itemId: string) {
    super(`Portfolio Grant acceptance requires the owning Assignment claim adapter for ${itemId}`);
    this.name = 'PortfolioGrantAcceptanceUnavailableError';
  }
}

/** Reads only P2 persisted facts; it never writes or completes a Kernel Assignment. */
export class JournalWorkroomPreemptionCheckpointAckReader
implements WorkroomPersistedCheckpointAckReaderPort {
  constructor(readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>) {}

  async find(input: Readonly<{
    projectId: string;
    assignmentId: string;
  }>): Promise<WorkroomPreemptionCheckpointAck | undefined> {
    const matches: WorkroomPreemptionCheckpointAck[] = [];
    for (const runId of [...await this.journal.listRunIds()].sort()) {
      const events = await this.journal.read(runId);
      const projection = replayWorkroomPreemptions(events);
      for (const state of Object.values(projection.byDecisionId)) {
        if (state.status !== 'takeover_ready' || state.projectId !== input.projectId
          || state.assignmentId !== input.assignmentId) continue;
        const ack = readWorkroomPreemptionCheckpointAck(events, state.decisionId);
        if (ack) matches.push(ack);
      }
    }
    if (matches.length > 1) {
      throw new Error('Multiple persisted Workroom checkpoint acknowledgements match one Portfolio Reclaim');
    }
    return matches[0];
  }
}

/** Exact P2 checkpoint fact -> P11 delivery ack adapter. */
export class WorkroomPortfolioCheckpointAckAdapter
implements PortfolioWorkroomControlDeliveryPort, PortfolioWorkroomAckAuthorityPort {
  constructor(readonly reader: WorkroomPersistedCheckpointAckReaderPort) {}

  deliver(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck> {
    signal.throwIfAborted();
    return this.#resolve(item);
  }

  reconcile(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck> {
    signal.throwIfAborted();
    return this.#resolve(item);
  }

  async authenticate(item: PortfolioControlOutboxItem, ack: PortfolioControlAck): Promise<boolean> {
    if (item.payload.kind !== 'reclaim_request' || ack.kind !== 'reclaim_acknowledged') return false;
    try {
      return canonicalWorkroomJson(await this.#resolve(item)) === canonicalWorkroomJson(ack);
    } catch {
      return false;
    }
  }

  async #resolve(item: PortfolioControlOutboxItem): Promise<PortfolioControlAck> {
    if (item.payload.kind !== 'reclaim_request') {
      throw new PortfolioGrantAcceptanceUnavailableError(item.itemId);
    }
    const assignmentId = item.payload.grant.assignmentRef;
    if (!assignmentId) throw new Error('Portfolio Reclaim Grant has no exact Assignment ref');
    const persisted = await this.reader.find({ projectId: item.projectId, assignmentId });
    if (!persisted) throw new PortfolioCheckpointAckPendingError(item.itemId);
    const body = deepFreeze({
      version: 1 as const,
      kind: 'reclaim_acknowledged' as const,
      ackId: `portfolio-checkpoint-ack:${persisted.digest.slice('sha256:'.length)}`,
      portfolioId: item.portfolioId,
      projectId: item.projectId,
      itemId: item.itemId,
      grantId: item.payload.grant.grantId,
      reclaimId: item.payload.reclaim.reclaimId,
      grantFence: item.payload.grant.fence,
      deliveryFence: item.deliveryFence,
      assignmentRef: persisted.assignmentId,
      assignmentAttempt: persisted.assignmentAttempt,
      assignmentFence: persisted.assignmentFence,
      outcome: 'checkpointed' as const,
      checkpoint: persisted.checkpoint,
      producer: persisted.producer,
      observedAt: persisted.acknowledgedAt,
    });
    return deepFreeze({ ...body, digest: digest(body) });
  }
}
