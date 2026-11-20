import { describe, expect, it } from 'vitest';
import {
  formatConversationSessionKey, isHashedSessionKey, parseConversationSessionKey,
} from '../../packages/console/protocol/src/session-key.js';
import { resolveIMSessionId } from '../../packages/im/kernel/src/im-identity.js';

/**
 * Conversation session keys (#1250 b80): the kernel writes them for IM sessions, the Console wire
 * contract owns the one parser (gateway usage stats, instance history / inbox, Sandbox page).
 */
describe('conversation session key', () => {
  it('parses what the kernel writes, ids with : included', () => {
    for (const scene of [
      { platform: 'sandbox', endpointKey: 'sandbox-bot', kind: 'group', sceneId: 'planning-room' },
      { platform: 'qq', endpointKey: '10001', kind: 'private', sceneId: 'u:1:x' },
      { platform: 'discord', endpointKey: 'bot', kind: 'channel', sceneId: '123/456' },
      // A scene without an endpoint key: the kernel writes an empty second segment.
      { platform: 'qq', endpointKey: '', kind: 'private', sceneId: '1' },
    ] as const) {
      const key = resolveIMSessionId(scene);
      const parts = { adapter: scene.platform, endpointKey: scene.endpointKey, kind: scene.kind, id: scene.sceneId };
      expect(parseConversationSessionKey(key)).toEqual(parts);
      expect(formatConversationSessionKey(parts)).toBe(key);
    }
  });

  it('refuses hashed identities, short keys and empty segments', () => {
    for (const key of ['personal-session:v1:' + 'a'.repeat(64), 'a:b:c', 'weird', '', ':bot:group:1', 'qq:bot::1', 'qq:bot:group:']) {
      expect(parseConversationSessionKey(key), key).toBeUndefined();
    }
    expect(isHashedSessionKey('scene-task:v1:' + 'b'.repeat(64))).toBe(true);
    expect(isHashedSessionKey('qq:bot:group:1')).toBe(false);
  });
});
