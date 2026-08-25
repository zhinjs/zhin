import type {
  WorkroomDefinition,
  WorkroomMemberRole,
  WorkroomSpaceKind,
} from '../workroom/catalog-definition.js';

export interface WorkroomBotIdentityInput {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind: WorkroomSpaceKind;
  readonly id: string;
  /** Required when one portfolio-level Sponsor Room serves multiple Projects. */
  readonly projectId?: string;
}

export interface ResolvedWorkroomBotIdentity {
  readonly projectId: string;
  readonly agent: string;
  readonly role: WorkroomMemberRole;
  readonly space: 'workroom' | 'sponsor_room';
}

/**
 * Resolves presentation/target identity only. Human Workroom ingress must still
 * enter the Orchestrator-owned proposal path; this result grants no Turn or
 * Kernel execution authority to the named member Agent.
 */
export function resolveWorkroomBotIdentity(
  workrooms: Readonly<Record<string, WorkroomDefinition>>,
  input: WorkroomBotIdentityInput,
): ResolvedWorkroomBotIdentity | null {
  const matches = Object.entries(workrooms)
    .filter(([, workroom]) => workroom.enabled !== false)
    .flatMap(([projectId, workroom]) => ([
      ['workroom', workroom.conversation],
      ['sponsor_room', workroom.sponsorConversation],
    ] as const).flatMap(([space, conversation]) => {
      if (!conversation || conversation.kind !== input.kind
        || !sameSpaceId(conversation.kind, conversation.id, input.id)) return [];
      const routedMember = space === 'workroom'
        ? workroom.members.find(member => member.messageRoute?.adapter === input.adapter
          && member.messageRoute.endpoint === input.endpoint)
        : undefined;
      const usesPrimaryEndpoint = conversation.adapter === input.adapter
        && conversation.endpoint === input.endpoint;
      if (!usesPrimaryEndpoint && !routedMember) return [];
      return [(() => {
        const member = routedMember ?? workroom.members.find(
          candidate => candidate.agent === conversation.agent,
        );
        if (!member) {
          throw new Error(`Workroom ${projectId} conversation has no member identity`);
        }
        return { projectId, agent: member.agent, role: member.role, space };
      })()];
    }));
  const selected = input.projectId && matches.every(match => match.space === 'sponsor_room')
    ? matches.filter(match => match.projectId === input.projectId)
    : matches;
  if (input.projectId && matches.length > 0
    && matches.every(match => match.space === 'sponsor_room') && selected.length === 0) {
    throw new Error('Portfolio Sponsor Room explicit Project id is not a member of this room');
  }
  if (selected.length > 1 && selected.every(match => match.space === 'sponsor_room')) {
    throw new Error('Portfolio Sponsor Room requires an explicit Project id');
  }
  if (selected.length > 1) {
    throw new Error(`Conversation ${input.adapter}:${input.endpoint}:${input.kind}:${input.id} belongs to multiple enabled Workrooms`);
  }
  const match = selected[0];
  return match ? Object.freeze(match) : null;
}

function sameSpaceId(kind: WorkroomSpaceKind, configured: string, incoming: string): boolean {
  return kind === 'repository'
    ? configured.toLowerCase() === incoming.toLowerCase()
    : configured === incoming;
}
