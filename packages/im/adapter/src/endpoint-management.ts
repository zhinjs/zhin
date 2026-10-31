import { isEndpoint, endpointRuntimeOf } from './endpoint-specification.js';

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

/** Optional caller lifetime; scoped ports combine it with the exact account incarnation. */
export interface EndpointManagementRequest { readonly signal?: AbortSignal; }
export interface EndpointGroupRequest extends EndpointManagementRequest { readonly groupId: string; }
export interface EndpointUserRequest extends EndpointManagementRequest { readonly userId: string; }
export interface EndpointMemberRequest extends EndpointGroupRequest { readonly userId: string; }
/** Inspection/moderation callers must supply their owned work lifetime. */
export interface EndpointGroupInspectionRequest extends EndpointGroupRequest { readonly signal: AbortSignal; }
export interface EndpointMemberInspectionRequest extends EndpointMemberRequest { readonly signal: AbortSignal; }
export interface EndpointModerationRequest extends EndpointMemberInspectionRequest { readonly action: GroupModerationAction; }
export interface EndpointMuteRequest extends EndpointMemberRequest { readonly durationSeconds: number; }
export interface EndpointAdminRequest extends EndpointMemberRequest { readonly enabled: boolean; }
export interface EndpointApproveRequest extends EndpointManagementRequest { readonly requestId: string; readonly remark?: string; }
export interface EndpointRejectRequest extends EndpointManagementRequest { readonly requestId: string; readonly reason?: string; }
export interface EndpointGroupNoticeRequest extends EndpointGroupRequest { readonly content: string; }

/**
 * Platform-neutral semantic requests. Native SDK method signatures are not changed.
 * Every request carries the lifetime of its work; platforms pass it to owned transports or
 * use an operation scope for SDKs without cancellation. IDs remain platform addresses.
 */
export interface EndpointManagement {
  /** Fresh platform permission, role and join facts; absent means unsupported. */
  inspectGroupMember?(request: EndpointMemberInspectionRequest): Promise<GroupModerationMember>;
  /** Scene name, owner, admins, size and mute facts; missing fields remain unknown. */
  inspectGroupScene?(request: EndpointGroupInspectionRequest): Promise<GroupSceneFacts>;
  inspectGroupMemberProfile?(request: EndpointMemberInspectionRequest): Promise<GroupMemberProfile>;
  /** Recheck membership and platform permissions immediately before any effect. */
  moderateGroupMember?(request: EndpointModerationRequest): Promise<void>;
  listFriends?(request?: EndpointManagementRequest): Promise<readonly EndpointFriend[]>;
  listGroups?(request?: EndpointManagementRequest): Promise<readonly EndpointGroup[]>;
  listChannels?(request?: EndpointManagementRequest): Promise<readonly EndpointChannel[]>;
  listGroupMembers?(request: EndpointGroupRequest): Promise<readonly unknown[]>;
  listRequests?(request?: EndpointManagementRequest): Promise<readonly EndpointPendingRequest[]>;
  approveRequest?(request: EndpointApproveRequest): Promise<void>;
  rejectRequest?(request: EndpointRejectRequest): Promise<void>;
  kickGroupMember?(request: EndpointMemberRequest): Promise<void>;
  muteGroupMember?(request: EndpointMuteRequest): Promise<void>;
  setGroupAdmin?(request: EndpointAdminRequest): Promise<void>;
  deleteFriend?(request: EndpointUserRequest): Promise<void>;
  /** Owner-approved publication remains in its existing policy path, outside Console capabilities. */
  sendGroupNotice?(request: EndpointGroupNoticeRequest): Promise<void>;
}

export { createEndpointOperation } from './endpoint-operation.js';
export type { EndpointOperation, EndpointOperationOptions } from './endpoint-operation.js';

export interface GroupSceneFacts {
  readonly name?: string;
  readonly ownerId?: string;
  readonly adminIds?: readonly string[];
  readonly memberCount?: number;
  /** Whole-group mute currently in force; absent means unknown. */
  readonly muteAll?: boolean;
}

export interface GroupMemberProfile {
  readonly platformRole?: 'owner' | 'admin' | 'member';
  /** Group card (nickname inside the group). */
  readonly card?: string;
  /** Special title. */
  readonly title?: string;
  /** 0 = confirmed not muted; positive = mute expiry in epoch milliseconds; absent = unknown. */
  readonly mutedUntil?: number;
}

export interface GroupModerationMember {
  readonly canModerate: boolean;
  /** Role reported for the requested member in this exact group; absent means unknown. */
  readonly platformRole?: 'owner' | 'admin' | 'member';
  /** Actual platform join time in epoch milliseconds, never inferred from first observation. */
  readonly joinedAt?: number;
}

export type GroupModerationAction =
  | Readonly<{ type: 'mute'; durationSeconds: number }>
  | Readonly<{ type: 'kick'; joinedAt: number; maxMembershipAgeMs: number }>;

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
  const management = isEndpoint(endpoint) ? endpointRuntimeOf(endpoint).management : resolveEndpointManagement(endpoint);
  if (!management) return Object.freeze([]);
  return Object.freeze(endpointManagementCapabilityIds.filter(
    (capability) => typeof management[capability] === 'function',
  ));
}
