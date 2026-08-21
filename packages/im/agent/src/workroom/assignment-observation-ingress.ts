import {
  assertAssignmentExecutionEnvelope,
  validateAssignmentExecutionObservation,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
} from './assignment-executor.js';
import type { WorkroomRunState } from './kernel-contracts.js';
import type { WorkroomKernel } from './workroom-kernel.js';

export interface AssignmentObservationIngressOptions {
  readonly kernel: WorkroomKernel;
}

/** Trusted bridge from transport observations into the Kernel's Journal CAS. */
export class AssignmentObservationIngress {
  readonly #kernel: WorkroomKernel;

  constructor(options: AssignmentObservationIngressOptions) {
    this.#kernel = options.kernel;
  }

  async apply(
    envelope: AssignmentExecutionEnvelope,
    value: AssignmentExecutionObservation,
    expectedSequence: number,
  ): Promise<WorkroomRunState> {
    assertAssignmentExecutionEnvelope(envelope);
    const observation = validateAssignmentExecutionObservation(envelope, value);
    return this.#kernel.applyAssignmentObservation(
      envelope,
      observation,
      expectedSequence,
    );
  }
}
