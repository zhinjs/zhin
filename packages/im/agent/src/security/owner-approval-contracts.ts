import type { DeliveryTarget } from '@zhin.js/plugin-runtime';

/** Existing Owner-wide policy, anchored to the non-reusable logical account identity. */
export interface OwnerApprovalAddress {
  readonly endpoint: DeliveryTarget['endpoint'];
  readonly ownerId: string;
}
