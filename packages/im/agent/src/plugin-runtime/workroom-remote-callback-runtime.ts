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
import { join } from 'node:path';

export interface WorkroomRemoteCallbackRuntimeOptions {
  readonly kernel: WorkroomKernel;
  readonly stateRoot: string;
  readonly pollPort?: RemoteCallbackPollPort;
  readonly clock?: RemoteCallbackReconciliationClock;
}

export interface WorkroomRemoteCallbackRuntimePort {
  readonly linkRegistry: RemoteExecutionLinkRegistryRepository;
  readonly inboxRepository: RemoteCallbackInboxRepository;
  createApplication(maxSequenceGap: number): RemoteCallbackApplication;
}

export const workroomRemoteCallbackRuntimeToken =
  createToken<WorkroomRemoteCallbackRuntimePort>(
    'zhin.agent.workroom-remote-callback-runtime',
    'Durable Remote Callback Link/Inbox/Application bridge owned by the Root generation',
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
  const pollPort = options.pollPort ?? unavailablePollPort;
  const clock = options.clock ?? systemClock;
  return Object.freeze({
    linkRegistry,
    inboxRepository,
    createApplication(maxSequenceGap: number) {
      return new RemoteCallbackApplication({
        registry: linkRegistry,
        inboxRepository,
        maxSequenceGap,
        pollPort,
        reconciliationClock: clock,
        observationIngress,
        runState: {
          read: async (projectId, runId) => await options.kernel.read(projectId, runId),
        },
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
