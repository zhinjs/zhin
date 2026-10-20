import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivatablePayloadLifecycleRepository,
  DatabasePayloadLifecycleRepository,
  PAYLOAD_LIFECYCLE_EVENT_MODEL,
  definePayloadLifecycleDatabaseModel,
  type PayloadLifecycleDatabase,
  type PayloadLifecycleDatabaseModel,
} from '../../src/data-governance/database-payload-lifecycle-repository.js';
import { FilePayloadLifecycleRepository } from '../../src/data-governance/file-payload-lifecycle-repository.js';
import {
  createPayloadLifecycleClockSnapshot,
  createPayloadLifecycleObjectAuthority,
  createPayloadLocationManifest,
  replayPayloadLifecycle,
  type PayloadLifecycleAuthorityRequest,
  type PayloadLifecycleEventDraft,
} from '../../src/data-governance/payload-lifecycle.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Database Payload Lifecycle repository', () => {
  it('persists and replays an exact content-free event with SERIALIZABLE CAS', async () => {
    const fixture = databaseFixture();
    const first = new DatabasePayloadLifecycleRepository(fixture.database, fixture.model);
    const draft = registeredDraft();

    const [event] = await first.append('project-1', 'object-1', -1, [draft]);
    const restarted = new DatabasePayloadLifecycleRepository(fixture.database, fixture.model);

    expect(fixture.isolationLevels).toEqual(['SERIALIZABLE']);
    expect(await restarted.read('project-1', 'object-1')).toEqual([event]);
    expect(await restarted.listObjectIds('project-1')).toEqual(['object-1']);
    expect(replayPayloadLifecycle('project-1', 'object-1', [event!])).toMatchObject({
      sequence: 0,
      authority: { handle: { vaultObjectId: 'vault-object:1' } },
    });
    expect(JSON.stringify(fixture.rows)).not.toContain('plaintext');
  });

  it('copies and verifies a File lifecycle prefix before activating the Database writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'payload-lifecycle-handoff-'));
    temporaryRoots.push(root);
    const source = new FilePayloadLifecycleRepository(join(root, 'file'));
    await source.append('project-1', 'object-1', -1, [registeredDraft()]);
    const fixture = databaseFixture();
    const target = new DatabasePayloadLifecycleRepository(fixture.database, fixture.model);
    const activatable = new ActivatablePayloadLifecycleRepository();

    expect(() => activatable.read('project-1', 'object-1')).toThrow('not active');
    await activatable.activate(target, ['project-1'], source);

    expect(await activatable.read('project-1', 'object-1'))
      .toEqual(await source.read('project-1', 'object-1'));
    expect(await activatable.listObjectIds('project-1')).toEqual(['object-1']);
  });

  it('fails closed on exact database row drift and a competing CAS winner', async () => {
    const fixture = databaseFixture();
    const repository = new DatabasePayloadLifecycleRepository(fixture.database, fixture.model);
    await repository.append('project-1', 'object-1', -1, [registeredDraft()]);
    fixture.rows[0]!.event_digest = sha('f');
    await expect(repository.read('project-1', 'object-1')).rejects.toThrow('drift');

    const idFixture = databaseFixture();
    const idRepository = new DatabasePayloadLifecycleRepository(idFixture.database, idFixture.model);
    await idRepository.append('project-1', 'object-1', -1, [registeredDraft()]);
    idFixture.rows[0]!.id = 'forged-row-id';
    await expect(idRepository.read('project-1', 'object-1')).rejects.toThrow(
      'row scope/sequence drift',
    );

    const loserFixture = databaseFixture();
    const loser = new DatabasePayloadLifecycleRepository(loserFixture.database, loserFixture.model);
    loserFixture.winNextInsertWith('project-1', 'object-1', registeredDraft());
    await expect(loser.append('project-1', 'object-1', -1, [{
      ...registeredDraft(),
      payload: {
        ...registeredDraft().payload,
        governance: {
          ...registeredDraft().payload.governance,
          decision: {
            ...registeredDraft().payload.governance.decision,
            decisionId: 'decision:loser',
          },
        },
      },
    }])).rejects.toThrow('sequence conflict');
  });

  it('registers its database schema through the shared model definer', () => {
    const define = vi.fn();
    definePayloadLifecycleDatabaseModel({ define });
    expect(define).toHaveBeenCalledWith('payload_lifecycle_events', PAYLOAD_LIFECYCLE_EVENT_MODEL);
  });
});

function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  let winner: Readonly<{ projectId: string; objectId: string; draft: PayloadLifecycleEventDraft }> | undefined;
  const select = (query: Record<string, unknown>) => rows.filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model: PayloadLifecycleDatabaseModel = {
    select: () => ({ where: async query => select(query) }),
  };
  const database: PayloadLifecycleDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      return await operation({
        select: () => ({ where: async query => select(query) }),
        insertMany: async (_table, inserted) => {
          if (winner) {
            const concurrent = winner;
            winner = undefined;
            const isolated = databaseFixture();
            const repository = new DatabasePayloadLifecycleRepository(isolated.database, isolated.model);
            await repository.append(concurrent.projectId, concurrent.objectId, -1, [concurrent.draft]);
            rows.push(...isolated.rows);
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          if (inserted.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          rows.push(...inserted);
        },
      });
    },
  };
  return {
    database,
    model,
    rows,
    isolationLevels,
    winNextInsertWith: (projectId: string, objectId: string, draft: PayloadLifecycleEventDraft) => {
      winner = { projectId, objectId, draft };
    },
  };
}

function registeredDraft(): Extract<PayloadLifecycleEventDraft, { type: 'object.registered' }> {
  const locations = createPayloadLocationManifest({
    version: 1,
    tenantId: 'tenant-1',
    projectId: 'project-1',
    objectId: 'object-1',
    vaultObjectId: 'vault-object:1',
    descriptorDigest: sha('d'),
    revision: 1,
    locations: [{
      id: 'vault:primary', kind: 'vault_primary', authorityDigest: sha('a'),
      deletionMode: 'crypto_erase',
    }],
  });
  const authority = createPayloadLifecycleObjectAuthority({
    version: 1,
    handle: {
      version: 1, vaultObjectId: 'vault-object:1', objectId: 'object-1',
      payloadHash: sha('p'), descriptorDigest: sha('d'),
      tenantId: 'tenant-1', projectId: 'project-1',
      locationManifestDigest: locations.digest,
    },
    retention: { class: 'operational', minimumRetainUntil: 0, deleteAfter: 100 },
    subjectDigests: [sha('s')],
    locations,
  });
  const clock = createPayloadLifecycleClockSnapshot({ version: 1, now: 1, revision: 1 });
  const state = replayPayloadLifecycle('project-1', 'object-1', []);
  const requestBody = {
    version: 1 as const,
    action: 'register_object' as const,
    requiredRole: 'data_steward' as const,
    operationId: 'register:1', authenticatedPrincipalId: 'steward:1',
    tenantId: 'tenant-1', projectId: 'project-1', objectId: 'object-1',
    objectAuthorityDigest: authority.digest, currentStateDigest: state.digest,
    candidateDigest: authority.digest, clock,
  };
  const request: PayloadLifecycleAuthorityRequest = { ...requestBody, digest: digest(requestBody) };
  return {
    type: 'object.registered',
    payload: {
      authority,
      governance: {
        request,
        decision: {
          approved: true, requestDigest: request.digest, decisionId: 'decision:register',
          principalId: 'steward:1', role: 'data_steward',
          authorityDigest: sha('g'), decidedAt: clock.now,
        },
      },
    },
  };
}

function sha(seed: string): string {
  return digest({ seed });
}
