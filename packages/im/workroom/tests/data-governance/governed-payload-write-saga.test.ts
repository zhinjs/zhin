import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileGovernedPayloadWriteSagaRepository,
  GovernedPayloadPublicationReconciler,
  GovernedPayloadWritePurgeConsumer,
  createGovernedPayloadWriteIntentId,
} from '../../src/data-governance/governed-payload-write-saga.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Governed Payload write saga', () => {
  it('persists content-free intent before Vault/index/publication and replays after restart', async () => {
    const root = await temporaryRoot();
    const repository = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const input = intent();
    const begun = await repository.begin(input);
    expect(begun.state).toBe('intent');

    await repository.recordVault(begun.intentId, handle());
    await repository.recordAuthorityIndex(begun.intentId, digest({ authority: 1 }));
    const published = await repository.publish(begun.intentId, digest({ header: 1 }));
    const restarted = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));

    expect(await restarted.read(begun.intentId)).toEqual(published);
    const files = await readdir(join(root, 'sagas'));
    const persisted = await Promise.all(files.map(name => readFile(join(root, 'sagas', name), 'utf8')));
    expect(persisted.join('\n')).not.toContain('secret body');
    expect(published.state).toBe('published');
  });

  it('converges CAS losers and restart-unpublished writes to purge_required', async () => {
    const root = await temporaryRoot();
    const first = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const second = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const input = intent();
    const [left, right] = await Promise.all([first.begin(input), second.begin(input)]);
    expect(left.intentId).toBe(right.intentId);
    await first.recordVault(left.intentId, handle());

    const pending = await second.listUnpublished('project-1', 'run:1');
    expect(pending).toHaveLength(1);
    const purged = await second.requirePurge(left.intentId, 'restart_unpublished');
    expect(purged.state).toBe('purge_required');
    expect(purged.purgeReason).toBe('restart_unpublished');
    await expect(second.publish(left.intentId, digest({ header: 1 }))).rejects.toThrow('transition conflict');
  });

  it('rejects a competing intent identity and cannot purge a published header', async () => {
    const root = await temporaryRoot();
    const repository = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const begun = await repository.begin(intent());
    await repository.recordVault(begun.intentId, handle());
    await repository.recordAuthorityIndex(begun.intentId, digest({ authority: 1 }));
    await repository.publish(begun.intentId, digest({ header: 1 }));

    await expect(repository.requirePurge(begun.intentId, 'cas_lost'))
      .rejects.toThrow('cannot enter purge-required');
    expect(createGovernedPayloadWriteIntentId(intent())).toBe(begun.intentId);
  });

  it('keeps purge_required visible without a provider and reconciles unknown without duplicate purge', async () => {
    const root = await temporaryRoot();
    const repository = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const begun = await repository.begin(intent());
    await repository.recordVault(begun.intentId, handle());
    await repository.requirePurge(begun.intentId, 'write_failed');

    expect(await repository.listPurgeRequired('project-1')).toMatchObject([{
      intentId: begun.intentId,
      state: 'purge_required',
    }]);

    const purge = vi.fn(async (request: { digest: string }) => receipt(request.digest, 'outcome_unknown'));
    const reconcile = vi.fn(async (request: { digest: string }) => receipt(request.digest, 'confirmed'));
    const first = new GovernedPayloadWritePurgeConsumer({
      generation: 8,
      repository,
      provider: { purge, reconcile },
    });
    const unknown = await first.processIntent(begun.intentId, AbortSignal.timeout(1_000));
    expect(unknown.purge).toMatchObject({ attempt: 1, fence: 1, status: 'outcome_unknown' });
    expect(purge).toHaveBeenCalledOnce();

    const restarted = new GovernedPayloadWritePurgeConsumer({
      generation: 9,
      repository: new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas')),
      provider: { purge, reconcile },
    });
    const confirmed = await restarted.processIntent(begun.intentId, AbortSignal.timeout(1_000));
    expect(confirmed.purge).toMatchObject({
      generation: 8,
      attempt: 1,
      fence: 1,
      status: 'confirmed',
    });
    await restarted.processIntent(begun.intentId, AbortSignal.timeout(1_000));
    expect(purge).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(await repository.listPurgeRequired('project-1')).toEqual([]);
  });

  it('reconciles a lost purge response after restart instead of issuing a second destructive call', async () => {
    const root = await temporaryRoot();
    const repository = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const begun = await repository.begin(intent());
    await repository.recordVault(begun.intentId, handle());
    await repository.requirePurge(begun.intentId, 'cas_lost');
    const purge = vi.fn(async () => { throw new Error('response lost'); });
    const reconcile = vi.fn(async (request: { digest: string }) => receipt(request.digest, 'confirmed'));
    const first = new GovernedPayloadWritePurgeConsumer({
      generation: 4,
      repository,
      provider: { purge, reconcile },
    });

    const pending = await first.processIntent(begun.intentId, AbortSignal.timeout(1_000));
    expect(pending.purge?.status).toBe('pending');
    const restarted = new GovernedPayloadWritePurgeConsumer({
      generation: 5,
      repository: new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas')),
      provider: { purge, reconcile },
    });
    await restarted.processIntent(begun.intentId, AbortSignal.timeout(1_000));

    expect(purge).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('converges authority-indexed headers on generation handoff without business retry', async () => {
    const root = await temporaryRoot();
    const repository = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const exact = await repository.begin(intent());
    await repository.recordVault(exact.intentId, handle());
    await repository.recordAuthorityIndex(exact.intentId, digest({ authority: 1 }));
    const missing = await repository.begin(intent({
      operationId: 'write:2', objectId: 'object-2', publicationScope: 'run:2',
      payloadHash: digest({ payload: 2 }), descriptorDigest: digest({ descriptor: 2 }),
    }));
    await repository.recordVault(missing.intentId, handle({
      vaultObjectId: 'vault-object:2', objectId: 'object-2',
      payloadHash: digest({ payload: 2 }), descriptorDigest: digest({ descriptor: 2 }),
    }));
    await repository.recordAuthorityIndex(missing.intentId, digest({ authority: 2 }));
    const purge = vi.fn(async (request: { digest: string }) => receipt(request.digest, 'confirmed'));
    const purgeConsumer = new GovernedPayloadWritePurgeConsumer({
      generation: 8,
      repository,
      provider: { purge, reconcile: purge },
    });

    const withoutVerifier = new GovernedPayloadPublicationReconciler({
      repository,
      purge: purgeConsumer,
    });
    await withoutVerifier.drainProject('project-1', AbortSignal.timeout(1_000));
    expect(await repository.listAuthorityIndexed('project-1')).toHaveLength(2);
    expect(purge).not.toHaveBeenCalled();

    const verify = vi.fn(async (candidate: { intentId: string }) => candidate.intentId === exact.intentId
      ? { status: 'exact' as const, publicationDigest: digest({ header: 1 }) }
      : { status: 'missing' as const });
    const restarted = new GovernedPayloadPublicationReconciler({
      repository: new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas')),
      verifier: { verify },
      purge: purgeConsumer,
    });
    await restarted.drainProject('project-1', AbortSignal.timeout(1_000));
    await restarted.drainProject('project-1', AbortSignal.timeout(1_000));

    await expect(repository.read(exact.intentId)).resolves.toMatchObject({ state: 'published' });
    await expect(repository.read(missing.intentId)).resolves.toMatchObject({
      state: 'purge_required', purge: { status: 'confirmed' },
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenCalledOnce();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'governed-payload-saga-'));
  roots.push(root);
  return root;
}

function intent(overrides: Partial<ReturnType<typeof baseIntent>> = {}) {
  return { ...baseIntent(), ...overrides };
}

function baseIntent() {
  return {
    operationId: 'write:1', projectId: 'project-1', objectId: 'object-1',
    payloadHash: digest({ payload: 1 }), descriptorDigest: digest({ descriptor: 1 }),
    sourceBindingDigest: digest({ source: 1 }), consumer: 'journal_header' as const,
    publicationScope: 'run:1',
  };
}

function handle(overrides: Partial<ReturnType<typeof baseHandle>> = {}) {
  return { ...baseHandle(), ...overrides };
}

function baseHandle() {
  return {
    version: 1 as const, vaultObjectId: 'vault-object:1', objectId: 'object-1',
    payloadHash: digest({ payload: 1 }), descriptorDigest: digest({ descriptor: 1 }),
    tenantId: 'tenant-1', projectId: 'project-1',
    locationManifestDigest: digest({ location: 1 }),
  };
}

function receipt(requestDigest: string, status: 'confirmed' | 'outcome_unknown') {
  const body = {
    version: 1 as const,
    requestDigest,
    providerId: 'root-private:purge-provider',
    status,
    observedAt: 100,
  };
  return Object.freeze({ ...body, digest: digest(body) });
}
