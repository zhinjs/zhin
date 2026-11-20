/**
 * zhinjs/zhin#1250 第 83 批: the generation a command operation was dispatched in, as an operation
 * resource. `createHostOperationResources` binds it to the exact lease the IM runtime holds for the
 * message (the one Core hands to `imOperationResourcesToken.open`), so an Agent management Root
 * command retains the generation that dispatched it, not whichever generation is current by then.
 *
 * Internal module: deliberately not re-exported. The resource view checks token identity, and
 * (#1250 第 84 批) offers it only to operations whose owner is the Root plugin, so a plugin that
 * deep-imports this module still cannot retain (and pin) a dispatching generation. A Root operation a
 * plugin dispatched (its message view was bound from a plugin author, `delegatedFrom`) does not get it
 * either; it gets {@link dispatchLeaseWithheldToken} instead, so a command that needs the lease can
 * tell the sender to send it directly.
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
