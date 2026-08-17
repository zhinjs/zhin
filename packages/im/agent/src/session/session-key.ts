import { resolveIMSessionIdFromMessage, type Message } from '@zhin.js/core';

/** Stable transport session key for the remaining classic Agent turn path. */
export function resolveAgentTurnSessionKey(message: Message): string {
  return resolveIMSessionIdFromMessage(message);
}
