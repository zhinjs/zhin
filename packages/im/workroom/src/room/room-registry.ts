import type { RoomDefinition, RoomMemberDefinition, RoomRoleDefinition } from './room-definition.js';

/** Minimal conversation shape the registry needs (structurally compatible with core's ConversationRef). */
export interface RoomConversationLike {
  readonly endpoint: { readonly adapter: string };
  readonly kind: string;
  readonly id: string;
  readonly threadId?: string;
}

export interface RoomMemberEntry {
  readonly roomId: string;
  readonly agent: string;
  readonly roleName: string;
  readonly role: RoomRoleDefinition;
  readonly definition: RoomMemberDefinition;
  /** Runtime Endpoint id of the member's dedicated Bot. */
  readonly endpointId: string;
  /** Agent name and aliases, lower-cased. */
  readonly names: readonly string[];
}

export interface RoomEntry {
  readonly id: string;
  readonly definition: RoomDefinition;
  /** Declaration order. */
  readonly members: readonly RoomMemberEntry[];
  readonly coordinator?: RoomMemberEntry;
  memberByEndpoint(endpointId: string): RoomMemberEntry | undefined;
  memberByAgent(agent: string): RoomMemberEntry | undefined;
  /** Case-insensitive agent name / alias lookup. */
  memberByAlias(name: string): RoomMemberEntry | undefined;
  /** Member whose Bot account (resolved through `accountOf`) equals `account`. */
  memberByAccount(account: string, accountOf: (endpointId: string) => string | undefined): RoomMemberEntry | undefined;
}

export interface RoomRegistry {
  /**
   * Room owning a conversation. Keyed by `adapter:kind:id` (endpoint excluded, same scope as the
   * outbound ledger). A Room binding carries no thread: messages in a thread belong to the Room of
   * the parent conversation.
   */
  roomOf(conversation: RoomConversationLike): RoomEntry | undefined;
  room(roomId: string): RoomEntry | undefined;
  memberByEndpoint(roomId: string, endpointId: string): RoomMemberEntry | undefined;
  memberByAccount(
    roomId: string,
    account: string,
    accountOf: (endpointId: string) => string | undefined,
  ): RoomMemberEntry | undefined;
  rooms(): readonly RoomEntry[];
}

export function roomConversationKey(adapter: string, kind: string, id: string): string {
  return `${adapter}:${kind}:${id}`;
}

/**
 * Builds the in-memory index of enabled Rooms.
 *
 * `resolveEndpointId` maps a member's declared `{adapter, endpoint}` (configuration names) to the
 * runtime Endpoint id (CapabilityId string); the host supplies it because the mapping depends on
 * how Adapter endpoints are published.
 */
export function createRoomRegistry(
  rooms: Readonly<Record<string, RoomDefinition>>,
  resolveEndpointId: (bot: { adapter: string; endpoint: string }) => string,
): RoomRegistry {
  const byConversation = new Map<string, RoomEntry>();
  const byId = new Map<string, RoomEntry>();

  for (const [roomId, definition] of Object.entries(rooms)) {
    if (definition.enabled === false) continue;
    const members: RoomMemberEntry[] = definition.members.map((member) => {
      const role = definition.roles[member.role];
      if (!role) throw new Error(`Room ${roomId}: member ${member.agent} references unknown role ${member.role}`);
      return Object.freeze({
        roomId,
        agent: member.agent,
        roleName: member.role,
        role,
        definition: member,
        endpointId: resolveEndpointId(member.botEndpoint),
        names: Object.freeze([member.agent, ...(member.aliases ?? [])].map((name) => name.toLowerCase())),
      });
    });
    const byEndpoint = new Map(members.map((member) => [member.endpointId, member] as const));
    const byAgent = new Map(members.map((member) => [member.agent, member] as const));
    const byName = new Map<string, RoomMemberEntry>();
    for (const member of members) for (const name of member.names) if (!byName.has(name)) byName.set(name, member);
    const coordinator = definition.coordinator !== undefined ? byAgent.get(definition.coordinator) : undefined;
    const entry: RoomEntry = Object.freeze({
      id: roomId,
      definition,
      members: Object.freeze(members),
      ...(coordinator ? { coordinator } : {}),
      memberByEndpoint: (endpointId: string) => byEndpoint.get(endpointId),
      memberByAgent: (agent: string) => byAgent.get(agent),
      memberByAlias: (name: string) => byName.get(name.toLowerCase()),
      memberByAccount: (account: string, accountOf: (endpointId: string) => string | undefined) =>
        members.find((member) => accountOf(member.endpointId) === account),
    });
    byId.set(roomId, entry);
    const { adapter, kind, id } = definition.conversation;
    const key = roomConversationKey(adapter, kind, id);
    // Conversation ownership is validated upstream; first enabled Room wins defensively.
    if (!byConversation.has(key)) byConversation.set(key, entry);
  }

  return Object.freeze({
    roomOf: (conversation: RoomConversationLike) =>
      byConversation.get(roomConversationKey(conversation.endpoint.adapter, conversation.kind, conversation.id)),
    room: (roomId: string) => byId.get(roomId),
    memberByEndpoint: (roomId: string, endpointId: string) => byId.get(roomId)?.memberByEndpoint(endpointId),
    memberByAccount: (roomId: string, account: string, accountOf: (endpointId: string) => string | undefined) =>
      byId.get(roomId)?.memberByAccount(account, accountOf),
    rooms: () => Object.freeze([...byId.values()]),
  });
}
