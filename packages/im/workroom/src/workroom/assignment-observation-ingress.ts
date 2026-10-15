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

export interface AssignmentObservationCommandPort {
  apply(
    value: AssignmentExecutionObservation,
    expectedSequence: number,
  ): Promise<WorkroomRunState>;
}

/** Trusted bridge from transport observations into the Kernel's Journal CAS. */
export class AssignmentObservationIngress {
  readonly #kernel: WorkroomKernel;

  constructor(options: AssignmentObservationIngressOptions) {
    this.#kernel = options.kernel;
  }

  /**
   * Fixes Project/Run/Task/Assignment identity to one trusted Envelope. The
   * caller can submit observations, but cannot select another authority scope.
   */
  bind(envelope: AssignmentExecutionEnvelope): AssignmentObservationCommandPort {
    assertAssignmentExecutionEnvelope(envelope);
    return Object.freeze({
      apply: async (
        value: AssignmentExecutionObservation,
        expectedSequence: number,
      ): Promise<WorkroomRunState> => await this.apply(envelope, value, expectedSequence),
    });
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
