import {
  createWorkroomDataLifecycleConsoleControl,
  type WorkroomDataLifecycleConsoleAuthorityRequest,
  type WorkroomDataLifecycleSubjectExportAuditRecord,
} from '../../src/plugin-runtime/workroom-data-lifecycle-console.js';
import type {
  PayloadLifecycleControlPort,
  PayloadLifecycleState,
} from '../../src/data-governance/payload-lifecycle.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Workroom Data Lifecycle Console control', () => {
  it('returns only content-free state after current root-role and P12 authorization', async () => {
    let disclosureAllowed = true;
    const requests: WorkroomDataLifecycleConsoleAuthorityRequest[] = [];
    const control = createControl({
      authorize: async request => {
        requests.push(request);
        return decision(request, 'data_steward');
      },
      disclose: async () => disclosureAllowed ? disclosure() : null,
    });

    const ready = await control.read(
      { projectId: 'alpha', objectId: 'object-1' },
      { principalId: 'human:steward' },
    );
    expect(ready).toMatchObject({
      status: 'ready',
      projection: {
        projectId: 'alpha', objectId: 'object-1', sequence: 8,
        holds: [{ holdId: 'hold-1', status: 'review_overdue' }],
        erasures: [{ subjectDigest: 'sha256:subject', requestedAt: 7 }],
      },
    });
    const serialized = JSON.stringify(ready);
    expect(serialized).not.toContain('human:owner');
    expect(serialized).not.toContain('decisionId');
    expect(serialized).not.toContain('subjectRef');
    expect(requests[0]).toMatchObject({
      action: 'display', requiredRoles: ['data_steward', 'privacy', 'compliance'],
      authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1',
    });

    disclosureAllowed = false;
    await expect(control.read(
      { projectId: 'alpha', objectId: 'object-1' },
      { principalId: 'human:steward' },
    )).resolves.toEqual({ status: 'forbidden' });
  });

  it('injects the token principal into typed hold/review/release/purge/reconcile commands', async () => {
    const calls: Array<{ method: string; command: Record<string, unknown> }> = [];
    const domain = domainControl(calls);
    const control = createControl({ control: domain });
    const principal = { principalId: 'human:steward' };
    const signal = new AbortController().signal;

    await expect(control.execute({ kind: 'place_hold', operationId: 'op:hold', projectId: 'alpha',
      objectId: 'object-1', holdId: 'hold-2', reasonCode: 'legal_hold', reviewAt: 20 }, principal, signal))
      .resolves.toMatchObject({ status: 'ready' });
    await expect(control.execute({ kind: 'review_hold', operationId: 'op:review', projectId: 'alpha',
      objectId: 'object-1', holdId: 'hold-1', approved: true }, principal, signal))
      .resolves.toMatchObject({ status: 'ready' });
    await expect(control.execute({ kind: 'release_hold', operationId: 'op:release', projectId: 'alpha',
      objectId: 'object-1', holdId: 'hold-1' }, principal, signal))
      .resolves.toMatchObject({ status: 'ready' });
    await expect(control.execute({ kind: 'purge_expired', operationId: 'op:purge', projectId: 'alpha',
      objectId: 'object-1' }, principal, signal)).resolves.toMatchObject({ status: 'ready' });
    await expect(control.execute({ kind: 'reconcile_purge', operationId: 'op:reconcile', projectId: 'alpha',
      objectId: 'object-1', purgeId: 'purge-1' }, principal, signal))
      .resolves.toMatchObject({ status: 'ready' });

    expect(calls).toEqual([
      { method: 'placeHold', command: { version: 1, operationId: 'op:hold',
        authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1',
        holdId: 'hold-2', ownerPrincipalId: 'human:steward', reasonCode: 'legal_hold', reviewAt: 20 } },
      { method: 'reviewHold', command: { version: 1, operationId: 'op:review',
        authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1',
        holdId: 'hold-1', approved: true } },
      { method: 'releaseHold', command: { version: 1, operationId: 'op:release',
        authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1', holdId: 'hold-1' } },
      { method: 'evaluateRetention', command: { version: 1, operationId: 'op:purge',
        authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1' } },
      { method: 'reconcile', command: { version: 1, operationId: 'op:reconcile',
        authenticatedPrincipalId: 'human:steward', projectId: 'alpha', objectId: 'object-1', purgeId: 'purge-1' } },
    ]);
  });

  it('freezes an exact subject export candidate before Root authorization and persists a content-free receipt', async () => {
    const calls: Array<{ method: string; command: Record<string, unknown> }> = [];
    const order: string[] = [];
    const audit: WorkroomDataLifecycleSubjectExportAuditRecord[] = [];
    const control = createControl({
      control: domainControl(calls),
      authorize: async request => {
        order.push('authorize');
        if (request.action === 'export_subject') {
          expect(request.subjectExportCandidate).toMatchObject({
            subjectDigest: 'sha256:subject',
            resolutionDigest: expect.stringMatching(/^sha256:/u),
            observedAt: 10,
            clockRevision: 3,
            deadline: 20,
            objects: [{ objectId: 'object-1', stateDigest: SHA }],
          });
        }
        return decision(request, 'privacy');
      },
      persist: async record => {
        order.push('persist');
        audit.push(record);
        return auditReceipt(record);
      },
    });
    const principal = { principalId: 'human:privacy' };
    const signal = new AbortController().signal;

    const exported = await control.execute({ kind: 'export_subject', operationId: 'op:export',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 }, principal, signal);
    expect(exported).toMatchObject({ status: 'ready', export: {
      tenantId: 'tenant-1', projectId: 'alpha', subjectDigest: 'sha256:subject',
      candidateDigest: expect.stringMatching(/^sha256:/u),
      auditReceiptDigest: expect.stringMatching(/^sha256:/u),
      objects: [{ objectId: 'object-1', stateDigest: SHA }],
    } });
    expect(JSON.stringify(exported)).not.toContain('subject@example.test');
    expect(order).toEqual(['authorize', 'persist']);
    expect(JSON.stringify(audit)).not.toMatch(/subject@example\.test|subjectRef|payload|body/iu);
    expect(audit[0]).toMatchObject({
      projectId: 'alpha', subjectDigest: 'sha256:subject',
      operationDigest: expect.stringMatching(/^sha256:/u),
      principalDigest: expect.stringMatching(/^sha256:/u),
      candidateDigest: expect.stringMatching(/^sha256:/u),
      validatedAt: 10, validationClockRevision: 3,
      validationClockDigest: expect.stringMatching(/^sha256:/u),
    });

    await control.execute({ kind: 'request_subject_erasure', operationId: 'op:erase',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test' }, principal, signal);
    expect(calls.at(-1)).toEqual({ method: 'requestSubjectErasure', command: {
      version: 1, operationId: 'op:erase', authenticatedPrincipalId: 'human:privacy',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test',
    } });
  });

  it('returns stale and writes no export receipt when the exact object set changes after authorization', async () => {
    let current = state();
    const persist = vi.fn(async (record: WorkroomDataLifecycleSubjectExportAuditRecord) => auditReceipt(record));
    const control = createControl({
      read: async () => current,
      authorize: async request => {
        current = { ...current, sequence: 9, digest: `sha256:${'b'.repeat(64)}` };
        return decision(request, 'privacy');
      },
      persist,
    });

    await expect(control.execute({ kind: 'export_subject', operationId: 'op:stale',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 },
    { principalId: 'human:privacy' }, new AbortController().signal)).resolves.toMatchObject({
      status: 'stale', candidateDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns stale when the trusted Kernel clock passes the authorized export deadline', async () => {
    let reads = 0;
    const persist = vi.fn(async (record: WorkroomDataLifecycleSubjectExportAuditRecord) => auditReceipt(record));
    const control = createControl({
      clock: async () => {
        const now = ++reads === 1 ? 10 : 21;
        return { version: 1 as const, now, revision: reads,
          digest: digest({ version: 1, now, revision: reads }) };
      },
      persist,
    });
    await expect(control.execute({ kind: 'export_subject', operationId: 'op:expired',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 },
    { principalId: 'human:privacy' }, new AbortController().signal)).resolves.toMatchObject({ status: 'stale' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('fails closed when the Root export audit provider is unavailable', async () => {
    const control = createControl({ persist: undefined });
    await expect(control.execute({ kind: 'export_subject', operationId: 'op:no-audit',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 },
    { principalId: 'human:privacy' }, new AbortController().signal)).resolves.toEqual({
      status: 'unavailable', reason: 'subject_export_audit',
    });
  });

  it('rejects an export audit receipt whose persisted time drifts from the exact Kernel clock', async () => {
    const control = createControl({ persist: async record => auditReceipt(record, 11) });
    await expect(control.execute({ kind: 'export_subject', operationId: 'op:clock-drift',
      tenantId: 'tenant-1', projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 },
    { principalId: 'human:privacy' }, new AbortController().signal)).rejects.toThrow('authority drift');
  });

  it('lists overdue reviews without exposing governance proofs and rejects wrong roles or extra fields', async () => {
    let role: 'data_steward' | 'privacy' | 'compliance' = 'data_steward';
    const control = createControl({ authorize: async request => decision(request, role) });
    await expect(control.listOverdue({ operationId: 'op:overdue', projectId: 'alpha' },
      { principalId: 'human:steward' })).resolves.toMatchObject({ status: 'ready', items: [{
        objectId: 'object-1', holdId: 'hold-1', reviewAt: 5,
      }] });

    role = 'privacy';
    await expect(control.execute({ kind: 'place_hold', operationId: 'op:denied', projectId: 'alpha',
      objectId: 'object-1', holdId: 'hold-2', reasonCode: 'legal_hold', reviewAt: 20 },
    { principalId: 'human:privacy' }, new AbortController().signal))
      .resolves.toEqual({ status: 'forbidden' });

    await expect(control.execute({ kind: 'release_hold', operationId: 'op:forged', projectId: 'alpha',
      objectId: 'object-1', holdId: 'hold-1', principalId: 'human:mallory' } as never,
    { principalId: 'human:privacy' }, new AbortController().signal)).rejects.toThrow('exact schema');
  });
});

function createControl(options: Readonly<{
  control?: PayloadLifecycleControlPort;
  authorize?: (request: WorkroomDataLifecycleConsoleAuthorityRequest) => Promise<ReturnType<typeof decision> | null>;
  disclose?: () => Promise<ReturnType<typeof disclosure> | null>;
  read?: (projectId: string, objectId: string) => Promise<PayloadLifecycleState>;
  persist?: ((record: WorkroomDataLifecycleSubjectExportAuditRecord) => Promise<ReturnType<typeof auditReceipt> | null>)
    | undefined;
  clock?: () => Promise<Readonly<{ version: 1; now: number; revision: number; digest: string }>>;
}> = {}) {
  return createWorkroomDataLifecycleConsoleControl({
    generation: 7,
    control: options.control ?? domainControl([]),
    read: options.read ?? (async () => state()),
    listObjectIds: async () => ['object-1'],
    clock: { read: options.clock ?? (async () => ({ version: 1, now: 10, revision: 3,
      digest: digest({ version: 1, now: 10, revision: 3 }) })) },
    subjects: { resolve: async () => resolution() },
    authority: {
      authorize: options.authorize ?? (async request => decision(request, requiredRole(request.action))),
      ...(options.persist === undefined ? {} : { persistSubjectExportAudit: options.persist }),
    },
    disclosure: { authorize: options.disclose ?? (async () => disclosure()) },
  });
}

function resolution() {
  const body = { version: 1 as const, tenantId: 'tenant-1', projectId: 'alpha',
    subjectDigest: 'sha256:subject', handles: [state().authority!.handle], authorityDigest: 'sha256:resolver' };
  return { ...body, digest: digest(body) };
}

function auditReceipt(record: WorkroomDataLifecycleSubjectExportAuditRecord, persistedAt = 10) {
  const body = { version: 1 as const, recordDigest: record.digest, persistedAt,
    authorityDigest: 'sha256:audit-authority' };
  return { ...body, digest: digest(body) };
}

function decision(
  request: WorkroomDataLifecycleConsoleAuthorityRequest,
  role: 'data_steward' | 'privacy' | 'compliance',
) {
  return { approved: true as const, requestDigest: request.digest, principalId: request.authenticatedPrincipalId,
    role, authorityDigest: `sha256:${role}` };
}

function requiredRole(action: WorkroomDataLifecycleConsoleAuthorityRequest['action']) {
  if (action === 'review_hold') return 'compliance' as const;
  if (action === 'request_subject_erasure' || action === 'export_subject') return 'privacy' as const;
  return 'data_steward' as const;
}

function disclosure() {
  return { catalogRevision: 'catalog:1', projectDigest: 'sha256:project',
    governanceDigest: 'sha256:governance', bindingDigest: 'sha256:disclosure' };
}

function domainControl(calls: Array<{ method: string; command: Record<string, unknown> }>): PayloadLifecycleControlPort {
  const call = async (method: string, command: unknown) => {
    calls.push({ method, command: command as Record<string, unknown> });
    return state();
  };
  return {
    register: (command) => call('register', command),
    placeHold: (command) => call('placeHold', command),
    reviewHold: (command) => call('reviewHold', command),
    releaseHold: (command) => call('releaseHold', command),
    requestSubjectErasure: async command => [await call('requestSubjectErasure', command)],
    evaluateRetention: (command) => call('evaluateRetention', command),
    reconcile: (command) => call('reconcile', command),
  };
}

function state(): PayloadLifecycleState {
  return {
    projectId: 'alpha', objectId: 'object-1', sequence: 8, digest: SHA,
    authority: {
      version: 1,
      handle: { version: 1, tenantId: 'tenant-1', projectId: 'alpha', objectId: 'object-1',
        vaultObjectId: 'vault-1', payloadHash: 'sha256:payload', descriptorDigest: 'sha256:descriptor',
        locationManifestDigest: 'sha256:locations', keyEnvelopeDigest: 'sha256:key', createdAt: 1 },
      retention: { class: 'operational', minimumRetainUntil: 2, deleteAfter: 9 },
      subjectDigests: ['sha256:subject'],
      locations: { version: 1, tenantId: 'tenant-1', projectId: 'alpha', objectId: 'object-1',
        vaultObjectId: 'vault-1', descriptorDigest: 'sha256:descriptor', revision: 1,
        locations: [{ id: 'primary', kind: 'vault_primary', authorityDigest: 'sha256:location',
          deletionMode: 'crypto_erase' }], digest: 'sha256:locations' },
      digest: 'sha256:authority',
    },
    holds: { 'hold-1': { id: 'hold-1', ownerPrincipalId: 'human:owner', reasonCode: 'legal_hold',
      placedAt: 1, reviewAt: 5, placeRequest: {} as never, placeDecision: {} as never } },
    erasures: [{ subjectDigest: 'sha256:subject', requestedAt: 7, request: {} as never,
      decision: {} as never, resolverAuthorityDigest: 'sha256:resolver' }],
    purges: { 'purge-1': { dispatch: { id: 'purge-1', reason: 'retention_expired',
      objectAuthorityDigest: 'sha256:authority', locationManifestDigest: 'sha256:locations',
      location: { id: 'primary', kind: 'vault_primary', authorityDigest: 'sha256:location',
        deletionMode: 'crypto_erase' }, attempt: 1, fence: 1, requestedAt: 6,
      requestDigest: 'sha256:request', governance: {} as never, digest: 'sha256:purge' } } },
  };
}
