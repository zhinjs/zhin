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
    return Object.freeze({
      has: (token: Token<unknown>) => token === aiInferenceClientToken,
      use<T>(token: Token<T>): T {
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
