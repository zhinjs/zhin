import { createDeliveryTarget, encodeTaskTarget, decodeTaskTarget, type DeliveryTarget } from '@zhin.js/plugin-runtime';
import type { GamePlayer } from './command-message.js';

const SCOPE_VERSION = 'game-target-v1:';

/** One reversible scope codec for sessions, records and delayed notifications. */
export function channelKey(player: Pick<GamePlayer, 'target'>): string {
  return SCOPE_VERSION + JSON.stringify(encodeTaskTarget(createDeliveryTarget({ conversation: player.target })));
}

/** Historical alias-only keys cannot prove a destination; callers must not guess an account. */
export function gameTargetFromKey(key: string): DeliveryTarget | undefined {
  if (!key.startsWith(SCOPE_VERSION)) return undefined;
  return decodeTaskTarget(JSON.parse(key.slice(SCOPE_VERSION.length)) as Record<string, unknown>);
}
