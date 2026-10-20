import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PayloadLifecycleRuntime,
  createPayloadLifecycleClockSnapshot,
  createPayloadLifecycleObjectAuthority,
  createPayloadLocationManifest,
  replayPayloadLifecycle,
  type PayloadLifecycleEvent,
  type PayloadLifecycleAuthorityDecision,
  type PayloadLifecycleAuthorityRequest,
  type PayloadLifecycleCommandAuthorityPort,
  type PayloadLifecycleObjectAuthority,
  type PayloadLocationDeletionPort,
  type PayloadPurgeDispatch,
  type PayloadPurgeReceipt,
} from '../../src/data-governance/payload-lifecycle.js';
import {
  FilePayloadLifecycleRepository,
  PayloadLifecycleSequenceConflictError,
} from '../../src/data-governance/file-payload-lifecycle-repository.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const abort = new AbortController().signal;

describe('PayloadLifecycleRuntime', () => {
  it('keeps crypto_erased separate from purge_complete until every exact location confirms', async () => {
    const fixture = await createFixture();
    try {
      await fixture.register();
      const scheduled = await fixture.runtime.control.evaluateRetention(command('evaluate', 'steward'), abort);
      expect(Object.values(scheduled.purges).map(value => ({
        location: value.dispatch.location.id,
        attempt: value.dispatch.attempt,
        fence: value.dispatch.fence,
      })).sort((left, right) => left.location.localeCompare(right.location))).toEqual([
        { location: 'backup:1', attempt: 1, fence: 1 },
        { location: 'vault:primary', attempt: 1, fence: 1 },
      ]);

      fixture.statuses.set('backup:1', 'outcome_unknown');
      let state = await fixture.runtime.worker.dispatch('project-1', 'object-1', abort);
      expect(state.cryptoErased).toMatchObject({ locationId: 'vault:primary' });
      expect(state.purgeComplete).toBeUndefined();

      const backupId = Object.values(state.purges)
        .find(value => value.dispatch.location.id === 'backup:1')!.dispatch.id;
      state = await fixture.runtime.control.reconcile({
        ...command('reconcile', 'steward'), purgeId: backupId,
      }, abort);
      expect(state.purges[backupId]?.dispatch).toMatchObject({ attempt: 2, fence: 2 });
      fixture.statuses.set('backup:1', 'confirmed');
      state = await fixture.runtime.worker.dispatch('project-1', 'object-1', abort);
      expect(state.purgeComplete?.receiptDigests).toHaveLength(2);
    } finally {
      await fixture.dispose();
    }
  });

  it('requires separate Hold owner/reviewer authority and permits recovery after a rejected review', async () => {
    const fixture = await createFixture({
      roles: new Map([
        ['owner', new Set(['data_steward', 'compliance'])],
        ['reviewer', new Set(['compliance'])],
      ]),
    });
    try {
      await fixture.register('owner');
      await fixture.runtime.control.placeHold({
        ...command('place', 'owner'), holdId: 'hold-1', ownerPrincipalId: 'owner', reasonCode: 'legal_hold',
        reviewAt: 2_000,
      }, abort);
      await expect(fixture.runtime.control.reviewHold({
        ...command('self-review', 'owner'), holdId: 'hold-1', approved: true,
      }, abort)).rejects.toThrow('cannot self-review');

      await fixture.runtime.control.reviewHold({
        ...command('reject-review', 'reviewer'), holdId: 'hold-1', approved: false,
      }, abort);
      await fixture.runtime.control.reviewHold({
        ...command('approve-review', 'reviewer'), holdId: 'hold-1', approved: true,
      }, abort);
      await expect(fixture.runtime.control.releaseHold({
        ...command('wrong-release', 'reviewer'), holdId: 'hold-1',
      }, abort)).rejects.toThrow('Only the Hold owner');
      const released = await fixture.runtime.control.releaseHold({
        ...command('release', 'owner'), holdId: 'hold-1',
      }, abort);
      expect(released.holds['hold-1']?.release?.releasedBy).toBe('owner');
    } finally {
      await fixture.dispose();
    }
  });

  it('requires an exact policy override when subject erasure conflicts with minimum retention', async () => {
    const fixture = await createFixture({ now: 50, minimumRetainUntil: 100 });
    try {
      await fixture.register();
      await expect(fixture.runtime.control.requestSubjectErasure({
        version: 1, operationId: 'erase-denied', authenticatedPrincipalId: 'privacy',
        tenantId: 'tenant-1', projectId: 'project-1', subjectRef: 'raw-subject-secret',
      }, abort)).rejects.toThrow('exact legal policy authority');

      fixture.allowMinimumRetentionOverride = true;
      const [state] = await fixture.runtime.control.requestSubjectErasure({
        version: 1, operationId: 'erase-approved', authenticatedPrincipalId: 'privacy',
        tenantId: 'tenant-1', projectId: 'project-1', subjectRef: 'raw-subject-secret',
      }, abort);
      expect(state!.erasures).toHaveLength(1);
      expect(Object.values(state!.purges)).toHaveLength(2);
      const persisted = await Promise.all((await readdir(fixture.directory))
        .filter(name => name.endsWith('.json'))
        .map(name => readFile(join(fixture.directory, name), 'utf8')));
      expect(persisted.join('\n')).not.toContain('raw-subject-secret');
    } finally {
      await fixture.dispose();
    }
  });

  it('fails closed on forged persisted governance proof or forged location receipt', async () => {
    const fixture = await createFixture();
    try {
      await fixture.register();
      await fixture.runtime.control.evaluateRetention(command('evaluate', 'steward'), abort);
      fixture.forgeReceipt = true;
      await expect(fixture.runtime.worker.dispatch('project-1', 'object-1', abort))
        .rejects.toThrow('malformed or stale');

      fixture.forgeReceipt = false;
      fixture.trustPersistedAuthority = false;
      await expect(fixture.runtime.read('project-1', 'object-1'))
        .rejects.toThrow('persisted governance proof is untrusted');
    } finally {
      await fixture.dispose();
    }
  });

  it('rejects a signed proof moved onto a forged candidate or forged role', async () => {
    const fixture = await createFixture();
    try {
      await fixture.register();
      await fixture.runtime.control.placeHold({
        ...command('place', 'steward'), holdId: 'hold-1', ownerPrincipalId: 'steward',
        reasonCode: 'investigation', reviewAt: 2_000,
      }, abort);
      const events = [...await fixture.journal.read('project-1', 'object-1')];
      const original = events[1]!;
      if (original.type !== 'hold.placed') throw new Error('expected Hold placement');

      const movedPayload = { ...structuredClone(original.payload), reasonCode: 'legal_hold' as const };
      const moved = eventWithDigest({ ...original, payload: movedPayload });
      expect(() => replayPayloadLifecycle('project-1', 'object-1', [events[0]!, moved]))
        .toThrow('candidate binding is stale');

      const forgedRequestBody = {
        ...structuredClone(original.payload.placeRequest),
        requiredRole: 'compliance' as const,
      };
      const forgedRequest = requestWithDigest(forgedRequestBody);
      const forgedPayload = {
        ...structuredClone(original.payload),
        placeRequest: forgedRequest,
        placeDecision: {
          ...structuredClone(original.payload.placeDecision),
          requestDigest: forgedRequest.digest,
          role: 'compliance' as const,
        },
      };
      const forgedRole = eventWithDigest({ ...original, payload: forgedPayload });
      expect(() => replayPayloadLifecycle('project-1', 'object-1', [events[0]!, forgedRole]))
        .toThrow('governance proof binding is invalid');
    } finally {
      await fixture.dispose();
    }
  });
});

describe('FilePayloadLifecycleRepository', () => {
  it('is restart-durable, create-only CAS, and fails closed on corruption', async () => {
    const fixture = await createFixture();
    try {
      await fixture.register();
      const restarted = new FilePayloadLifecycleRepository(fixture.directory);
      expect(await restarted.listObjectIds('project-1')).toEqual(['object-1']);
      expect(await restarted.read('project-1', 'object-1')).toHaveLength(1);

      const settled = await Promise.allSettled([
        fixture.runtime.control.placeHold({
          ...command('place-a', 'steward'), holdId: 'hold-a', ownerPrincipalId: 'steward',
          reasonCode: 'investigation', reviewAt: 2_000,
        }, abort),
        fixture.runtime.control.placeHold({
          ...command('place-b', 'steward'), holdId: 'hold-b', ownerPrincipalId: 'steward',
          reasonCode: 'investigation', reviewAt: 2_000,
        }, abort),
      ]);
      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(settled.some(result => result.status === 'rejected'
        && result.reason instanceof PayloadLifecycleSequenceConflictError)).toBe(true);

      const [name] = (await readdir(fixture.directory)).filter(value => value.endsWith('.json'));
      await writeFile(join(fixture.directory, name!), '{}', 'utf8');
      await expect(restarted.read('project-1', 'object-1')).rejects.toThrow('digest');
    } finally {
      await fixture.dispose();
    }
  });
});

async function createFixture(options: {
  now?: number;
  minimumRetainUntil?: number;
  roles?: Map<string, Set<string>>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-payload-lifecycle-'));
  const directory = join(root, 'journal');
  const journal = new FilePayloadLifecycleRepository(directory);
  const roles = options.roles ?? new Map([
    ['steward', new Set(['data_steward'])],
    ['privacy', new Set(['privacy'])],
    ['reviewer', new Set(['compliance'])],
  ]);
  let now = options.now ?? 1_000;
  let allowMinimumRetentionOverride = false;
  let trustPersistedAuthority = true;
  let forgeReceipt = false;
  const statuses = new Map<string, PayloadPurgeReceipt['status']>();
  const object = objectAuthority(options.minimumRetainUntil ?? 0);
  const authority: PayloadLifecycleCommandAuthorityPort = {
    authorize: async request => {
      if (!roles.get(request.authenticatedPrincipalId)?.has(request.requiredRole)) {
        return { approved: false, requestDigest: request.digest, reason: 'role_denied' };
      }
      return authorityDecision(request, allowMinimumRetentionOverride);
    },
    verify: async (request, decision) => trustPersistedAuthority
      && decision.requestDigest === request.digest
      && decision.authorityDigest === authorityDigest(request),
  };
  const deletion: PayloadLocationDeletionPort = {
    purge: async dispatch => receiptFor(
      dispatch,
      statuses.get(dispatch.location.id) ?? 'confirmed',
      forgeReceipt,
    ),
  };
  const runtime = new PayloadLifecycleRuntime({
    journal,
    clock: {
      read: async () => createPayloadLifecycleClockSnapshot({ version: 1, now, revision: 1 }),
    },
    authority,
    objects: { resolve: async handle => handle.vaultObjectId === object.handle.vaultObjectId ? object : undefined },
    subjects: {
      resolve: async ({ tenantId, projectId }) => {
        const body = {
          version: 1 as const, tenantId, projectId, subjectDigest: object.subjectDigests[0]!,
          handles: [object.handle], authorityDigest: hex('subject-authority'),
        };
        return { ...body, digest: digest(body) };
      },
    },
    deletion,
    receipts: { verify: async (receipt, dispatch) => !forgeReceipt
      && receipt.authorityDigest === receiptAuthorityDigest(dispatch) },
  });
  return {
    root, directory, journal, runtime, object, roles, statuses,
    register: (principal = 'steward') => runtime.control.register({
      version: 1, operationId: 'register', authenticatedPrincipalId: principal, handle: object.handle,
    }, abort),
    dispose: () => rm(root, { recursive: true, force: true }),
    set now(value: number) { now = value; },
    set allowMinimumRetentionOverride(value: boolean) { allowMinimumRetentionOverride = value; },
    set trustPersistedAuthority(value: boolean) { trustPersistedAuthority = value; },
    set forgeReceipt(value: boolean) { forgeReceipt = value; },
  };
}

function objectAuthority(minimumRetainUntil: number): PayloadLifecycleObjectAuthority {
  const locationInput = {
    version: 1 as const,
    tenantId: 'tenant-1', projectId: 'project-1', objectId: 'object-1', vaultObjectId: 'vault-object:1',
    descriptorDigest: hex('descriptor'), revision: 1,
    locations: [
      { id: 'vault:primary', kind: 'vault_primary' as const, authorityDigest: hex('vault'), deletionMode: 'crypto_erase' as const },
      { id: 'backup:1', kind: 'backup' as const, authorityDigest: hex('backup'), deletionMode: 'delete' as const },
    ],
  };
  const locations = createPayloadLocationManifest(locationInput);
  return createPayloadLifecycleObjectAuthority({
    version: 1,
    handle: {
      version: 1, vaultObjectId: 'vault-object:1', objectId: 'object-1', payloadHash: hex('payload'),
      descriptorDigest: locationInput.descriptorDigest, locationManifestDigest: locations.digest,
      tenantId: 'tenant-1', projectId: 'project-1', bytes: 42,
    },
    retention: { class: 'operational', minimumRetainUntil, deleteAfter: 500 },
    subjectDigests: [hex('subject')],
    locations,
  });
}

function authorityDecision(
  request: PayloadLifecycleAuthorityRequest,
  allowMinimumRetentionOverride: boolean,
): PayloadLifecycleAuthorityDecision {
  return {
    approved: true, requestDigest: request.digest, decisionId: `decision:${request.operationId}`,
    principalId: request.authenticatedPrincipalId, role: request.requiredRole,
    authorityDigest: authorityDigest(request), decidedAt: request.clock.now,
    ...(allowMinimumRetentionOverride && request.action === 'request_subject_erasure'
      ? { minimumRetentionOverride: {
        policyRef: 'policy:legal-erasure-override', policyDigest: hex('override'),
        objectAuthorityDigest: request.objectAuthorityDigest,
      } }
      : {}),
  };
}

function authorityDigest(request: PayloadLifecycleAuthorityRequest): string {
  return digest({ kind: 'test-lifecycle-authority', requestDigest: request.digest });
}

function receiptFor(
  dispatch: PayloadPurgeDispatch,
  status: PayloadPurgeReceipt['status'],
  forged: boolean,
): PayloadPurgeReceipt {
  const body = {
    version: 1 as const,
    purgeId: dispatch.id, projectId: 'project-1', objectId: 'object-1',
    locationId: forged ? 'location:forged' : dispatch.location.id,
    locationAuthorityDigest: dispatch.location.authorityDigest,
    locationManifestDigest: dispatch.locationManifestDigest,
    attempt: dispatch.attempt, fence: dispatch.fence, requestDigest: dispatch.requestDigest,
    status,
    ...(status === 'confirmed' ? {} : { reasonCode: 'transient_failure' as const }),
    ...(status === 'confirmed' && dispatch.location.deletionMode === 'crypto_erase'
      ? { cryptoEraseReceiptDigest: hex('crypto-erased') }
      : {}),
    authenticatedBy: 'deletion-provider:1', observedAt: dispatch.requestedAt + 1,
    authorityDigest: receiptAuthorityDigest(dispatch),
  };
  return { ...body, digest: digest(body) };
}

function receiptAuthorityDigest(dispatch: PayloadPurgeDispatch): string {
  return digest({ kind: 'test-receipt-authority', purgeDigest: dispatch.digest });
}

function command(operationId: string, authenticatedPrincipalId: string) {
  return { version: 1 as const, operationId, authenticatedPrincipalId, projectId: 'project-1', objectId: 'object-1' };
}

function hex(seed: string): string {
  return digest({ seed });
}

function eventWithDigest(event: Omit<PayloadLifecycleEvent, 'digest'> & { digest?: string }): PayloadLifecycleEvent {
  const { digest: _old, ...body } = event;
  return { ...body, digest: digest(body) } as PayloadLifecycleEvent;
}

function requestWithDigest(
  request: Omit<PayloadLifecycleAuthorityRequest, 'digest'> & { digest?: string },
): PayloadLifecycleAuthorityRequest {
  const { digest: _old, ...body } = request;
  return { ...body, digest: digest(body) };
}
