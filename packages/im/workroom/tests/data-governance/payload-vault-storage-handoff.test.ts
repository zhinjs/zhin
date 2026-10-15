import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptedDatabasePayloadVault } from '../../src/data-governance/encrypted-database-payload-vault.js';
import {
  EncryptedFilePayloadVault,
  type PayloadVaultCryptographyPort,
} from '../../src/data-governance/encrypted-file-payload-vault.js';
import {
  DatabasePayloadVaultHandoffRepository,
  DatabasePayloadVaultRetirementRepository,
  PayloadVaultFileToDatabaseHandoff,
  PayloadVaultSourceRetirementGate,
  type PayloadVaultHandoffAuthorityPort,
} from '../../src/data-governance/payload-vault-storage-handoff.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('Payload Vault File to Database handoff', () => {
  it('mints and persists a new exact handle while the old handle remains governed', async () => {
    const root = await mkdtemp(join(tmpdir(), `payload-vault-handoff-${randomUUID()}-`));
    roots.push(root);
    const fixture = databaseFixture();
    const cryptography = testCryptography(new Uint8Array(32).fill(8), 'kms:key-8');
    const source = new EncryptedFilePayloadVault({ directory: root, generation: 3, cryptography });
    const body = new TextEncoder().encode('regulated customer support record');
    const descriptor = descriptorFor(body);
    const sourceHandle = await source.putSource({
      descriptor, descriptorDigest: digest(descriptor), payload: body,
      sourceBindingDigest: sha('binding'),
    }, signal());
    const target = new EncryptedDatabasePayloadVault({
      database: fixture.database, objectModel: fixture.objectModel, auditModel: fixture.auditModel,
      generation: 3, cryptography, repositoryIdentity: 'database:primary',
    });
    const repository = new DatabasePayloadVaultHandoffRepository(
      fixture.database, fixture.handoffModel,
    );
    const service = new PayloadVaultFileToDatabaseHandoff({
      source, target, repository, authority: authority(), generation: 3,
    });

    const receipt = await service.migrate({
      operationId: 'handoff:operation-1', authenticatedPrincipalId: 'steward:1',
      sourceHandle, sourceDescriptor: descriptor, targetObjectId: 'db-copy:source:1',
    }, signal());
    expect(receipt).toMatchObject({
      status: 'copied_pending_consumer_cutover', sourceHandle,
      targetHandle: { objectId: 'db-copy:source:1' },
      supersedes: { vaultObjectId: sourceHandle.vaultObjectId },
    });
    expect(receipt.targetHandle.vaultObjectId).not.toBe(sourceHandle.vaultObjectId);
    await expect(target.readExact({
      handle: receipt.targetHandle, requestDigest: sha('target-read'), purpose: 'reconciliation',
      principalId: 'steward:1', destinationId: 'vault-handoff',
    }, signal())).resolves.toEqual(body);
    await expect(source.readExact({
      handle: sourceHandle, requestDigest: sha('source-read'), purpose: 'reconciliation',
      principalId: 'steward:1', destinationId: 'vault-handoff',
    }, signal())).resolves.toEqual(body);

    const restarted = new DatabasePayloadVaultHandoffRepository(
      fixture.database, fixture.handoffModel,
    );
    expect(await restarted.read(receipt.handoffId)).toEqual(receipt);
    const persisted = JSON.stringify(fixture.handoffs);
    expect(persisted).not.toContain('regulated customer support record');
    expect(persisted).not.toContain('subject:customer-1');
  });

  it('fails closed before body materialization when trusted authority denies', async () => {
    const fixture = databaseFixture();
    const source = { readExact: vi.fn() };
    const target = { putDerived: vi.fn() };
    const service = new PayloadVaultFileToDatabaseHandoff({
      source, target,
      repository: new DatabasePayloadVaultHandoffRepository(fixture.database, fixture.handoffModel),
      authority: { authorize: async request => ({ approved: false, requestDigest: request.digest, reason: 'denied' }), verify: async () => false },
      generation: 1,
    });
    const descriptor = descriptorFor(new TextEncoder().encode('never read'));
    const locations = sha('manifest');
    await expect(service.migrate({
      operationId: 'handoff:denied', authenticatedPrincipalId: 'agent:forged',
      sourceDescriptor: descriptor, targetObjectId: 'db-copy:denied',
      sourceHandle: {
        version: 1, vaultObjectId: `vault-object:${'a'.repeat(64)}`, objectId: descriptor.objectId,
        payloadHash: descriptor.payloadHash, descriptorDigest: digest(descriptor), tenantId: 'tenant-1',
        projectId: 'project-1', locationManifestDigest: locations,
      },
    }, signal())).rejects.toThrow('not authorized');
    expect(source.readExact).not.toHaveBeenCalled();
    expect(target.putDerived).not.toHaveBeenCalled();
  });

  it('cannot retire the source before exact consumer cutover and confirmed full purge', async () => {
    const fixture = databaseFixture();
    const handoff = handoffReceipt();
    await new DatabasePayloadVaultHandoffRepository(fixture.database, fixture.handoffModel)
      .create(handoff);
    let complete = false;
    let purged = false;
    const gate = new PayloadVaultSourceRetirementGate({
      handoffs: new DatabasePayloadVaultHandoffRepository(fixture.database, fixture.handoffModel),
      retirements: new DatabasePayloadVaultRetirementRepository(fixture.database, fixture.retirementModel),
      consumers: { resolve: async () => consumerSnapshot(handoff, complete) },
      lifecycle: { resolve: async () => purgeState(handoff, purged) },
      authority: retirementAuthority(),
    });
    await expect(gate.authorize({
      handoffId: handoff.handoffId, operationId: 'retire:1', authenticatedPrincipalId: 'steward:2',
    }, signal())).rejects.toThrow('consumer cutover');
    complete = true;
    await expect(gate.authorize({
      handoffId: handoff.handoffId, operationId: 'retire:1', authenticatedPrincipalId: 'steward:2',
    }, signal())).rejects.toThrow('purge completion');
    purged = true;
    const proof = await gate.authorize({
      handoffId: handoff.handoffId, operationId: 'retire:1', authenticatedPrincipalId: 'steward:2',
    }, signal());
    expect(proof).toMatchObject({ handoffId: handoff.handoffId, sourceHandle: handoff.sourceHandle });
    expect(await new DatabasePayloadVaultRetirementRepository(
      fixture.database, fixture.retirementModel,
    ).read(handoff.handoffId)).toEqual(proof);
  });
});

function databaseFixture() {
  const objects: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const handoffs: Record<string, unknown>[] = [];
  const retirements: Record<string, unknown>[] = [];
  const table = (name: string) => name === 'payload_vault_objects' ? objects
    : name === 'payload_vault_audit' ? audits
      : name === 'payload_vault_handoff_retirements' ? retirements : handoffs;
  const select = (name: string, query: Record<string, unknown>) => table(name).filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model = (name: string) => ({ select: () => ({ where: async (query: Record<string, unknown>) => select(name, query) }) });
  return {
    objects, audits, handoffs, retirements,
    objectModel: model('payload_vault_objects'), auditModel: model('payload_vault_audit'),
    handoffModel: model('payload_vault_handoffs'),
    retirementModel: model('payload_vault_handoff_retirements'),
    database: {
      transaction: async <T>(operation: (tx: {
        select(name: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
        insertMany(name: string, rows: Record<string, unknown>[]): Promise<unknown>;
      }) => Promise<T>) => operation({
        select: name => ({ where: async query => select(name, query) }),
        insertMany: async (name, candidates) => {
          const rows = table(name);
          if (candidates.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint'), { code: '23505' });
          }
          rows.push(...structuredClone(candidates));
        },
      }),
    },
  };
}

function handoffReceipt() {
  const sourceHandle = {
    version: 1 as const, vaultObjectId: `vault-object:${'1'.repeat(64)}`, objectId: 'source:1',
    payloadHash: sha('payload'), descriptorDigest: sha('source-descriptor'), tenantId: 'tenant-1',
    projectId: 'project-1', locationManifestDigest: sha('source-manifest'),
  };
  const targetHandle = {
    ...sourceHandle, vaultObjectId: `vault-object:${'2'.repeat(64)}`, objectId: 'target:1',
    descriptorDigest: sha('target-descriptor'), locationManifestDigest: sha('target-manifest'),
  };
  const requestBody = {
    version: 1 as const, action: 'copy_file_payload_to_database' as const, generation: 1,
    operationId: 'handoff:test', authenticatedPrincipalId: 'steward:1', tenantId: 'tenant-1',
    projectId: 'project-1', sourceHandleDigest: digest(sourceHandle),
    sourceDescriptorDigest: sourceHandle.descriptorDigest,
    targetDescriptorDigest: targetHandle.descriptorDigest,
  };
  const authorityRequest = { ...requestBody, digest: digest(requestBody) };
  const handoffId = `payload-vault-handoff:${authorityRequest.digest.slice('sha256:'.length)}`;
  const body = {
    version: 1 as const, handoffId, revision: 1 as const,
    status: 'copied_pending_consumer_cutover' as const, sourceHandle, targetHandle,
    sourceDescriptorDigest: sourceHandle.descriptorDigest,
    targetDescriptorDigest: targetHandle.descriptorDigest,
    supersedes: { vaultObjectId: sourceHandle.vaultObjectId, descriptorDigest: sourceHandle.descriptorDigest },
    lineage: { sourceObjectId: sourceHandle.objectId, targetObjectId: targetHandle.objectId,
      transformRef: 'storage-handoff:file-to-database:v1' as const },
    authorityRequest,
    authorityDecision: { approved: true as const, requestDigest: authorityRequest.digest,
      decisionId: 'decision:handoff', principalId: 'steward:1', role: 'data_steward' as const,
      authorityDigest: sha('authority'), decidedAt: 1 },
  };
  return { ...body, digest: digest(body) };
}

function consumerSnapshot(handoff: ReturnType<typeof handoffReceipt>, complete: boolean) {
  const body = { version: 1 as const, handoffId: handoff.handoffId,
    targetVaultObjectId: handoff.targetHandle.vaultObjectId, revision: 2,
    expectedConsumerDigests: [sha('consumer:a'), sha('consumer:b')],
    switchedConsumerDigests: complete ? [sha('consumer:a'), sha('consumer:b')] : [sha('consumer:a')] };
  return { ...body, digest: digest(body) };
}

function purgeState(handoff: ReturnType<typeof handoffReceipt>, complete: boolean) {
  return { version: 1 as const, projectId: handoff.sourceHandle.projectId,
    objectId: handoff.sourceHandle.objectId, sourceHandle: handoff.sourceHandle,
    stateDigest: sha('lifecycle-state'), objectAuthorityDigest: sha('object-authority'),
    locationManifestDigest: handoff.sourceHandle.locationManifestDigest,
    ...(complete ? { purgeCompletionDigest: sha('purge-complete') } : {}) };
}

function retirementAuthority() {
  return {
    authorize: async (request: { digest: string; authenticatedPrincipalId: string }) => ({ approved: true as const,
      requestDigest: request.digest, decisionId: 'decision:retire', principalId: request.authenticatedPrincipalId,
      role: 'data_steward' as const, authorityDigest: sha('retirement-authority'), decidedAt: 100 }),
    verify: async (request: { digest: string }, decision: { requestDigest: string }) =>
      decision.requestDigest === request.digest,
  };
}

function authority(): PayloadVaultHandoffAuthorityPort {
  return {
    authorize: async request => ({
      approved: true, requestDigest: request.digest, decisionId: 'decision:handoff-1',
      principalId: request.authenticatedPrincipalId, role: 'data_steward',
      authorityDigest: sha('authority'), decidedAt: 10,
    }),
    verify: async (request, decision) => decision.approved
      && decision.requestDigest === request.digest
      && decision.principalId === request.authenticatedPrincipalId
      && decision.role === 'data_steward',
  };
}

function descriptorFor(body: Uint8Array) {
  return {
    objectId: 'source:1', payloadHash: hashBytes(body), tenantId: 'tenant-1', projectId: 'project-1',
    kind: 'source_message' as const, confidentiality: 'confidential' as const,
    categories: ['customer_content'], allowedPurposes: ['reconciliation' as const],
    allowedRegions: ['ap-southeast-1'], subjectRefs: ['subject:customer-1'],
    retention: { class: 'regulated_record' as const, minimumRetainUntil: 10, deleteAfter: 1000 },
    lineage: { sourceObjectIds: ['conversation:event:1'] },
    classificationSource: {
      categoryRegistryId: 'registry:tenant-1', categoryRegistryRevision: 1,
      categoryRegistryDigest: sha('registry'),
    },
  };
}

function testCryptography(secret: Uint8Array, keyId: string): PayloadVaultCryptographyPort {
  return {
    wrap: async ({ dataKey }) => ({ keyId, wrappedKey: Buffer.from(dataKey.map((value, index) => value ^ secret[index % 32]!)).toString('base64') }),
    unwrap: async ({ keyId: actual, wrappedKey }) => actual === keyId
      ? new Uint8Array(Buffer.from(wrappedKey, 'base64').map((value, index) => value ^ secret[index % 32]!)) : null,
  };
}

function hashBytes(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function sha(seed: string): string { return digest({ seed }); }
function signal(): AbortSignal { return new AbortController().signal; }
