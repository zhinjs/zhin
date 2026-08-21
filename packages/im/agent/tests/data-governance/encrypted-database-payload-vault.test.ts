import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL,
  ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL,
  EncryptedDatabasePayloadVault,
  defineEncryptedPayloadVaultDatabaseModels,
  type EncryptedPayloadVaultDatabase,
  type EncryptedPayloadVaultDatabaseModel,
} from '../../src/data-governance/encrypted-database-payload-vault.js';
import {
  PayloadVaultCryptographyUnavailableError,
  PayloadVaultIntegrityError,
  type PayloadVaultCryptographyPort,
} from '../../src/data-governance/encrypted-file-payload-vault.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Encrypted Database Payload Vault', () => {
  it('persists an exact encrypted envelope and content-free audit across restart', async () => {
    const fixture = databaseFixture();
    const body = new TextEncoder().encode('private investment thesis 271828');
    const descriptor = descriptorFor(body, 'source:investment-1');
    const input = {
      descriptor,
      descriptorDigest: digest(descriptor),
      payload: body,
      sourceBindingDigest: sha('source-binding'),
    };
    const cryptography = testCryptography(new Uint8Array(32).fill(13), 'kms:tenant-1:key-13');
    const first = vault(fixture, cryptography);

    const handle = await first.putSource(input, signal());
    const restarted = vault(fixture, cryptography, 8);
    await expect(restarted.readExact({
      handle,
      requestDigest: sha('request'),
      purpose: 'orchestration',
      principalId: 'principal:orchestrator',
      destinationId: 'destination:model',
    }, signal())).resolves.toEqual(body);
    await expect(restarted.resolveLifecycleObject(handle, signal())).resolves.toMatchObject({
      handle,
      locations: { locations: [{ kind: 'vault_primary', deletionMode: 'crypto_erase' }] },
    });

    expect(fixture.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE']);
    expect(fixture.objects).toHaveLength(1);
    expect(fixture.audits).toHaveLength(2);
    const persisted = JSON.stringify({ objects: fixture.objects, audits: fixture.audits });
    expect(persisted).not.toContain('private investment thesis 271828');
    expect(persisted).not.toContain(Buffer.from(new Uint8Array(32).fill(13)).toString('base64'));
    expect(persisted).not.toContain('subject:client-1');
  });

  it('rereads an exact concurrent winner and rejects a different envelope at the same identity', async () => {
    const fixture = databaseFixture();
    const cryptography = testCryptography(new Uint8Array(32).fill(21), 'kms:key-21');
    const repository = vault(fixture, cryptography);
    const body = new TextEncoder().encode('same body');
    const input = sourceInput(body, 'source:same');
    fixture.loseNextObjectInsertWithExactCandidate();

    await expect(repository.putSource(input, signal())).resolves.toMatchObject({
      objectId: 'source:same',
    });
    expect(fixture.objects).toHaveLength(1);

    fixture.objects[0]!.envelope_digest = sha('forged');
    await expect(repository.putSource(input, signal()))
      .rejects.toBeInstanceOf(PayloadVaultIntegrityError);
  });

  it('fails closed on missing KMS and every persisted envelope binding drift', async () => {
    const fixture = databaseFixture();
    const input = sourceInput(new TextEncoder().encode('confidential support transcript'), 'source:support');
    const missing = vault(fixture, { wrap: async () => null, unwrap: async () => null });
    await expect(missing.putSource(input, signal()))
      .rejects.toBeInstanceOf(PayloadVaultCryptographyUnavailableError);
    expect(fixture.objects).toHaveLength(0);

    const cryptography = testCryptography(new Uint8Array(32).fill(34), 'kms:key-34');
    const repository = vault(fixture, cryptography);
    const handle = await repository.putSource(input, signal());
    const original = structuredClone(fixture.objects[0]!);
    for (const mutate of [
      (row: Record<string, unknown>) => { row.envelope_digest = sha('drift'); },
      (row: Record<string, unknown>) => { row.descriptor_digest = sha('drift'); },
      (row: Record<string, unknown>) => {
        const envelope = JSON.parse(String(row.envelope_json)) as { ciphertext: string };
        envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
        row.envelope_json = JSON.stringify(envelope);
      },
    ]) {
      fixture.objects[0] = structuredClone(original);
      mutate(fixture.objects[0]!);
      await expect(repository.readExact({
        handle, requestDigest: sha('read'), purpose: 'audit',
        principalId: 'principal:steward', destinationId: 'destination:audit',
      }, signal())).rejects.toBeInstanceOf(PayloadVaultIntegrityError);
    }
  });

  it('registers both exact Database models through the shared definer', () => {
    const define = vi.fn();
    defineEncryptedPayloadVaultDatabaseModels({ define });
    expect(define).toHaveBeenNthCalledWith(
      1, 'payload_vault_objects', ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL,
    );
    expect(define).toHaveBeenNthCalledWith(
      2, 'payload_vault_audit', ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL,
    );
  });
});

function vault(
  fixture: ReturnType<typeof databaseFixture>,
  cryptography: PayloadVaultCryptographyPort,
  generation = 7,
) {
  return new EncryptedDatabasePayloadVault({
    database: fixture.database,
    objectModel: fixture.objectModel,
    auditModel: fixture.auditModel,
    generation,
    cryptography,
    repositoryIdentity: 'database:primary',
  });
}

function databaseFixture() {
  const objects: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  let exactWinner = false;
  const rowsFor = (table: string) => table === 'payload_vault_objects' ? objects : audits;
  const select = (table: string, query: Record<string, unknown>) => rowsFor(table).filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const objectModel: EncryptedPayloadVaultDatabaseModel = {
    select: () => ({ where: async query => select('payload_vault_objects', query) }),
  };
  const auditModel: EncryptedPayloadVaultDatabaseModel = {
    select: () => ({ where: async query => select('payload_vault_audit', query) }),
  };
  const database: EncryptedPayloadVaultDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      return await operation({
        select: table => ({ where: async query => select(table, query) }),
        insertMany: async (table, candidates) => {
          const rows = rowsFor(table);
          if (exactWinner && table === 'payload_vault_objects') {
            exactWinner = false;
            rows.push(structuredClone(candidates[0]!));
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          if (candidates.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          rows.push(...structuredClone(candidates));
        },
      });
    },
  };
  return {
    objects, audits, isolationLevels, database, objectModel, auditModel,
    loseNextObjectInsertWithExactCandidate: () => { exactWinner = true; },
  };
}

function sourceInput(body: Uint8Array, objectId: string) {
  const descriptor = descriptorFor(body, objectId);
  return {
    descriptor, descriptorDigest: digest(descriptor), payload: body,
    sourceBindingDigest: sha('source-binding'),
  };
}

function descriptorFor(body: Uint8Array, objectId: string) {
  return {
    objectId, payloadHash: hashBytes(body), tenantId: 'tenant-1', projectId: 'project-1',
    kind: 'source_message' as const, confidentiality: 'confidential' as const,
    categories: ['customer_content'], allowedPurposes: ['orchestration' as const, 'audit' as const],
    allowedRegions: ['ap-southeast-1'], subjectRefs: ['subject:client-1'],
    retention: { class: 'regulated_record' as const, minimumRetainUntil: 10, deleteAfter: 1000 },
    lineage: { sourceObjectIds: ['conversation:event:source'] },
    classificationSource: {
      categoryRegistryId: 'registry:tenant-1', categoryRegistryRevision: 2,
      categoryRegistryDigest: sha('registry'),
    },
  };
}

function testCryptography(secret: Uint8Array, keyId: string): PayloadVaultCryptographyPort {
  return {
    wrap: async ({ dataKey }) => ({
      keyId,
      wrappedKey: Buffer.from(dataKey.map((value, index) => value ^ secret[index % secret.length]!))
        .toString('base64'),
    }),
    unwrap: async ({ keyId: requested, wrappedKey }) => requested === keyId
      ? new Uint8Array(Buffer.from(wrappedKey, 'base64')
        .map((value, index) => value ^ secret[index % secret.length]!))
      : null,
  };
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha(seed: string): string { return digest({ seed }); }
function signal(): AbortSignal { return new AbortController().signal; }
