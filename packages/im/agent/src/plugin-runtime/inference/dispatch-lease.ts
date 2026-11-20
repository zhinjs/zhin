/**
 * zhinjs/zhin#1250 第 83 批: the generation a command operation was dispatched in, as an operation
 * resource. `createHostOperationResources` binds it to the exact lease the IM runtime holds for the
 * message (the one Core hands to `imOperationResourcesToken.open`), so an Agent management Root
 * command retains the generation that dispatched it, not whichever generation is current by then.
 *
 * Internal module: deliberately not re-exported. Token identity is not the guard (#1250 第 84 批):
 * a token's id is readable, and a caller of `CommandIndex.dispatch` may pass its own `operation`
 * factory whose resource view answers `has` / `use` for any token. Neither is a module-wide registry:
 * `createHostOperationResources` is a public export, so a plugin can build its own factory and have
 * it issue a port. The protection is twofold:
 *
 * 1. Only ports issued by **this Host instance** count. Each `createHostOperationResources` call has
 *    its own issuer ({@link createDispatchLeaseIssuer}, a WeakSet private to that call); the Agent
 *    Host hands its own instance's `isDispatchLease` to `createRuntimeManagementCommands`, so a port
 *    from any other factory — a plugin's included — is no lease at all.
 * 2. The Host side (`AgentTurnIngressRoute.runManagementOperation` / `clearAsCommand`) checks the
 *    lease `retain()` returns against the real SnapshotStore (`AgentRuntime.ownsLease`) and refuses
 *    a lease that store did not issue.
 * 3. #1250 第 85 批: a lease from the real store is not enough either — anyone holding the store could
 *    `acquire()` one. The Host side also requires that the lease is one an issued port's own
 *    `retain()` returned ({@link DispatchLeaseIssuer.holds}), so only a lease handed out through this
 *    Host's dispatch is accepted.
 *
 * The Host issues the port only to operations whose owner is the Root plugin and that no plugin
 * dispatched (a message view bound from a plugin author, `delegatedFrom`); a plugin-dispatched Root
 * operation gets {@link dispatchLeaseWithheldToken} instead, and a command that needs the lease tells
 * the sender to send it directly.
 */
import { createRootPrivateToken, type SnapshotLease } from '@zhin.js/plugin-runtime';

export interface DispatchLeasePort {
  /** An independent lease on the dispatching generation; the caller releases it. */
  retain(): SnapshotLease;
  /**
   * #1250 第 84 批: the dispatched message's conversation sequence (absent when none was recorded), so
   * gates that fold scene events (`observeSessionAndCheckSpeak`) read them up to this very message.
   */
  readonly conversationSequence?: number;
}

export const dispatchLeaseToken = createRootPrivateToken<DispatchLeasePort>(
  'zhin.agent.dispatch-lease', 'The generation one IM command operation was dispatched in',
);

/**
 * #1250 第 84 批: marks a Root IM operation that a plugin dispatched (middleware / handler / button
 * callback through `CommandIndex.dispatch`): every other Host resource is there, the dispatch lease
 * is withheld. Absent together with the lease: the operation has no Host resources at all.
 */
export const dispatchLeaseWithheldToken = createRootPrivateToken<true>(
  'zhin.agent.dispatch-lease-withheld', 'The dispatch lease was withheld from a plugin-dispatched Root operation',
);

/** One Host instance's issuer: what it issued and nothing else (a look-alike, or another issuer's port, is not). */
export interface DispatchLeaseIssuer {
  /** The dispatch lease port of one Root IM operation, frozen and recorded as issued by this issuer. */
  issue(port: DispatchLeasePort): DispatchLeasePort;
  /** True only for a port this issuer's {@link DispatchLeaseIssuer.issue} returned. */
  isIssued(value: unknown): value is DispatchLeasePort;
  /**
   * #1250 第 85 批: true only for a lease the `retain()` of a port this issuer issued returned (a lease
   * acquired from the store directly, or retained through anything else, is not).
   */
  holds(lease: unknown): boolean;
}

/**
 * @internal Host only (`createHostOperationResources`): a fresh issuer per factory instance. The
 * registry is private to the issuer, never module-wide, so a second factory (a plugin's own) cannot
 * mint ports the first one accepts.
 */
export function createDispatchLeaseIssuer(): DispatchLeaseIssuer {
  const issued = new WeakSet<object>();
  const retained = new WeakSet<object>();
  return Object.freeze({
    issue(port: DispatchLeasePort): DispatchLeasePort {
      const retain = port.retain;
      const frozen: DispatchLeasePort = Object.freeze({
        retain: () => {
          const lease = retain();
          if (typeof lease === 'object' && lease !== null) retained.add(lease);
          return lease;
        },
        ...(port.conversationSequence !== undefined ? { conversationSequence: port.conversationSequence } : {}),
      });
      issued.add(frozen);
      return frozen;
    },
    isIssued: (value: unknown): value is DispatchLeasePort => typeof value === 'object' && value !== null && issued.has(value),
    holds: (lease: unknown): boolean => typeof lease === 'object' && lease !== null && retained.has(lease),
  });
}
