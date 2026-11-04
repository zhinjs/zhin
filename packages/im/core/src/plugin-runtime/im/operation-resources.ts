import { createRootPrivateToken, type PluginId, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { OperationResourceView } from '@zhin.js/feature-kit';
import type { RuntimeMessage } from './contracts.js';

/** Trusted composition port. Only Core supplies the controlled message and real held lease. */
export interface ImOperationResourcesInput {
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly message: RuntimeMessage;
  readonly owner: PluginId;
  readonly signal: AbortSignal;
}
export interface ImOperationResourcesPort {
  open(input: ImOperationResourcesInput): OperationResourceView | undefined;
}
export const imOperationResourcesToken = createRootPrivateToken<ImOperationResourcesPort>(
  'zhin.im.operation-resources', 'Host resources for one authorized IM capability operation',
);
