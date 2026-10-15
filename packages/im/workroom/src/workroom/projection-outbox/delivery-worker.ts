import type {
  WorkroomProjectionDeliveryPort,
  WorkroomProjectionDeliveryResult,
  WorkroomProjectionGovernancePort,
  WorkroomProjectionOutboxItem,
  WorkroomProjectionRepository,
} from './contracts.js';
import { WorkroomProjectionRevisionConflictError } from './contracts.js';
import { createWorkroomGovernedDispatchReason } from '../governed-dispatch-reasons.js';
import { normalizeDeliveryResult } from './repository-state.js';
import { requireFiniteNumber, requirePositiveInteger, requireText } from './projector.js';

export interface WorkroomProjectionDeliveryWorkerOptions {
  readonly repository: WorkroomProjectionRepository;
  readonly outbound: WorkroomProjectionDeliveryPort;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly governance?: WorkroomProjectionGovernancePort;
  readonly authority?: Readonly<{
    authorize(item: WorkroomProjectionOutboxItem): Promise<boolean>;
  }>;
  /** Completion clock; production defaults to wall time, tests may inject a deterministic clock. */
  readonly now?: () => number;
}

/** At-least-once delivery worker; Projection receipts never mutate Kernel facts. */
export class WorkroomProjectionDeliveryWorker {
  readonly #repository: WorkroomProjectionRepository;
  readonly #outbound: WorkroomProjectionDeliveryPort;
  readonly #workerId: string;
  readonly #leaseMs: number;
  readonly #governance?: WorkroomProjectionGovernancePort;
  readonly #authority?: WorkroomProjectionDeliveryWorkerOptions['authority'];
  readonly #now: () => number;

  constructor(options: WorkroomProjectionDeliveryWorkerOptions) {
    requireText(options.workerId, 'workerId');
    requirePositiveInteger(options.leaseMs, 'leaseMs');
    this.#repository = options.repository;
    this.#outbound = options.outbound;
    this.#workerId = options.workerId;
    this.#leaseMs = options.leaseMs;
    this.#governance = options.governance;
    this.#authority = options.authority;
    this.#now = options.now ?? Date.now;
  }

  async runOnce(
    now: number,
    signal: AbortSignal,
  ): Promise<WorkroomProjectionDeliveryResult | Readonly<{ status: 'idle' }>> {
    requireFiniteNumber(now, 'delivery now');
    signal.throwIfAborted();
    const claimed = await this.#claim(now);
    if (!claimed) return Object.freeze({ status: 'idle' });
    let result: WorkroomProjectionDeliveryResult;
    try {
      const authorized = this.#authority ? await this.#authority.authorize(claimed) : true;
      if (!authorized) {
        result = Object.freeze({
          status: 'failed', code: 'catalog_binding_stale', retryable: false,
        });
      } else if (!this.#governance) {
        result = Object.freeze({
          status: 'failed', code: 'project_authority_unavailable', retryable: false,
        });
      } else {
        const governed = await this.#governance.revalidate(claimed.disclosure, signal);
        result = governed.status === 'blocked'
          ? (() => {
              const reason = createWorkroomGovernedDispatchReason(governed.reason);
              return Object.freeze({
                status: 'failed' as const, code: reason.code, retryable: reason.retryable,
              });
            })()
          : normalizeDeliveryResult(await this.#outbound.send(claimed, governed.body, signal));
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      result = Object.freeze({ status: 'failed', code: 'transport_error', retryable: true });
    }
    // Once send returned a receipt the external effect already happened;
    // cancellation must not discard it and cause a blind duplicate retry.
    const settledAt = this.#now();
    requireFiniteNumber(settledAt, 'delivery completion time');
    await this.#settle(claimed, result, settledAt);
    return result;
  }

  async #claim(now: number): Promise<WorkroomProjectionOutboxItem | undefined> {
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const state = await this.#repository.read();
      try {
        return await this.#repository.claimNext(
          state.revision,
          this.#workerId,
          now,
          this.#leaseMs,
        );
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Projection delivery claim CAS retries exhausted');
  }

  async #settle(
    item: WorkroomProjectionOutboxItem,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<void> {
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const state = await this.#repository.read();
      try {
        await this.#repository.settle(
          state.revision,
          item.id,
          this.#workerId,
          item.delivery.fence,
          result,
          settledAt,
        );
        return;
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Projection delivery settlement CAS retries exhausted');
  }
}
