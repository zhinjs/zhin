import type {
  RemoteAssignmentDispatchAdmission,
  RemoteAssignmentDispatchAdmissionInput,
} from './remote-dispatch-admission.js';
import type {
  WorkroomRemoteAssignmentClaimRequest,
} from './remote-assignment-issuance.js';
import type { WorkroomRemoteDispatchInput } from './remote-dispatch.js';
import type {
  WorkroomKernel,
  WorkroomRemoteAssignmentIssuanceReceipt,
} from './workroom-kernel.js';

export interface RemoteAssignmentDispatchAdmissionPort {
  admit(input: RemoteAssignmentDispatchAdmissionInput): Promise<RemoteAssignmentDispatchAdmission>;
}

export interface RemoteAssignmentDispatchWakePort {
  drain(): Promise<void>;
}

export interface RemoteAssignmentDispatchCommandServiceOptions {
  readonly kernel: Pick<
    WorkroomKernel,
    'issueRemoteAssignment' | 'listRemoteAssignmentIssuances'
  >;
  readonly admission: RemoteAssignmentDispatchAdmissionPort;
  readonly scheduler: RemoteAssignmentDispatchWakePort;
}

export interface RemoteAssignmentDispatchRecoveryResult {
  readonly operationId: string;
  readonly status: 'admitted' | 'blocked';
  readonly reason?: string;
}

/**
 * Trusted claim-side command. The external producer never supplies an
 * Assignment Envelope: Kernel issuance is persisted first, then this
 * projection repairs Link + Outbox idempotently before waking the worker.
 */
export class RemoteAssignmentDispatchCommandService {
  readonly #kernel: RemoteAssignmentDispatchCommandServiceOptions['kernel'];
  readonly #admission: RemoteAssignmentDispatchAdmissionPort;
  readonly #scheduler: RemoteAssignmentDispatchWakePort;

  constructor(options: RemoteAssignmentDispatchCommandServiceOptions) {
    this.#kernel = options.kernel;
    this.#admission = options.admission;
    this.#scheduler = options.scheduler;
  }

  async issue(
    request: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomRemoteAssignmentIssuanceReceipt> {
    const issued = await this.#kernel.issueRemoteAssignment(request);
    await this.#project(issued);
    await this.#scheduler.drain();
    return issued;
  }

  async recover(): Promise<readonly RemoteAssignmentDispatchRecoveryResult[]> {
    const results: RemoteAssignmentDispatchRecoveryResult[] = [];
    let admitted = false;
    for (const issued of await this.#kernel.listRemoteAssignmentIssuances()) {
      try {
        await this.#project(issued);
        admitted = true;
        results.push(Object.freeze({ operationId: issued.operationId, status: 'admitted' }));
      } catch (error) {
        results.push(Object.freeze({
          operationId: issued.operationId,
          status: 'blocked',
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    if (admitted) await this.#scheduler.drain();
    return Object.freeze(results);
  }

  async #project(issued: WorkroomRemoteAssignmentIssuanceReceipt): Promise<void> {
    await this.#admission.admit({
      envelope: issued.envelope,
      dispatch: dispatchInput(issued),
      linkedAt: issued.issuedAt,
      reconcileDeadline: issued.reconcileDeadline,
      enqueuedAt: issued.issuedAt,
    });
  }
}

function dispatchInput(
  issued: WorkroomRemoteAssignmentIssuanceReceipt,
): WorkroomRemoteDispatchInput {
  const {
    version: _version,
    dispatchId: _dispatchId,
    messageId: _messageId,
    ...input
  } = issued.dispatchItem.envelope;
  return input;
}
