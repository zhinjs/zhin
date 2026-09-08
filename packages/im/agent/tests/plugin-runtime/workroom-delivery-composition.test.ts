import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import { createWorkroomEffectIntent } from '../../src/workroom/effect-ledger.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { installWorkroomEffectResources } from '../../src/plugin-runtime/workroom-effect-composition.js';
import { workroomPersistedEffectAuthorizationFactsToken } from '../../src/plugin-runtime/workroom-effect-production.js';
import {
  workroomDeliveryProviderToken,
  type WorkroomDeliveryObservation,
  type WorkroomDeliveryRequest,
  type WorkroomDeliveryProviderPort,
} from '../../src/plugin-runtime/workroom-delivery-gateway.js';

const sha = (value: string) => `sha256:${value.repeat(64)}`;

describe('standard Workroom delivery composition', () => {
  it('blocks missing provider, dispatches when installed, and queries only after a new generation restarts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-delivery-composition-'));
    await mkdir(join(projectRoot, '.zhin'));
    const resources = new Scope(rootPluginId());
    const intent = createWorkroomEffectIntent({
      projectId: 'project', runId: 'run', taskKey: 'release', taskRevision: 1,
      candidateHash: sha('a'), capability: { ref: 'ci:trusted', digest: sha('b') },
      operation: { kind: 'delivery_release', parameters: {
        repositoryId: 'github:owner/repo', headSha: 'a'.repeat(40), artifactDigest: sha('c'),
        environment: 'staging', pipelineRef: 'pipeline:release:v1',
      } },
      target: { ref: 'environment:staging', digest: sha('d') },
      preconditions: [{ ref: 'ci:run:42', digest: sha('e') }],
      risk: { assessmentRef: 'risk:release', assessmentDigest: sha('f'), tier: 'high' },
      reversibility: { kind: 'irreversible' }, idempotencyKey: 'release:42', createdAt: 10,
    });
    const facts = {
      version: 1 as const, projectId: intent.projectId, runId: intent.runId,
      intentId: intent.id, intentDigest: intent.digest, candidateHash: intent.candidateHash,
      risk: { assessmentRef: intent.risk.assessmentRef, assessmentDigest: intent.risk.assessmentDigest },
      policy: { id: 'release-policy', revision: 1, digest: sha('1') },
      policyDecision: { ref: 'release-policy:decision', digest: sha('2') },
      scope: { assignmentAttempt: 1, workspaceFence: 1, workspaceRef: intent.target.ref,
        workspaceDigest: intent.target.digest, preconditionsDigest: digest(intent.preconditions), deadline: 200 },
      sponsor: { decision: 'approved' as const, decisionRef: 'sponsor:decision',
        decisionDigest: sha('3'), principalId: 'sponsor' },
      authorizationId: 'authorization:release', issuedAt: 90, expiresAt: 200,
    };
    const resolve = vi.fn(async () => facts);
    resources.provide(workroomPersistedEffectAuthorizationFactsToken, { resolve });
    const observe = (request: WorkroomDeliveryRequest, health: 'pending' | 'passed'): WorkroomDeliveryObservation => ({
      effectId: request.effectId, intentDigest: request.intentDigest, idempotencyKey: request.idempotencyKey,
      target: request.target, candidateHash: request.candidateHash, deploymentRef: 'deploy:42',
      receiptRef: `deploy:42:${health}`, status: 'succeeded', health, observedAt: 100,
      authenticatedBy: 'ci:trusted',
    });
    const provider: WorkroomDeliveryProviderPort = {
      provider: { id: intent.capability.ref, digest: intent.capability.digest },
      inspect: vi.fn(async request => ({
        target: request.target, candidateHash: request.candidateHash, targetDigest: request.targetDigest,
        evidenceRef: 'ci:run:42', evidenceDigest: sha('e'),
        checks: [{ id: 'test-and-review', status: 'passed' as const }], observedAt: 90, expiresAt: 200,
      })),
      dispatch: vi.fn(async request => observe(request, 'pending')),
      query: vi.fn(async request => observe(request, 'passed')),
    };
    const install = (scope: Scope, generation: number) => installWorkroomEffectResources({
      projectRoot, generation, signal: new AbortController().signal, resources: scope,
      projects: { listProjectIds: async () => ['project'] }, clock: { read: async () => 100 }, now: () => 100,
      blockerPolicy: { resolve: async () => ({
        owner: 'release-operator', deadline: 200,
        policy: { kind: 'root_emergency_fallback', ref: 'release-recovery', digest: sha('4') },
        allowedSuccessors: ['retry', 'reconcile', 'cancel'],
      }) },
    });
    const first = install(resources, 1);
    let restarted: ReturnType<typeof install> | undefined;
    try {
      await first.intents.record(intent);
      await first.runtime.drain();
      expect(await first.blockers.read('project', intent.id)).toMatchObject({
        status: 'blocked', reason: 'Trusted delivery provider is unavailable',
      });
      expect(resolve).not.toHaveBeenCalled();
      resources.provide(workroomDeliveryProviderToken, provider);
      expect(await first.runtime.drain()).toEqual([expect.objectContaining({ status: 'outcome_unknown' })]);
      expect(await first.blockers.read('project', intent.id)).toMatchObject({
        status: 'blocked', allowedSuccessors: ['reconcile'],
      });
      await first.runtime.dispose();
      const nextResources = new Scope(rootPluginId());
      // Recovery deliberately has no approval authority: it observes the existing attempt.
      nextResources.provide(workroomDeliveryProviderToken, provider);
      restarted = install(nextResources, 2);
      expect(await restarted.runtime.drain()).toEqual([expect.objectContaining({ status: 'committed' })]);
      expect(await restarted.runtime.drain()).toEqual([]);
      expect(await restarted.blockers.read('project', intent.id)).toMatchObject({ status: 'resolved' });
      expect(provider.dispatch).toHaveBeenCalledTimes(1);
      expect(provider.query).toHaveBeenCalledTimes(1);
      expect(provider.inspect).toHaveBeenCalledTimes(2);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(vi.mocked(provider.query).mock.calls[0]?.[0].attemptId)
        .toBe(vi.mocked(provider.dispatch).mock.calls[0]?.[0].attemptId);
    } finally {
      await first.runtime.dispose();
      await restarted?.runtime.dispose();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
