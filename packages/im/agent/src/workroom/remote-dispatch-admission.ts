import {
  assertAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from './assignment-executor.js';
import {
  bindRemoteExecutionLinkTransportReceipt,
  createRemoteExecutionLinkPreregistration,
  type RemoteExecutionLinkRegistryRepository,
} from './remote-callback-application.js';
import {
  type WorkroomRemoteDispatchOutboxProjection,
  type WorkroomRemoteDispatchOutboxRepository,
} from './remote-dispatch-outbox.js';
import {
  runWorkroomRemoteDispatchOnce,
  type RunWorkroomRemoteDispatchOnceInput,
} from './remote-dispatch-worker.js';
import {
  createWorkroomRemoteDispatchOutboxItem,
  assertWorkroomGovernedDispatchSupersession,
  type WorkroomRemoteDispatchInput,
  type WorkroomRemoteDispatchOutboxItem,
} from './remote-dispatch.js';
import type { WorkroomRemoteExecutorPort } from '../plugin-runtime/workroom-remote-executor.js';
import type { WorkroomDisclosureManifestAuthorityPort } from '../plugin-runtime/workroom-data-governance-runtime.js';
import type { WorkroomRunState } from './kernel-contracts.js';
import { createWorkroomGovernedDispatchReason } from '../plugin-runtime/workroom-governed-dispatch-reasons.js';

export interface RemoteAssignmentDispatchRunStatePort {
  read(projectId: string, runId: string): Promise<WorkroomRunState>;
}

export interface RemoteAssignmentDispatchServiceOptions {
  readonly runState: RemoteAssignmentDispatchRunStatePort;
  readonly linkRegistry: RemoteExecutionLinkRegistryRepository;
  readonly outbox: WorkroomRemoteDispatchOutboxRepository;
  readonly executor: WorkroomRemoteExecutorPort;
  readonly clock: Readonly<{ now(): number }>;
  readonly governance?: Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'>;
}

export interface RemoteAssignmentDispatchAdmissionInput {
  readonly envelope: AssignmentExecutionEnvelope;
  readonly dispatch: WorkroomRemoteDispatchInput;
  readonly linkedAt: number;
  readonly reconcileDeadline: number;
  readonly enqueuedAt: number;
}

export interface RemoteAssignmentDispatchAdmission {
  readonly linkId: string;
  readonly item: WorkroomRemoteDispatchOutboxItem;
}

export type RemoteAssignmentDispatchWorkerInput = Omit<
  RunWorkroomRemoteDispatchOnceInput,
  'repository' | 'executor'
>;

/**
 * Trusted bridge from an already-claimed Assignment Envelope to remote A2A.
 * It has no claim/Task command surface and never translates transport delivery
 * into Workroom state.
 */
export class RemoteAssignmentDispatchService {
  readonly #runState: RemoteAssignmentDispatchRunStatePort;
  readonly #linkRegistry: RemoteExecutionLinkRegistryRepository;
  readonly #outbox: WorkroomRemoteDispatchOutboxRepository;
  readonly #executor: WorkroomRemoteExecutorPort;
  readonly #clock: Readonly<{ now(): number }>;
  readonly #governance?: Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'>;

  constructor(options: RemoteAssignmentDispatchServiceOptions) {
    this.#runState = options.runState;
    this.#linkRegistry = options.linkRegistry;
    this.#outbox = options.outbox;
    this.#executor = options.executor;
    this.#clock = options.clock;
    this.#governance = options.governance;
  }

  async admit(
    input: RemoteAssignmentDispatchAdmissionInput,
  ): Promise<RemoteAssignmentDispatchAdmission> {
    assertAssignmentExecutionEnvelope(input.envelope);
    timestamp(input.enqueuedAt, 'enqueuedAt');
    const item = createWorkroomRemoteDispatchOutboxItem(input.dispatch);
    const blocked = await this.#outbox.listGovernanceBlocked({
      projectId: item.envelope.projectId,
      runId: item.envelope.runId,
      taskKey: item.envelope.taskKey,
      taskRevision: item.envelope.taskRevision,
    });
    const predecessor = blocked[0];
    if (predecessor) {
      assertWorkroomGovernedDispatchSupersession(predecessor, item);
    } else if (item.envelope.supersedes) {
      throw new Error('Superseded governance-blocked Remote Dispatch does not exist');
    }
    const registration = createRemoteExecutionLinkPreregistration(
      item,
      input.envelope,
      input.linkedAt,
      input.reconcileDeadline,
    );
    await this.#assertCurrentAuthority(input.envelope, this.#now());
    // This order is deliberate: a callback can never name an Outbox dispatch
    // that has no durable local Assignment/endpoint authority preregistered.
    await this.#linkRegistry.preregisterPending(registration, -1);
    await this.#outbox.enqueue(item, -1, input.enqueuedAt);
    return Object.freeze({ linkId: registration.id, item });
  }

  async runOnce(
    input: RemoteAssignmentDispatchWorkerInput,
  ): Promise<WorkroomRemoteDispatchOutboxProjection> {
    input.signal.throwIfAborted();
    const current = await this.#outbox.read(input.dispatchId);
    if (!current) {
      throw new Error(`Remote Dispatch Outbox item does not exist: ${input.dispatchId}`);
    }
    if (current.sequence !== input.expectedSequence) {
      throw new Error(
        `Remote Dispatch worker sequence conflict: expected ${input.expectedSequence}, `
        + `actual ${current.sequence}`,
      );
    }
    // Idempotent terminal reads need no live Assignment lease and can remain
    // inspectable after execution has moved to Acceptance/reconciliation.
    if (current.status === 'delivered'
      || current.status === 'reconcile_required'
      || current.status === 'blocked') return current;
    const linkId = linkIdFromItem(current.item);
    const registration = await this.#linkRegistry.readPending(linkId);
    if (!registration) {
      throw new Error('Remote Dispatch Outbox item has no preregistered Execution Link');
    }
    if (registration.dispatchItem.envelopeDigest !== current.item.envelopeDigest) {
      throw new Error('Remote Dispatch Outbox item drifted from preregistered Execution Link');
    }
    const alreadyBound = await this.#linkRegistry.read(linkId);
    if (alreadyBound && (
      alreadyBound.assignmentEnvelope.digest !== registration.assignmentEnvelope.digest
      || alreadyBound.link.dispatchId !== current.item.dispatchId
      || alreadyBound.link.messageId !== current.item.messageId
      || alreadyBound.link.dispatchEnvelopeDigest !== current.item.envelopeDigest
    )) {
      throw new Error('Remote Dispatch bound Execution Link drifted from Outbox authority');
    }
    const startedAt = this.#now();
    const assignmentLeaseExpiresAt = await this.#assertCurrentAuthority(
      registration.assignmentEnvelope,
      startedAt,
    );
    // The scheduler owns only a desired worker budget. The live Assignment
    // lease is the authority ceiling and may be shorter by the time this item
    // is discovered after restart.
    const boundedLeaseExpiresAt = Math.min(input.leaseExpiresAt, assignmentLeaseExpiresAt);
    const deadlineSignal = AbortSignal.timeout(Math.max(
      1,
      boundedLeaseExpiresAt - startedAt,
    ));
    const transportSignal = AbortSignal.any([input.signal, deadlineSignal]);
    const governed = this.#governance
      ? await this.#governance.revalidate(current.item.envelope.disclosureManifest, transportSignal)
      : { status: 'blocked' as const, reason: 'project_authority_unavailable' as const };
    if (governed.status === 'blocked') {
      const reason = createWorkroomGovernedDispatchReason(governed.reason);
      await this.#outbox.recordGovernanceBlock({
        dispatchId: current.dispatchId,
        expectedSequence: current.sequence,
        now: startedAt,
        reason: reason.code,
        manifestDigest: current.item.envelope.disclosureManifest.manifest.digest,
        attempt: current.item.envelope.attempt,
        assignmentFence: current.item.envelope.fence,
      });
      const blocked = await this.#outbox.read(current.dispatchId);
      if (!blocked) throw new Error('Remote Dispatch governance blocker was not persisted');
      return blocked;
    }
    const bindingExecutor: WorkroomRemoteExecutorPort = {
      dispatch: async (item, signal) => {
        if (alreadyBound) {
          return Object.freeze({
            outcome: 'delivered' as const,
            receiptId: `remote-link-bound:v1:${alreadyBound.digest}`,
            remoteTaskId: alreadyBound.link.remoteTaskId,
            remoteContextId: alreadyBound.link.remoteContextId,
          });
        }
        const observation = await this.#executor.dispatch(item, signal, governed.body);
        signal.throwIfAborted();
        if (observation.outcome !== 'delivered') return observation;
        if (!observation.remoteTaskId || !observation.remoteContextId) {
          throw new Error('A2A delivered receipt omitted remote Task/Context identity');
        }
        await this.#assertCurrentAuthority(registration.assignmentEnvelope, this.#now());
        signal.throwIfAborted();
        const record = bindRemoteExecutionLinkTransportReceipt(
          registration,
          observation.remoteTaskId,
          observation.remoteContextId,
        );
        await this.#linkRegistry.bindTransportReceipt(record, registration.revision);
        return observation;
      },
    };
    return await runWorkroomRemoteDispatchOnce({
      ...input,
      now: startedAt,
      leaseExpiresAt: boundedLeaseExpiresAt,
      signal: transportSignal,
      clock: this.#clock,
      repository: this.#outbox,
      executor: bindingExecutor,
    });
  }

  async #assertCurrentAuthority(
    envelope: AssignmentExecutionEnvelope,
    now: number,
  ): Promise<number> {
    timestamp(now, 'authority clock');
    const state = await this.#runState.read(envelope.projectId, envelope.runId);
    const task = state.tasks[envelope.taskKey];
    const assignment = state.assignments[envelope.assignmentId];
    if (state.projectId !== envelope.projectId
      || state.runId !== envelope.runId
      || !task
      || !assignment
      || task.revision !== envelope.taskRevision
      || task.currentAssignmentId !== envelope.assignmentId
      || assignment.taskKey !== envelope.taskKey
      || assignment.taskRevision !== envelope.taskRevision
      || assignment.revision !== envelope.assignmentRevision
      || assignment.attempt !== envelope.attempt
      || assignment.fence !== envelope.fence
      || assignment.envelopeDigest !== envelope.digest
      || assignment.owner !== envelope.principalId
      || assignment.role !== envelope.role
      || (assignment.status !== 'leased' && assignment.status !== 'running')
      || now >= assignment.leaseExpiresAt) {
      throw new Error('Remote Assignment Dispatch authority is stale or not executable');
    }
    return assignment.leaseExpiresAt;
  }

  #now(): number {
    return timestamp(this.#clock.now(), 'trusted clock');
  }
}

function linkIdFromItem(item: WorkroomRemoteDispatchOutboxItem): string {
  return `remote-execution-link:v1:${[
    item.envelope.projectId,
    item.envelope.runId,
    item.envelope.assignmentId,
    String(item.envelope.attempt),
    String(item.envelope.fence),
  ].map(encodeURIComponent).join(':')}`;
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Remote Assignment Dispatch ${field} must be a finite timestamp`);
  }
  return Number(value);
}
