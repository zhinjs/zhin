/**
 * Conversation session keys `<adapter>:<endpointKey>:<kind>:<id>` — the four-segment key IM
 * sessions, Agent traces and the Console agree on (written by `resolveIMSceneSessionId` of
 * `@zhin.js/kernel`). Session keys deliberately omit parent containers and threads.
 *
 * The single parser for the gateway (usage stats), the instance (Console history and inbox checks)
 * and browser pages (#1250 b80). Zero-dependency, like the rest of this package.
 */

export interface ConversationSessionKeyParts {
  /** Adapter instance alias (the platform segment). */
  readonly adapter: string;
  /** Endpoint key under the adapter. */
  readonly endpointKey: string;
  /** Conversation kind segment (`private` / `group` / `channel` for IM sessions). */
  readonly kind: string;
  /** Platform conversation id; may itself contain `:`. */
  readonly id: string;
}

/**
 * Hashed session identities (`personal-session:v1:<sha>`, `scene-task:v1:<sha>`): they carry no
 * address and never parse as a conversation session key.
 */
const HASHED_SESSION_KEY = /^[a-z-]+:v\d+:[0-9a-f]{16,}$/u;

/** Whether `key` is a hashed session identity (`<name>:v<n>:<hex>`), which carries no address. */
export function isHashedSessionKey(key: string): boolean {
  return HASHED_SESSION_KEY.test(key);
}

/**
 * `<adapter>:<endpointKey>:<kind>:<id>`, the key `resolveIMSceneSessionId` writes for the same scene.
 * It does not validate: a key with an empty segment simply never parses or matches a session.
 */
export function formatConversationSessionKey(parts: ConversationSessionKeyParts): string {
  return `${parts.adapter}:${parts.endpointKey}:${parts.kind}:${parts.id}`;
}

/**
 * Parses a four-segment conversation session key; undefined for hashed identities, keys with fewer
 * segments or an empty segment. Everything after the third `:` is the id.
 */
export function parseConversationSessionKey(key: string): ConversationSessionKeyParts | undefined {
  if (typeof key !== 'string' || isHashedSessionKey(key)) return undefined;
  const first = key.indexOf(':');
  const second = key.indexOf(':', first + 1);
  const third = key.indexOf(':', second + 1);
  if (first <= 0 || second <= first + 1 || third <= second + 1 || third >= key.length - 1) return undefined;
  return Object.freeze({
    adapter: key.slice(0, first),
    endpointKey: key.slice(first + 1, second),
    kind: key.slice(second + 1, third),
    id: key.slice(third + 1),
  });
}
