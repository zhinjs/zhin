import { createToken } from '@zhin.js/plugin-runtime';
import { digestCanonicalWorkroomValue } from '../workroom/canonical-value.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type {
  WorkroomPlanGateAuthorityPort,
  WorkroomPlanGateAuthorizationDecision,
  WorkroomPlanGateAuthorizationInput,
} from '../workroom/plan-approval-control.js';

export const workroomPlanGateAuthorityToken = createToken<WorkroomPlanGateAuthorityPort>(
  'zhin.agent.workroom-plan-gate-authority',
  'Generation-owned authenticated human Sponsor authority for pre-execution Plan Gates',
);

export function createGenerationWorkroomPlanGateAuthority(
  resolve: () => WorkroomPlanGateAuthorityPort | undefined,
): WorkroomPlanGateAuthorityPort {
  return Object.freeze({
    async authorize(input: WorkroomPlanGateAuthorizationInput): Promise<WorkroomPlanGateAuthorizationDecision> {
      const current = resolve();
      if (!current) return Object.freeze({ authorized: false, reason: 'authority_not_installed' });
      return await current.authorize(input);
    },
  });
}

/** Persistent Catalog membership is the authority; message metadata is never consulted. */
export function createCatalogWorkroomPlanGateAuthority(
  catalog: WorkroomCatalog,
): WorkroomPlanGateAuthorityPort {
  return Object.freeze({
    async authorize(input: WorkroomPlanGateAuthorizationInput): Promise<WorkroomPlanGateAuthorizationDecision> {
      const snapshot = await catalog.read();
      const definition = snapshot.definitions[input.projectId];
      if (!definition || definition.enabled === false) {
        return Object.freeze({ authorized: false, reason: 'project_not_active' });
      }
      if (digestCanonicalWorkroomValue(definition) !== input.projectDigest) {
        return Object.freeze({ authorized: false, reason: 'project_authority_stale' });
      }
      if (!definition.sponsors?.includes(input.sponsorPrincipalId)) {
        return Object.freeze({ authorized: false, reason: 'principal_is_not_project_sponsor' });
      }
      if (!/^human-ingress:sha256:[a-f0-9]{64}$/u.test(input.sponsorAuthorityRef)) {
        return Object.freeze({ authorized: false, reason: 'principal_source_proof_invalid' });
      }
      return Object.freeze({
        authorized: true,
        principalId: input.sponsorPrincipalId,
        authorizationRef: `workroom-catalog:${encodeURIComponent(input.projectRevision)}:${encodeURIComponent(input.projectId)}:sponsor:${encodeURIComponent(input.sponsorPrincipalId)}`,
      });
    },
  });
}
