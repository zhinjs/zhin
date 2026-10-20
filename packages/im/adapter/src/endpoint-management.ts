export interface EndpointFriend {
  /** 数字平台（QQ 系）用 number；Slack/LINE/微信系用 string。 */
  readonly user_id: number | string;
  readonly nickname: string;
  readonly remark: string;
}

export interface EndpointGroup {
  /** 数字平台（QQ 系）用 number；Slack/LINE/微信系用 string。 */
  readonly group_id: number | string;
  readonly name: string;
}

export interface EndpointChannelParent {
  readonly type: string;
  readonly id: string;
  readonly name?: string;
}

export interface EndpointChannel {
  readonly id: string;
  readonly name?: string;
  readonly parent?: EndpointChannelParent;
}

/** Pending friend/group request for Console / Host listing (live, not inbox DB). */
export interface EndpointPendingRequest {
  readonly platform_request_id: string;
  readonly type: string;
  readonly scene_type?: string | null;
  readonly scene_id: string;
  readonly sub_type?: string | null;
  readonly actor_id: string;
  readonly actor_name?: string | null;
  readonly comment?: string | null;
  readonly created_at: number;
}

/**
 * Optional, platform-neutral management surface exposed by an Endpoint.
 *
 * Platform adapters own SDK aliases, identifier coercion, and response
 * normalization. Hosts consume this interface without inspecting adapter
 * names or transport-specific fields.
 */
export interface EndpointManagement {
  listFriends?(): Promise<readonly EndpointFriend[]>;
  listGroups?(): Promise<readonly EndpointGroup[]>;
  listChannels?(): Promise<readonly EndpointChannel[]>;
  listGroupMembers?(groupId: string): Promise<readonly unknown[]>;
  /** Live pending friend/group requests (preferred over unified_inbox_request). */
  listRequests?(): Promise<readonly EndpointPendingRequest[]>;
  approveRequest?(requestId: string, remark?: string): Promise<void>;
  rejectRequest?(requestId: string, reason?: string): Promise<void>;
  kickGroupMember?(groupId: string, userId: string): Promise<void>;
  muteGroupMember?(groupId: string, userId: string, durationSeconds: number): Promise<void>;
  setGroupAdmin?(groupId: string, userId: string, enabled: boolean): Promise<void>;
  deleteFriend?(userId: string): Promise<void>;
}

export interface EndpointWithManagement {
  readonly management?: EndpointManagement;
}

/**
 * Stable, transport-neutral capability ids exposed to Host/Console clients.
 * Values intentionally mirror EndpointManagement method names so adapters only
 * need to implement the semantic port; no second capability declaration exists.
 */
export const endpointManagementCapabilityIds = [
  'listFriends',
  'listGroups',
  'listChannels',
  'listGroupMembers',
  'listRequests',
  'approveRequest',
  'rejectRequest',
  'kickGroupMember',
  'muteGroupMember',
  'setGroupAdmin',
  'deleteFriend',
] as const;

export type EndpointManagementCapability =
  (typeof endpointManagementCapabilityIds)[number];

export function resolveEndpointManagement(endpoint: unknown): EndpointManagement | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const management = (endpoint as EndpointWithManagement).management;
  return management && typeof management === 'object' ? management : undefined;
}

/** Derive advertised capabilities from the live semantic port implementation. */
export function listEndpointManagementCapabilities(
  endpoint: unknown,
): readonly EndpointManagementCapability[] {
  const management = resolveEndpointManagement(endpoint);
  if (!management) return Object.freeze([]);
  return Object.freeze(endpointManagementCapabilityIds.filter(
    (capability) => typeof management[capability] === 'function',
  ));
}
