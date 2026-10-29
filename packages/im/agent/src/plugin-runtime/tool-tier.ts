import { resolveTurnTrustLevel, type TrustTurnView } from '../security/trust-level.js';
import type { ToolTier } from '../tool-catalog/types.js';

/**
 * Scene tier of the resident tool set for a turn (ADR 0042 §2).
 *
 * - IM group / channel turns and ordinary private chats: `chat`.
 * - A master's private chat: `master` (adds development tools).
 * - Every other origin (schedule, detached, sub-agent): `full`, the unchanged default set.
 *
 * Roles come from the trusted product ingress. The tier only decides which
 * already-authorized tools start loaded; it never widens the capability ceiling.
 */
export function resolveToolTier(turn: TrustTurnView): ToolTier {
  if (turn.origin.kind !== 'im') return 'full';
  const isMasterPrivate = turn.origin.scope === 'private' && resolveTurnTrustLevel(turn) === 'owner';
  return isMasterPrivate ? 'master' : 'chat';
}
