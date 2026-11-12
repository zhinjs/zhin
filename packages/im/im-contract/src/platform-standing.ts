/**
 * ADR 0056 §1: normalized platform identity of an inbound sender, reported by the adapter on
 * `sender.platform`. Runtime code reads these fields and never branches on the platform name.
 */
export type PlatformStandingLevel = 'owner' | 'admin' | 'member' | 'guest';

export const PLATFORM_STANDING_LEVELS: readonly PlatformStandingLevel[] = Object.freeze(['owner', 'admin', 'member', 'guest']);

export interface PlatformRoleRef {
  /** Platform-native role id (for example a Discord role snowflake). */
  readonly id: string;
  /** Display name; never used for matching. */
  readonly name?: string;
}

export interface PlatformStanding {
  /** Standing in the conversation: group owner / admin / member / guest. Private chats report `member` (or nothing). */
  readonly standing: PlatformStandingLevel;
  /** Platform-native roles (Discord roles and the like). */
  readonly roles?: readonly PlatformRoleRef[];
  /** Platform-native permissions, as many as the adapter can report. */
  readonly permissions?: readonly string[];
}

export function isPlatformStandingLevel(value: unknown): value is PlatformStandingLevel {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'guest';
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
