import { createToken } from '@zhin.js/plugin-runtime';
import { AssignmentObservationIngress } from '../workroom/assignment-observation-ingress.js';
import {
  FileRemoteExecutionLinkRegistryRepository,
  RemoteCallbackApplication,
  type RemoteExecutionLinkRegistryRepository,
} from '../workroom/remote-callback-application.js';
import {
  FileRemoteCallbackInboxRepository,
  type RemoteCallbackInboxRepository,
} from '../workroom/remote-callback-inbox.js';
import type {
  RemoteCallbackPollPort,
  RemoteCallbackReconciliationClock,
} from '../workroom/remote-callback-reconciliation-worker.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';
import { FileWorkroomRemoteDispatchOutboxRepository } from '../workroom/remote-dispatch-outbox.js';
import {
  RemoteAssignmentDispatchService,
  type RemoteAssignmentDispatchRunStatePort,
} from '../workroom/remote-dispatch-admission.js';
import {
  RemoteAssignmentDispatchScheduler,
  type RemoteAssignmentDispatchSchedulerOptions,
} from '../workroom/remote-dispatch-scheduler.js';
import { RemoteAssignmentDispatchCommandService } from '../workroom/remote-assignment-dispatch-command.js';
import type { WorkroomRemoteExecutorPort } from './workroom-remote-executor.js';
import type { WorkroomDisclosureManifestAuthorityPort } from './workroom-data-governance-runtime.js';
import { join } from 'node:path';

export interface WorkroomRemoteCallbackRuntimeOptions {
  readonly kernel: WorkroomKernel;
  readonly stateRoot: string;
  readonly pollPort?: RemoteCallbackPollPort;
  readonly clock?: RemoteCallbackReconciliationClock;
  readonly governance?: Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'>;
}

export interface WorkroomRemoteCallbackRuntimePort {
  readonly linkRegistry: RemoteExecutionLinkRegistryRepository;
  readonly inboxRepository: RemoteCallbackInboxRepository;
  readRun(projectId: string, runId: string): ReturnType<WorkroomKernel['read']>;
  pinTaskAcceptance(
    projectId: string,
    runId: string,
    taskKey: string,
  ): ReturnType<WorkroomKernel['pinTaskAcceptance']>;
  createApplication(
    maxSequenceGap: number,
    pollPort?: RemoteCallbackPollPort,
  ): RemoteCallbackApplication;
  createDispatchService(executor: WorkroomRemoteExecutorPort): RemoteAssignmentDispatchService;
  createDispatchScheduler(
    dispatch: RemoteAssignmentDispatchService,
    options: Omit<RemoteAssignmentDispatchSchedulerOptions, 'outbox' | 'dispatch'>,
  ): RemoteAssignmentDispatchScheduler;
  createDispatchCommandService(
    dispatch: RemoteAssignmentDispatchService,
    scheduler: RemoteAssignmentDispatchScheduler,
  ): RemoteAssignmentDispatchCommandService;
}

export const workroomRemoteCallbackRuntimeToken =
  createToken<WorkroomRemoteCallbackRuntimePort>(
    'zhin.agent.workroom-remote-callback-runtime',
    'Durable Remote Callback Link/Inbox/Application bridge owned by the Root generation',
  );

export const remoteAssignmentDispatchServiceToken =
  createToken<RemoteAssignmentDispatchService>(
    'zhin.agent.remote-assignment-dispatch-service',
    'Root-owned durable admission and worker bridge for Remote Workroom Assignments',
  );

export const remoteAssignmentDispatchSchedulerToken =
  createToken<RemoteAssignmentDispatchScheduler>(
    'zhin.agent.remote-assignment-dispatch-scheduler',
    'Generation-owned durable Remote Workroom Assignment Outbox scheduler',
  );

/** Control-plane only; never projected into ordinary Agent Tool metadata. */
export const remoteAssignmentDispatchCommandServiceToken =
  createToken<Pick<RemoteAssignmentDispatchCommandService, 'issue' | 'recover'>>(
    'zhin.agent.remote-assignment-dispatch-command-service',
    'Kernel-owned Remote Assignment issuance and durable admission producer',
  );

/**
 * Composition boundary for authenticated transport observations. The exposed
 * application has no Task command port; its sole writer is the trusted
 * AssignmentObservationIngress backed by the Workroom Kernel.
 */
export function createWorkroomRemoteCallbackRuntime(
  options: WorkroomRemoteCallbackRuntimeOptions,
): WorkroomRemoteCallbackRuntimePort {
  const linkRegistry = new FileRemoteExecutionLinkRegistryRepository(
    join(options.stateRoot, 'workroom-remote-links'),
  );
  const inboxRepository = new FileRemoteCallbackInboxRepository(
    join(options.stateRoot, 'workroom-remote-callbacks'),
  );
  const observationIngress = new AssignmentObservationIngress({ kernel: options.kernel });
  const clock = options.clock ?? systemClock;
  const runState: RemoteAssignmentDispatchRunStatePort = Object.freeze({
    read: async (projectId: string, runId: string) => await options.kernel.read(projectId, runId),
  });
  const dispatchOutbox = new FileWorkroomRemoteDispatchOutboxRepository(
    join(options.stateRoot, 'workroom-remote-dispatches'),
  );
  return Object.freeze({
    linkRegistry,
    inboxRepository,
    readRun: (projectId: string, runId: string) => options.kernel.read(projectId, runId),
    pinTaskAcceptance: (projectId: string, runId: string, taskKey: string) =>
      options.kernel.pinTaskAcceptance(projectId, runId, taskKey),
    createApplication(maxSequenceGap: number, applicationPollPort?: RemoteCallbackPollPort) {
      return new RemoteCallbackApplication({
        registry: linkRegistry,
        inboxRepository,
        maxSequenceGap,
        pollPort: applicationPollPort ?? options.pollPort ?? unavailablePollPort,
        reconciliationClock: clock,
        observationIngress,
        runState,
      });
    },
    createDispatchService(executor: WorkroomRemoteExecutorPort) {
      return new RemoteAssignmentDispatchService({
        runState,
        linkRegistry,
        outbox: dispatchOutbox,
        executor,
        clock,
        governance: options.governance,
      });
    },
    createDispatchScheduler(
      dispatch: RemoteAssignmentDispatchService,
      schedulerOptions: Omit<
        RemoteAssignmentDispatchSchedulerOptions,
        'outbox' | 'dispatch'
      >,
    ) {
      return new RemoteAssignmentDispatchScheduler({
        ...schedulerOptions,
        outbox: dispatchOutbox,
        dispatch,
        clock,
      });
    },
    createDispatchCommandService(
      dispatch: RemoteAssignmentDispatchService,
      scheduler: RemoteAssignmentDispatchScheduler,
    ) {
      return new RemoteAssignmentDispatchCommandService({
        kernel: options.kernel,
        admission: dispatch,
        scheduler,
      });
    },
  });
}

const systemClock: RemoteCallbackReconciliationClock = Object.freeze({
  now: () => Date.now(),
});

const unavailablePollPort: RemoteCallbackPollPort = Object.freeze({
  poll: async () => {
    throw new Error(
      'Workroom Remote Callback reconciliation requires an installed endpoint poll transport',
    );
  },
});
