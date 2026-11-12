/**
 * ADR 0056 §1: the sender's platform standing, reported by the Adapter in one normalized shape.
 *
 * `standing` is the sender's position in the conversation (group owner / admin / member / guest);
 * `roles` are platform-native roles (e.g. Discord guild roles) and `permissions` platform-native
 * permission names, reported as far as the platform exposes them. Private chats report `member`
 * or nothing. Which of the three fields an Adapter reports is declared in its capability profile
 * (`scene.platformStanding`), never inferred from the platform name.
 *
 * The same shape describes the receiving Bot account's own standing in a conversation
 * ({@link SelfStandingRequest}; capability `scene.selfStanding`), read by `bot:*` permits.
 * Platform standing is never converted into a zhin chat role (ADR 0056 §4, revised 2026-11-12).
 */
export type PlatformStandingLevel = 'owner' | 'admin' | 'member' | 'guest';

export const PLATFORM_STANDING_LEVELS: readonly PlatformStandingLevel[] = Object.freeze(['guest', 'member', 'admin', 'owner']);

export interface PlatformRoleRef {
  readonly id: string;
  readonly name?: string;
}

export interface PlatformStanding {
  readonly standing: PlatformStandingLevel;
  readonly roles?: readonly PlatformRoleRef[];
  readonly permissions?: readonly string[];
}

export function isPlatformStandingLevel(value: unknown): value is PlatformStandingLevel {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'guest';
}

/** `owner` and `admin` standings (the conversation's managers). */
export function isPlatformManager(platform: Pick<PlatformStanding, 'standing'> | undefined): boolean {
  return platform?.standing === 'owner' || platform?.standing === 'admin';
}

const MAX_ENTRIES = 256;
const MAX_TEXT = 256;

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TEXT ? trimmed : undefined;
}

/**
 * Validates an adapter-reported standing and returns a frozen copy, or `undefined` when the value
 * is not a standing. Malformed role / permission entries are dropped, duplicates collapsed.
 */
export function normalizePlatformStanding(value: unknown): PlatformStanding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as { standing?: unknown; roles?: unknown; permissions?: unknown };
  if (!isPlatformStandingLevel(input.standing)) return undefined;
  const roles: PlatformRoleRef[] = [];
  if (Array.isArray(input.roles)) {
    const seen = new Set<string>();
    for (const entry of input.roles.slice(0, MAX_ENTRIES)) {
      const id = text(entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = text((entry as { name?: unknown }).name);
      roles.push(Object.freeze({ id, ...(name ? { name } : {}) }));
    }
  }
  const permissions = Array.isArray(input.permissions)
    ? [...new Set(input.permissions.slice(0, MAX_ENTRIES).map(text).filter((item): item is string => !!item))]
    : [];
  return Object.freeze({
    standing: input.standing,
    ...(roles.length ? { roles: Object.freeze(roles) } : {}),
    ...(permissions.length ? { permissions: Object.freeze(permissions) } : {}),
  });
}

/** Structural check of an adapter-reported value; malformed role / permission entries are not accepted. */
export function isPlatformStanding(value: unknown): value is PlatformStanding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PlatformStanding>;
  if (!isPlatformStandingLevel(candidate.standing)) return false;
  if (candidate.roles !== undefined && !(Array.isArray(candidate.roles)
    && candidate.roles.every(role => !!role && typeof role === 'object' && typeof role.id === 'string' && role.id.length > 0))) return false;
  if (candidate.permissions !== undefined && !(Array.isArray(candidate.permissions)
    && candidate.permissions.every(permission => typeof permission === 'string' && permission.length > 0))) return false;
  return true;
}

/**
 * ADR 0056 §1: ask the platform for the receiving Bot account's own standing in one conversation.
 * Adapters implement it as `EndpointManagement.inspectSelfStanding` and declare
 * `scene.selfStanding` in their capability profile; the framework caches the answer per
 * conversation and drops it on the Bot's own role-change events.
 */
export interface SelfStandingRequest {
  readonly conversation: Readonly<{
    readonly kind: 'private' | 'group' | 'channel';
    readonly id: string;
    readonly parent?: Readonly<{ readonly kind: 'private' | 'group' | 'channel'; readonly id: string }>;
    readonly threadId?: string;
  }>;
  readonly signal: AbortSignal;
}

/** Map a member-role word reported by a platform (`owner` / `admin` / `member`) to a standing. */
export function standingFromMemberRole(role: unknown): PlatformStanding | undefined {
  return role === 'owner' || role === 'admin' || role === 'member' ? Object.freeze({ standing: role }) : undefined;
}
