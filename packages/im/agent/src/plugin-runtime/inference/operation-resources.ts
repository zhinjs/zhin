import { randomUUID } from 'node:crypto';
import {
  aiInferenceClientToken,
  createLazyInferenceClient,
  type InferenceClient,
  type InferenceGraphSnapshot,
  type ProviderCallContext,
} from '@zhin.js/ai/provider';
import type { OperationResourceView } from '@zhin.js/feature-kit';
import type { SnapshotLease, SnapshotReader, Token } from '@zhin.js/plugin-runtime';
import { usageSubjectFromMessage, type UsageSubject } from '@zhin.js/core';
import type { ImOperationResourcesPort } from '@zhin.js/core/runtime';
import {
  createInferenceUsageAccounting,
  usageSubjectFromTurn,
  type AgentOperationResourcesPort,
  type UsageQuotaPort,
} from '../index.js';
import { getLogger } from '@zhin.js/logger';
import type { HostInference } from './host.js';
import { resolveInferenceMessageContext, resolveInferenceTurnContext } from './turn-context.js';
import { dispatchLeaseToken, type DispatchLeasePort } from './dispatch-lease.js';

interface OperationResourcesOptions {
  readonly host: HostInference;
  /** Captured from this generation's Agent, never looked up from a latest generation. */
  readonly quota: UsageQuotaPort;
}
interface OpenOperationInput {
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly signal: AbortSignal;
  readonly context: () => Promise<ProviderCallContext>;
  readonly subject?: UsageSubject;
  readonly alreadyAdmitted: boolean;
  readonly inferenceSnapshot?: InferenceGraphSnapshot;
  /**
   * Root IM commands only: also expose the dispatching generation ({@link dispatchLeaseToken}).
   * Never offered to a plugin-owned command / handler (#1250 第 84 批): a retained lease that is
   * never released would pin a retired generation and keep hot reload from draining.
   */
  readonly dispatchLease?: boolean;
  /** The dispatched message's conversation sequence, offered with the dispatch lease. */
  readonly conversationSequence?: number;
}

/** Each authorized Command/Tool owns a lazy client and an independent borrowed generation lease. */
export function createHostOperationResources(options: OperationResourcesOptions): Readonly<{
  im: ImOperationResourcesPort;
  agent: AgentOperationResourcesPort;
}> {
  const contextOptions = {
    rootId: options.host.rootId,
    hostOwnerId: options.host.hostOwnerId,
    sessions: options.host.sessions,
  };
  function open(input: OpenOperationInput): OperationResourceView {
    const accounting = createInferenceUsageAccounting({
      quota: options.quota,
      subject: input.subject,
      alreadyAdmitted: input.alreadyAdmitted,
      onSettlementError: report,
    });
    const client = createLazyInferenceClient({
      signal: input.signal,
      accounting,
      onCleanupError: report,
      open: async ({ signal }) => {
        const lease = input.snapshots.retain(input.lease);
        let runtime: ReturnType<HostInference['createInference']> | undefined;
        try {
          runtime = options.host.createInference(lease, () => accounting.submitted());
          const scope = await runtime.openScope({
            context: await input.context(),
            signal,
            snapshot: input.inferenceSnapshot,
          });
          let closed: Promise<void> | undefined;
          const close = () =>
            (closed ??= (async () => {
              try {
                await scope.close();
              } finally {
                runtime!.retire();
                lease.release();
              }
            })());
          const client = scope.client;
          return Object.freeze({
            list: client.list.bind(client),
            generate: client.generate.bind(client),
            stream: client.stream.bind(client),
            evaluate: client.evaluate.bind(client),
            generateImage: client.generateImage.bind(client),
            close,
            [Symbol.asyncDispose]: close,
          }) satisfies InferenceClient;
        } catch (error) {
          runtime?.retire();
          lease.release();
          throw error;
        }
      },
    });
    // #1250 第 83 批: the exact generation this operation was dispatched in, retained on demand.
    const dispatchLease: DispatchLeasePort | undefined = input.dispatchLease
      ? Object.freeze({
        retain: () => input.snapshots.retain(input.lease),
        ...(input.conversationSequence !== undefined ? { conversationSequence: input.conversationSequence } : {}),
      })
      : undefined;
    return Object.freeze({
      has: (token: Token<unknown>) => token === aiInferenceClientToken || (dispatchLease !== undefined && token === dispatchLeaseToken),
      use<T>(token: Token<T>): T {
        if (dispatchLease && token === dispatchLeaseToken) return dispatchLease as T;
        if (token !== aiInferenceClientToken)
          throw new Error('Resource is not available in this operation');
        return client as T;
      },
      close: () => client.close(),
    });
  }
  function report(): void {
    getLogger('inference').warn('Operation inference usage or cleanup reporting failed');
  }
  return Object.freeze({
    im: {
      open: (input) =>
        open({
          ...input,
          alreadyAdmitted: false,
          // #1250 第 84 批: only an operation owned by the Root (the Agent management commands the
          // zhin instance registers) sees the dispatch lease; token secrecy alone is not the guard.
          dispatchLease: input.owner === input.lease.value.root,
          subject: usageSubjectFromMessage(input.message),
          context: () =>
            resolveInferenceMessageContext(contextOptions, input.message, randomUUID()),
        }),
    },
    agent: {
      open: (input) =>
        open({
          ...input,
          alreadyAdmitted: true,
          subject: usageSubjectFromTurn(input.request),
          context: () => resolveInferenceTurnContext(contextOptions, input.request),
        }),
    },
  });
}
