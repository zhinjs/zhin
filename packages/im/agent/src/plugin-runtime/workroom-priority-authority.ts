import { createToken } from '@zhin.js/plugin-runtime';
import { digestCanonicalWorkroomValue } from '../workroom/canonical-value.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type {
  WorkroomPriorityAuthorityPort,
  WorkroomPriorityAuthorizationDecision,
  WorkroomPriorityAuthorizationInput,
} from '../workroom/scheduler-priority-control.js';

export const workroomPriorityAuthorityToken = createToken<WorkroomPriorityAuthorityPort>(
  'zhin.agent.workroom-priority-authority',
  'Generation-owned exact Catalog Sponsor/Orchestrator priority authority',
);

/** Resolves on every call so a retired generation cannot retain priority authority. */
export function createGenerationWorkroomPriorityAuthority(
  resolve: () => WorkroomPriorityAuthorityPort | undefined,
): WorkroomPriorityAuthorityPort {
  return Object.freeze({
    async authorize(input: WorkroomPriorityAuthorizationInput): Promise<WorkroomPriorityAuthorizationDecision> {
      const current = resolve();
      if (!current) return Object.freeze({ authorized: false, reason: 'authority_not_installed' });
      return await current.authorize(input);
    },
  });
}

/** Catalog membership and the admitted Plan pin are the only role authority. */
export function createCatalogWorkroomPriorityAuthority(
  catalog: Pick<WorkroomCatalog, 'read'>,
): WorkroomPriorityAuthorityPort {
  return Object.freeze({
    async authorize(input: WorkroomPriorityAuthorizationInput): Promise<WorkroomPriorityAuthorizationDecision> {
      const snapshot = await catalog.read();
      const proposal = input.proposal;
      const definition = snapshot.definitions[proposal.projectId];
      if (!definition || definition.enabled === false) {
        return Object.freeze({ authorized: false, reason: 'project_not_active' });
      }
      if (snapshot.revision !== input.projectAuthority.catalogRevision
        || digestCanonicalWorkroomValue(definition) !== input.projectAuthority.projectDigest) {
        return Object.freeze({ authorized: false, reason: 'project_authority_stale' });
      }
      if (proposal.authority === 'sponsor') {
        if (!definition.sponsors?.includes(proposal.principalId)) {
          return Object.freeze({ authorized: false, reason: 'principal_is_not_project_sponsor' });
        }
      } else {
        if (proposal.requestedLane !== proposal.currentLane) {
          return Object.freeze({ authorized: false, reason: 'orchestrator_cannot_change_lane' });
        }
        const exactOrchestrator = definition.members.some(member =>
          member.role === 'orchestrator'
          && member.agent === input.projectAuthority.orchestratorAgentDefinitionId
          && member.agent === proposal.principalId);
        if (!exactOrchestrator) {
          return Object.freeze({ authorized: false, reason: 'principal_is_not_pinned_orchestrator' });
        }
      }
      if (proposal.authorityRef !== authorityReference(input)) {
        return Object.freeze({ authorized: false, reason: 'authority_reference_not_exact' });
      }
      return Object.freeze({
        authorized: true,
        authority: proposal.authority,
        principalId: proposal.principalId,
        authorizationRef: proposal.authorityRef,
        proposalDigest: proposal.digest,
      });
    },
  });
}

export function workroomPriorityAuthorityReference(
  input: Pick<WorkroomPriorityAuthorizationInput, 'projectAuthority'> & Readonly<{
    proposal: Pick<WorkroomPriorityAuthorizationInput['proposal'],
      'projectId' | 'authority' | 'principalId'>;
  }>,
): string {
  return authorityReference(input);
}

function authorityReference(input: Readonly<{
  projectAuthority: WorkroomPriorityAuthorizationInput['projectAuthority'];
  proposal: Pick<WorkroomPriorityAuthorizationInput['proposal'],
    'projectId' | 'authority' | 'principalId'>;
}>): string {
  const { proposal, projectAuthority } = input;
  return [
    'workroom-catalog-priority:v1',
    projectAuthority.catalogRevision,
    proposal.projectId,
    projectAuthority.projectDigest,
    proposal.authority,
    proposal.principalId,
  ].map(encodeURIComponent).join(':');
}
