/**
 * Coordination plane — Cell, endpoint identity, IM delegation.
 * Re-exports collaboration module during migration.
 */
export * from '../../collaboration/index.js';
export {
  resolveMemberBySender,
  resolveEndpointIdsForMember,
  isInboundFromPeerBot,
} from '../../collaboration/endpoint-identity.js';
