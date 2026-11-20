/**
 * zhinjs/zhin#1250 第 83 批: the generation a command operation was dispatched in, as an operation
 * resource. `createHostOperationResources` binds it to the exact lease the IM runtime holds for the
 * message (the one Core hands to `imOperationResourcesToken.open`), so an Agent management Root
 * command retains the generation that dispatched it, not whichever generation is current by then.
 *
 * Internal module: deliberately not re-exported. The resource view checks token identity, so only
 * code holding this object (the Agent management commands) can read it.
 */
import { createRootPrivateToken, type SnapshotLease } from '@zhin.js/plugin-runtime';

export interface DispatchLeasePort {
  /** An independent lease on the dispatching generation; the caller releases it. */
  retain(): SnapshotLease;
}

export const dispatchLeaseToken = createRootPrivateToken<DispatchLeasePort>(
  'zhin.agent.dispatch-lease', 'The generation one IM command operation was dispatched in',
);
