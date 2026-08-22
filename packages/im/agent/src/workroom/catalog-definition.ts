export type WorkroomMemberRole = 'orchestrator' | 'executor' | 'reviewer' | 'integration';

/**
 * Persisted Assignment locality authority. An omitted route is the legacy
 * canonical local route; remote execution always requires an exact endpoint.
 */
export type WorkroomAssignmentRouteDefinition =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly endpointId: string };

/** One named Agent participating in a Project-scoped Workroom. */
export interface WorkroomAgentMemberDefinition {
  /** References ai.agents.<name>. */
  agent: string;
  role: WorkroomMemberRole;
  assignmentRoute?: WorkroomAssignmentRouteDefinition;
}

export type WorkroomSpaceKind = 'group' | 'channel' | 'repository';

/** Binds one collaboration space, reached through a Bot/App Endpoint, to a Workroom. */
export interface WorkroomConversationBindingDefinition {
  adapter: string;
  endpoint: string;
  kind: WorkroomSpaceKind;
  /** Platform-native scene id, or canonical owner/repo for repository bindings. */
  id: string;
  /** Must reference an Agent present in members and holding the orchestrator role. */
  agent: string;
}

/** Console/API-authored entry in the persistent Workroom Catalog. */
export interface WorkroomDefinition {
  name: string;
  description?: string;
  enabled?: boolean;
  members: WorkroomAgentMemberDefinition[];
  /** Authenticated human principal ids allowed to decide typed Project Sponsor controls. */
  sponsors?: string[];
  /** One Workroom owns one collaboration space; an Endpoint may serve many Workrooms. */
  conversation?: WorkroomConversationBindingDefinition;
  /** Optional distinct collaboration space for authenticated Sponsor controls and projections. */
  sponsorConversation?: WorkroomConversationBindingDefinition;
}

/** @deprecated Use WorkroomAgentMemberDefinition. */
export type WorkroomAgentMemberConfig = WorkroomAgentMemberDefinition;
/** @deprecated Use WorkroomConversationBindingDefinition. */
export type WorkroomConversationBindingConfig = WorkroomConversationBindingDefinition;
/** @deprecated Use WorkroomDefinition. */
export type WorkroomDefinitionConfig = WorkroomDefinition;
