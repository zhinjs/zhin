import { join } from 'node:path';
import { FilePayloadLifecycleRepository } from '../data-governance/file-payload-lifecycle-repository.js';
import {
  PayloadLifecycleRuntime,
  type PayloadLifecycleCommandAuthorityPort,
  type PayloadLifecycleControlPort,
  type PayloadLifecycleKernelClockPort,
  type PayloadLifecycleObjectAuthorityPort,
  type PayloadLifecycleWorkerPort,
  type PayloadLifecycleJournal,
  type PayloadLocationDeletionPort,
  type PayloadPurgeReceiptAuthorityPort,
  type PayloadSubjectErasureResolverPort,
} from '../data-governance/payload-lifecycle.js';
import type { WorkroomProjectionReadAuthorityPort } from '../workroom/runtime.js';
import { PayloadRetentionHoldOverdueProjection } from '../data-governance/payload-hold-overdue-projection.js';
import {
  createWorkroomDataLifecycleConsoleControl,
  type WorkroomDataLifecycleConsoleAuthorityPort,
  type WorkroomDataLifecycleConsoleControlPort,
} from './workroom-data-lifecycle-console.js';

export interface CreateFileWorkroomDataLifecycleRuntimeOptions {
  /** Existing `.zhin` data root. No policy is read from `ai.workrooms` or config. */
  readonly stateRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly clock: PayloadLifecycleKernelClockPort;
  readonly authority: PayloadLifecycleCommandAuthorityPort;
  readonly objects: PayloadLifecycleObjectAuthorityPort;
  readonly subjects: PayloadSubjectErasureResolverPort;
  readonly deletion: PayloadLocationDeletionPort;
  readonly receipts: PayloadPurgeReceiptAuthorityPort;
  /** Root-private activation latch used by the Database handoff. */
  readonly journal?: PayloadLifecycleJournal;
  /** Root-private role authority plus current Catalog/P12 disclosure; both are required. */
  readonly consoleAuthority?: WorkroomDataLifecycleConsoleAuthorityPort;
  readonly consoleDisclosure?: WorkroomProjectionReadAuthorityPort;
}

export interface WorkroomDataLifecycleComposition {
  /** Authenticated control-plane surface. It accepts no caller-supplied role or policy proof. */
  readonly control: PayloadLifecycleControlPort;
  /** Private outbox worker surface. It publishes no raw Vault or crypto capability. */
  readonly worker: PayloadLifecycleWorkerPort;
  /** Content-free P12 source for the existing governed Workroom Projection outbox. */
  readonly overdue: Pick<PayloadRetentionHoldOverdueProjection, 'project'>;
  /** Narrow Host projection/control; absent when its root-private provider is unavailable. */
  readonly console?: WorkroomDataLifecycleConsoleControlPort;
}

/**
 * Generation-owned File production tracer for governed Payload lifecycle.
 * Trusted authorities remain constructor-only and are never placed in Scope.
 */
export function createFileWorkroomDataLifecycleRuntime(
  options: CreateFileWorkroomDataLifecycleRuntimeOptions,
): WorkroomDataLifecycleComposition {
  if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
    throw new Error('Workroom Data Lifecycle generation is invalid');
  }
  options.signal.throwIfAborted();
  const journal = options.journal
    ?? new FilePayloadLifecycleRepository(join(options.stateRoot, 'workroom-payload-lifecycle'));
  const clock = operationGuard(options.signal, options.clock);
  const runtime = new PayloadLifecycleRuntime({
    journal,
    clock,
    authority: options.authority,
    objects: options.objects,
    subjects: options.subjects,
    deletion: options.deletion,
    receipts: options.receipts,
  });
  const overdue = new PayloadRetentionHoldOverdueProjection({
    source: Object.freeze({
      listObjectIds: (projectId: string) => journal.listObjectIds(projectId),
      read: async (projectId: string, objectId: string) => {
        const state = await runtime.read(projectId, objectId);
        return Object.freeze({
          projectId: state.projectId,
          objectId: state.objectId,
          stateSequence: state.sequence,
          stateDigest: state.digest,
          holds: state.holds,
        });
      },
    }),
    clock,
  });
  const console = options.consoleAuthority && options.consoleDisclosure
    ? createWorkroomDataLifecycleConsoleControl({
        generation: options.generation,
        control: abortGuard(options.signal, runtime.control),
        read: (projectId, objectId) => runtime.read(projectId, objectId),
        listObjectIds: projectId => journal.listObjectIds(projectId),
        clock,
        subjects: options.subjects,
        authority: options.consoleAuthority,
        disclosure: options.consoleDisclosure,
        overdueProjection: overdue,
      })
    : undefined;
  return Object.freeze({
    control: abortGuard(options.signal, runtime.control),
    worker: abortWorkerGuard(options.signal, runtime.worker),
    overdue: abortOverdueGuard(options.signal, overdue),
    ...(console ? { console } : {}),
  });
}

function abortOverdueGuard(
  generationSignal: AbortSignal,
  overdue: Pick<PayloadRetentionHoldOverdueProjection, 'project'>,
): Pick<PayloadRetentionHoldOverdueProjection, 'project'> {
  return Object.freeze({
    project: async (projectId: string, signal: AbortSignal) => {
      generationSignal.throwIfAborted();
      return await overdue.project(projectId, combinedSignal(generationSignal, signal));
    },
  });
}

function operationGuard(
  generationSignal: AbortSignal,
  clock: PayloadLifecycleKernelClockPort,
): PayloadLifecycleKernelClockPort {
  const guarded: PayloadLifecycleKernelClockPort = {
    read: async (input: Parameters<PayloadLifecycleKernelClockPort['read']>[0]) => {
      generationSignal.throwIfAborted();
      const value = await clock.read(input);
      generationSignal.throwIfAborted();
      return value;
    },
  };
  return Object.freeze(guarded);
}

function abortGuard(
  generationSignal: AbortSignal,
  control: PayloadLifecycleControlPort,
): PayloadLifecycleControlPort {
  const guarded: PayloadLifecycleControlPort = {
    register: async (
      command: Parameters<PayloadLifecycleControlPort['register']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.register(command, combinedSignal(generationSignal, signal));
    },
    placeHold: async (
      command: Parameters<PayloadLifecycleControlPort['placeHold']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.placeHold(command, combinedSignal(generationSignal, signal));
    },
    reviewHold: async (
      command: Parameters<PayloadLifecycleControlPort['reviewHold']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.reviewHold(command, combinedSignal(generationSignal, signal));
    },
    releaseHold: async (
      command: Parameters<PayloadLifecycleControlPort['releaseHold']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.releaseHold(command, combinedSignal(generationSignal, signal));
    },
    requestSubjectErasure: async (
      command: Parameters<PayloadLifecycleControlPort['requestSubjectErasure']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.requestSubjectErasure(command, combinedSignal(generationSignal, signal));
    },
    evaluateRetention: async (
      command: Parameters<PayloadLifecycleControlPort['evaluateRetention']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.evaluateRetention(command, combinedSignal(generationSignal, signal));
    },
    reconcile: async (
      command: Parameters<PayloadLifecycleControlPort['reconcile']>[0], signal: AbortSignal,
    ) => {
      generationSignal.throwIfAborted();
      return await control.reconcile(command, combinedSignal(generationSignal, signal));
    },
  };
  return Object.freeze(guarded);
}

function abortWorkerGuard(
  generationSignal: AbortSignal,
  worker: PayloadLifecycleWorkerPort,
): PayloadLifecycleWorkerPort {
  const guarded: PayloadLifecycleWorkerPort = {
    dispatch: async (projectId: string, objectId: string, signal: AbortSignal) => {
      generationSignal.throwIfAborted();
      return await worker.dispatch(projectId, objectId, combinedSignal(generationSignal, signal));
    },
    drainProject: async (projectId: string, signal: AbortSignal) => {
      generationSignal.throwIfAborted();
      return await worker.drainProject(projectId, combinedSignal(generationSignal, signal));
    },
  };
  return Object.freeze(guarded);
}

function combinedSignal(generationSignal: AbortSignal, operationSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([generationSignal, operationSignal]);
}
