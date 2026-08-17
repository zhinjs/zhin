import { resolveIMSessionIdFromMessage, type Message } from '@zhin.js/core';
import { resolveAgentTurnSessionKey } from './session-key.js';
import type { SessionStrategy } from './contracts.js';

export class GroupSessionStrategy implements SessionStrategy {
  resolveSessionKey(message: Message): string {
    return resolveAgentTurnSessionKey(message);
  }

  shouldArchive(message: Message): boolean {
    return message.$channel?.type === 'group';
  }
}

export class SimpleSessionStrategy implements SessionStrategy {
  resolveSessionKey(message: Message): string {
    return resolveIMSessionIdFromMessage(message);
  }

  shouldArchive(_message: Message): boolean {
    return false;
  }
}
