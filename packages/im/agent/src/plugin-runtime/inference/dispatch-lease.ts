/**
 * zhinjs/zhin#1250 第 83 批: the generation a command operation was dispatched in, as an operation
 * resource. `createHostOperationResources` binds it to the exact lease the IM runtime holds for the
 * message (the one Core hands to `imOperationResourcesToken.open`), so an Agent management Root
 * command retains the generation that dispatched it, not whichever generation is current by then.
 *
 * Internal module: deliberately not re-exported. Token identity is not the guard (#1250 第 84 批):
 * a token's id is readable, and a caller of `CommandIndex.dispatch` may pass its own `operation`
 * factory whose resource view answers `has` / `use` for any token. What a command accepts as the
 * dispatch lease is a port the Host issued ({@link issueDispatchLease}, recorded in a module-private
 * WeakSet and checked with {@link isIssuedDispatchLease}); anything else is no lease at all. The Host
 * issues it only to operations whose owner is the Root plugin and that no plugin dispatched (a
 * message view bound from a plugin author, `delegatedFrom`); a plugin-dispatched Root operation gets
 * {@link dispatchLeaseWithheldToken} instead, and a command that needs the lease tells the sender to
 * send it directly.
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

/** Ports the Host issued; a look-alike object (same shape, same token) is not in here. */
const issuedDispatchLeases = new WeakSet<object>();

/**
 * @internal Host only (`createHostOperationResources`): the dispatch lease port of one Root IM
 * operation, frozen and recorded as Host-issued.
 */
export function issueDispatchLease(port: DispatchLeasePort): DispatchLeasePort {
  const issued: DispatchLeasePort = Object.freeze({
    retain: port.retain,
    ...(port.conversationSequence !== undefined ? { conversationSequence: port.conversationSequence } : {}),
  });
  issuedDispatchLeases.add(issued);
  return issued;
}

/** True only for a port {@link issueDispatchLease} returned: what a resource view hands out is checked, not trusted. */
export function isIssuedDispatchLease(value: unknown): value is DispatchLeasePort {
  return typeof value === 'object' && value !== null && issuedDispatchLeases.has(value);
}
