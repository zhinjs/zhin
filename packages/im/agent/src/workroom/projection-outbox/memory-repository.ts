import type {
  WorkroomProjectionBinding,
  WorkroomProjectionCapture,
  WorkroomProjectionDeliveryResult,
  WorkroomProjectionOutboxItem,
  WorkroomProjectionRepository,
  WorkroomProjectionState,
} from './contracts.js';
import { WorkroomProjectionRevisionConflictError } from './contracts.js';
import {
  applyBinding,
  applyCapture,
  applyClaim,
  applySettlement,
  emptyProjectionState,
} from './repository-state.js';

export class MemoryWorkroomProjectionRepository implements WorkroomProjectionRepository {
  #state: WorkroomProjectionState = emptyProjectionState();

  async read(): Promise<WorkroomProjectionState> {
    return this.#state;
  }

  async bind(expectedRevision: number, binding: WorkroomProjectionBinding) {
    this.#assertRevision(expectedRevision);
    this.#state = applyBinding(this.#state, binding);
    return this.#state;
  }

  async capture(
    expectedRevision: number,
    input: WorkroomProjectionCapture,
  ): Promise<WorkroomProjectionState> {
    if (this.#state.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, this.#state.revision);
    }
    this.#state = applyCapture(this.#state, input);
    return this.#state;
  }

  async claimNext(expectedRevision: number, workerId: string, now: number, leaseMs: number) {
    this.#assertRevision(expectedRevision);
    const claimed = applyClaim(this.#state, workerId, now, leaseMs);
    if (!claimed) return undefined;
    this.#state = claimed.state;
    return claimed.item;
  }

  async settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ) {
    this.#assertRevision(expectedRevision);
    this.#state = applySettlement(this.#state, itemId, workerId, fence, result, settledAt);
    return this.#state;
  }

  #assertRevision(expectedRevision: number): void {
    if (this.#state.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, this.#state.revision);
    }
  }
}

/** Crash-durable, cross-process CAS snapshots for one Projection binding. */
