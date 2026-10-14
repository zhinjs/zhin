/**
 * Room / Member / Role definition types (pure data, no runtime dependencies).
 *
 * A Room binds one IM conversation to a small team of Agents. Each member speaks through its own
 * Bot account. A coordinator is optional; without one, work is matched by Role.
 */

/** Room id pattern (key of the rooms record). */
export const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Role name pattern. */
export const ROOM_ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
/** Member alias pattern (used for @ matching). */
export const ROOM_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** Maximum number of members in one Room. */
export const ROOM_MAX_MEMBERS = 16;
/** Allowed conversation kinds. */
export const ROOM_CONVERSATION_KINDS = ['group', 'channel'] as const;
/** Names that can never be used as room id or role name (prototype pollution guard). */
export const ROOM_RESERVED_NAMES: readonly string[] = ['__proto__', 'constructor', 'prototype'];

export type RoomConversationKind = (typeof ROOM_CONVERSATION_KINDS)[number];

export interface RoomConversationBinding {
  adapter: string;
  endpoint: string;
  kind: RoomConversationKind;
  id: string;
}

export interface RoomRoleDefinition {
  description?: string;
  /** Instruction prompt for members holding this role. */
  prompt: string;
  /**
   * Upper bound of tools this role may use. When omitted, nothing extra is granted; the existing
   * security policy alone decides.
   */
  tools?: readonly string[];
  /** Task categories this role accepts. When omitted, any category is accepted. */
  accepts?: readonly string[];
  /**
   * Role names this role may hand off to. When omitted, handoff is NOT allowed
   * (least privilege, fail-closed). Must not reference the role itself.
   */
  handoffTo?: readonly string[];
}

export interface RoomMemberBotEndpoint {
  adapter: string;
  endpoint: string;
}

export interface RoomMemberDefinition {
  /** Agent name; one member is exactly one Agent. */
  agent: string;
  /** Key of `roles`. */
  role: string;
  /** Dedicated Bot account this member speaks with; not shared within a Room. */
  botEndpoint: RoomMemberBotEndpoint;
  /** Optional @ aliases; unique within the Room (case-insensitive, including agent names). */
  aliases?: readonly string[];
}

export interface RoomDefinition {
  name: string;
  description?: string;
  /** Defaults to enabled; `false` keeps structural validation but skips cross-room conflicts. */
  enabled?: boolean;
  conversation: RoomConversationBinding;
  roles: Record<string, RoomRoleDefinition>;
  members: readonly RoomMemberDefinition[];
  /** Optional; must be the agent name of a member. */
  coordinator?: string;
}
