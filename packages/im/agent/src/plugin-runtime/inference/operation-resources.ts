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
import { createDispatchLeaseIssuer, dispatchLeaseToken, dispatchLeaseWithheldToken, type DispatchLeasePort } from './dispatch-lease.js';

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
  /** A Root IM operation a plugin dispatched: the lease is withheld and {@link dispatchLeaseWithheldToken} says so. */
  readonly dispatchLeaseWithheld?: boolean;
  /** The dispatched message's conversation sequence, offered with the dispatch lease. */
  readonly conversationSequence?: number;
}

/**
 * Each authorized Command/Tool owns a lazy client and an independent borrowed generation lease.
 *
 * #1250 第 84 批: `isDispatchLease` recognizes the dispatch lease ports issued by **this** call only.
 * The Agent Host passes it to `createRuntimeManagementCommands`; a port another factory issued (this
 * function is public, so a plugin can call it too) is not accepted there.
 */
export function createHostOperationResources(options: OperationResourcesOptions): Readonly<{
  im: ImOperationResourcesPort;
  agent: AgentOperationResourcesPort;
  /** True only for a dispatch lease port this factory instance issued to one of its Root IM operations. */
  isDispatchLease(port: unknown): boolean;
  /**
   * #1250 第 85 批: true only for a lease a port this factory instance issued handed out (its
   * `retain()`); a lease acquired from the SnapshotStore directly is not one.
   */
  holdsDispatchLease(lease: unknown): boolean;
}> {
  const issuer = createDispatchLeaseIssuer();
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
    // #1250 第 84 批: issued by this factory instance (recorded by its own issuer), so a look-alike
    // port from a caller's own `operation` factory, or a port another factory issued, is not taken for it.
    const dispatchLease: DispatchLeasePort | undefined = input.dispatchLease
      ? issuer.issue({
        retain: () => input.snapshots.retain(input.lease),
        ...(input.conversationSequence !== undefined ? { conversationSequence: input.conversationSequence } : {}),
      })
      : undefined;
    const withheld = dispatchLease === undefined && input.dispatchLeaseWithheld === true;
    return Object.freeze({
      has: (token: Token<unknown>) => token === aiInferenceClientToken
        || (dispatchLease !== undefined && token === dispatchLeaseToken)
        || (withheld && token === dispatchLeaseWithheldToken),
      use<T>(token: Token<T>): T {
        if (dispatchLease && token === dispatchLeaseToken) return dispatchLease as T;
        if (withheld && token === dispatchLeaseWithheldToken) return true as T;
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
    isDispatchLease: (port: unknown) => issuer.isIssued(port),
    holdsDispatchLease: (lease: unknown) => issuer.holds(lease),
    im: {
      open: (input) =>
        open({
          ...input,
          alreadyAdmitted: false,
          // #1250 第 84 批: only an operation owned by the Root (the Agent management commands the
          // zhin instance registers) sees the dispatch lease; token secrecy alone is not the guard.
          // A Root operation a plugin dispatched (`delegatedFrom`: its message view was bound from a
          // plugin author) keeps every other resource, as a direct dispatch would, but not the lease.
          dispatchLease: input.owner === input.lease.value.root && input.delegatedFrom === undefined,
          dispatchLeaseWithheld: input.owner === input.lease.value.root && input.delegatedFrom !== undefined,
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
