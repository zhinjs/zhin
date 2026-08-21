import { describe, expect, it } from 'vitest';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import {
  createCatalogWorkroomPlanGateAuthority,
  createGenerationWorkroomPlanGateAuthority,
} from '../../src/plugin-runtime/workroom-plan-gate-authority.js';
import type { WorkroomPlanGateAuthorizationInput } from '../../src/workroom/plan-approval-control.js';

const definition = Object.freeze({
  name: 'Project', enabled: true,
  members: Object.freeze([{ agent: 'orchestrator', role: 'orchestrator' as const }]),
  sponsors: Object.freeze(['owner:human-1']),
  conversation: Object.freeze({
    adapter: 'sandbox', endpoint: 'bot', kind: 'group' as const, id: 'group-1', agent: 'orchestrator',
  }),
});

const input: WorkroomPlanGateAuthorizationInput = Object.freeze({
  version: 1,
  operationId: 'operation-1', projectId: 'project-1', runId: 'run-1',
  taskKey: 'publish', taskRevision: 1, gateId: 'approval:publish', expectedSequence: 3,
  decision: 'approve', reason: 'Approved', sponsorPrincipalId: 'owner:human-1',
  sponsorAuthorityRef: `human-ingress:sha256:${'1'.repeat(64)}`,
  planProposalId: 'proposal-1', planDigest: `sha256:${'2'.repeat(64)}`,
  projectRevision: 'catalog-1', projectDigest: digestCanonicalWorkroomValue(definition),
  sourceParameterDigest: `sha256:${'3'.repeat(64)}`,
  profileRevisionId: 'profile-1', profileDigest: `sha256:${'4'.repeat(64)}`,
  policyRevisionId: 'policy-1', policyDigest: `sha256:${'5'.repeat(64)}`,
  gateOwner: 'project-sponsor', gateDeadline: 1_000,
});

describe('Workroom Plan Gate generation authority', () => {
  it('authorizes only an exact persistent Catalog Sponsor membership', async () => {
    const authority = createCatalogWorkroomPlanGateAuthority({
      read: async () => Object.freeze({
        revision: 'catalog-1', definitions: Object.freeze({ 'project-1': definition }),
      }),
      replace: async () => { throw new Error('not used'); },
    });

    await expect(authority.authorize(input)).resolves.toMatchObject({
      authorized: true, principalId: 'owner:human-1',
      authorizationRef: expect.stringContaining('workroom-catalog:'),
    });
    await expect(authority.authorize({ ...input, sponsorPrincipalId: 'owner:other' }))
      .resolves.toEqual({ authorized: false, reason: 'principal_is_not_project_sponsor' });
    await expect(authority.authorize({ ...input, projectDigest: `sha256:${'0'.repeat(64)}` }))
      .resolves.toEqual({ authorized: false, reason: 'project_authority_stale' });
  });

  it('resolves the current generation on every decision and fails closed without one', async () => {
    let current = createCatalogWorkroomPlanGateAuthority({
      read: async () => Object.freeze({ revision: 'catalog-1', definitions: Object.freeze({ 'project-1': definition }) }),
      replace: async () => { throw new Error('not used'); },
    });
    const proxy = createGenerationWorkroomPlanGateAuthority(() => current);
    await expect(proxy.authorize(input)).resolves.toMatchObject({ authorized: true });
    current = undefined as never;
    await expect(proxy.authorize(input)).resolves.toEqual({ authorized: false, reason: 'authority_not_installed' });
  });
});
