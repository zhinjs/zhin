import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { FileWorkroomEffectJournal } from '../../src/workroom/file-effect-ledger.js';
import { WorkroomEffectLedger, createWorkroomEffectIntent, type WorkroomEffectAuthorizationPort } from '../../src/workroom/effect-ledger.js';
import { WorkroomEffectRuntime } from '../../src/plugin-runtime/workroom-effect-runtime.js';
import {
  WorkroomDeliveryGateway, type WorkroomDeliveryProviderPort, type WorkroomDeliveryObservation,
  type WorkroomDeliveryRequest,
} from '../../src/plugin-runtime/workroom-delivery-gateway.js';

const sha = (value: string) => `sha256:${value.repeat(64)}`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-delivery-'));
  const journal = new FileWorkroomEffectJournal(directory);
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
  const authorization: WorkroomEffectAuthorizationPort = { authorize: vi.fn(async ({ intent: value }) => ({
    version: 1, authorized: true, intentId: value.id, intentDigest: value.digest,
    candidateHash: value.candidateHash, authorizationId: 'sponsor:decision:1', authorizationDigest: sha('1'),
    policy: { id: 'release-policy', revision: 1, digest: sha('2') }, authorizedBy: 'project:sponsor', expiresAt: 200,
  })) };
  const readiness = (input: WorkroomDeliveryRequest) => ({
    target: input.target, candidateHash: input.candidateHash, targetDigest: input.targetDigest,
    evidenceRef: 'ci:run:42', evidenceDigest: sha('e'),
    checks: [{ id: 'test', status: 'passed' as const }, { id: 'review', status: 'passed' as const }],
    observedAt: 90, expiresAt: 1000,
  });
  const observation = (input: WorkroomDeliveryRequest, health: WorkroomDeliveryObservation['health'] = 'passed'): WorkroomDeliveryObservation => ({
    effectId: input.effectId, intentDigest: input.intentDigest, idempotencyKey: input.idempotencyKey,
    target: input.target, candidateHash: input.candidateHash, deploymentRef: 'deploy:42', receiptRef: `deploy:42:${health}`,
    status: 'succeeded', health, observedAt: 100, authenticatedBy: 'ci:trusted',
  });
  const provider: WorkroomDeliveryProviderPort = {
    provider: { id: intent.capability.ref, digest: intent.capability.digest },
    inspect: vi.fn(async input => readiness(input)),
    dispatch: vi.fn(async input => observation(input)),
    query: vi.fn(async input => observation(input)),
  };
  const gateway = new WorkroomDeliveryGateway({ resolveProvider: () => provider, now: () => 100 });
  const ledger = new WorkroomEffectLedger(journal, authorization);
  await ledger.recordIntent('project', intent);
  const runtime = (store = journal) => new WorkroomEffectRuntime({
    journal: store, authorization, gateway, workerId: 'delivery', fence: 1, now: () => 100,
  });
  return { directory, journal, ledger, intent, provider, gateway, runtime, readiness, observation };
}

// Each scenario uses durable Effect facts; only the external CI/CD service is a fixture.
describe('governed delivery gateway', () => {
  it('settles only after deployment AND health verification, recovering through a fresh file journal', async () => {
    const f = await fixture();
    try {
      vi.mocked(f.provider.dispatch).mockImplementationOnce(async input => f.observation(input, 'pending'));
      const first = f.runtime();
      await first.runOnce('project', new AbortController().signal);
      expect((await f.ledger.read('project', f.intent.id)).status).toBe('outcome_unknown');
      await first.dispose();
      const restarted = f.runtime(new FileWorkroomEffectJournal(f.directory));
      await restarted.runOnce('project', new AbortController().signal);
      await restarted.runOnce('project', new AbortController().signal);
      expect((await f.ledger.read('project', f.intent.id)).status).toBe('committed');
      expect(f.provider.dispatch).toHaveBeenCalledTimes(1);
      expect(f.provider.query).toHaveBeenCalledTimes(1);
      expect(f.provider.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        target: f.intent.operation.parameters, authorizationDigest: sha('1'),
        evidenceRef: 'ci:run:42', evidenceDigest: sha('e'), idempotencyKey: 'release:42',
      }), expect.any(AbortSignal));
      await restarted.dispose();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it.each(['head', 'artifact', 'environment', 'candidate', 'evidence', 'failed', 'empty', 'expired'])(
    'rejects %s drift before dispatch', async mismatch => {
      const f = await fixture();
      try {
        vi.mocked(f.provider.inspect).mockImplementation(async input => {
          const evidence = f.readiness(input);
          switch (mismatch) {
            case 'head': return { ...evidence, target: { ...input.target, headSha: 'b'.repeat(40) } };
            case 'artifact': return { ...evidence, target: { ...input.target, artifactDigest: sha('9') } };
            case 'environment': return { ...evidence, target: { ...input.target, environment: 'production' } };
            case 'candidate': return { ...evidence, candidateHash: sha('9') };
            case 'evidence': return { ...evidence, evidenceDigest: sha('9') };
            case 'failed': return { ...evidence, checks: [{ id: 'test', status: 'failed' }] };
            case 'empty': return { ...evidence, checks: [] };
            default: return { ...evidence, expiresAt: 99 };
          }
        });
        await expect(f.gateway.prepare(await f.ledger.read('project', f.intent.id), new AbortController().signal)).rejects.toThrow('CI evidence');
        expect(f.provider.dispatch).not.toHaveBeenCalled();
        expect((await f.journal.read('project')).map(event => event.type)).toEqual(['effect.intent_recorded']);
      } finally { await rm(f.directory, { recursive: true, force: true }); }
    },
  );

  it('queries after a lost dispatch response instead of deploying again', async () => {
    const f = await fixture();
    try {
      vi.mocked(f.provider.dispatch).mockRejectedValueOnce(new Error('connection lost after remote commit'));
      const first = f.runtime();
      await expect(first.runOnce('project', new AbortController().signal)).rejects.toThrow();
      await first.dispose();
      expect((await f.ledger.read('project', f.intent.id)).status).toBe('executing');
      const restarted = f.runtime(new FileWorkroomEffectJournal(f.directory));
      await restarted.runOnce('project', new AbortController().signal);
      expect((await f.ledger.read('project', f.intent.id)).status).toBe('committed');
      expect(f.provider.dispatch).toHaveBeenCalledTimes(1);
      expect(f.provider.query).toHaveBeenCalledTimes(1);
      await restarted.dispose();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it('rejects delayed older health evidence after a newer observation was persisted', async () => {
    const f = await fixture();
    try {
      let state = await f.ledger.startAuthorizedAttempt('project', f.intent.id, {
        operationId: 'attempt', workerId: 'worker', fence: 1, startedAt: 90,
      });
      vi.mocked(f.provider.query).mockImplementationOnce(async input => f.observation(input, 'pending'));
      state = await f.ledger.recordReceipt('project', f.intent.id,
        await f.gateway.reconcile(state, new AbortController().signal));
      vi.mocked(f.provider.query).mockImplementationOnce(async input => ({ ...f.observation(input), observedAt: 99 }));
      await expect(f.gateway.reconcile(state, new AbortController().signal)).rejects.toThrow('binding drift');
      expect((await f.ledger.read('project', f.intent.id)).status).toBe('outcome_unknown');
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it('rechecks evidence and authorization after prepare, without granting another provider authority', async () => {
    const f = await fixture();
    try {
      await f.gateway.prepare(await f.ledger.read('project', f.intent.id), new AbortController().signal);
      const state = await f.ledger.startAuthorizedAttempt('project', f.intent.id, {
        operationId: 'attempt', workerId: 'worker', fence: 1, startedAt: 100,
      });
      const expired = new WorkroomDeliveryGateway({ resolveProvider: () => f.provider, now: () => 201 });
      await expect(expired.execute(state, new AbortController().signal)).rejects.toThrow('Delivery authorization expired');
      const other = new WorkroomDeliveryGateway({ resolveProvider: () => ({
        ...f.provider, provider: { id: 'ci:other', digest: sha('b') },
      }), now: () => 100 });
      await expect(other.execute(state, new AbortController().signal)).rejects.toThrow('capability binding drift');
      expect(f.provider.dispatch).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it('never treats an unhealthy deployment or another target receipt as success', async () => {
    const f = await fixture();
    try {
      const started = await f.ledger.startAuthorizedAttempt('project', f.intent.id, {
        operationId: 'attempt', workerId: 'worker', fence: 1, startedAt: 100,
      });
      vi.mocked(f.provider.query).mockImplementation(async input => ({
        ...f.observation(input), target: { ...input.target, environment: 'production' },
      }));
      await expect(f.gateway.reconcile(started, new AbortController().signal)).rejects.toThrow('binding drift');
      vi.mocked(f.provider.query).mockImplementation(async input => f.observation(input, 'failed'));
      expect((await f.gateway.reconcile(started, new AbortController().signal)).outcome).toBe('failed');
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
});
