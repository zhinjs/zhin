import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EncryptedFilePayloadVault,
  PayloadVaultIntegrityError,
  PayloadVaultCryptographyUnavailableError,
  type PayloadVaultCryptographyPort,
} from '../../src/data-governance/encrypted-file-payload-vault.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

describe('EncryptedFilePayloadVault', () => {
  it('replays an opaque encrypted source handle across restart without persisting body or key', async () => {
    const directory = join(tmpdir(), `zhin-payload-vault-${randomUUID()}`);
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const cryptography = testCryptography(key, 'kms:tenant-1:key-7');
    const body = new TextEncoder().encode('private customer objective 314159');
    const descriptor = descriptorFor(body, 'conversation-event:source-7', `sha256:${'d'.repeat(64)}`);
    const input = {
      descriptor,
      descriptorDigest: digestCanonicalWorkroomValue(descriptor),
      payload: body,
      sourceBindingDigest: `sha256:${'a'.repeat(64)}`,
    };

    const first = new EncryptedFilePayloadVault({ directory, generation: 7, cryptography });
    const handle = await first.putSource(input, new AbortController().signal);
    const replay = await new EncryptedFilePayloadVault({ directory, generation: 7, cryptography })
      .putSource(input, new AbortController().signal);
    expect(replay).toEqual(handle);
    expect(handle).toMatchObject({
      version: 1,
      objectId: descriptor.objectId,
      payloadHash: descriptor.payloadHash,
      tenantId: descriptor.tenantId,
      projectId: descriptor.projectId,
    });
    expect(JSON.stringify(handle)).not.toContain(directory);
    expect(JSON.stringify(handle)).not.toContain('kms:tenant-1:key-7');

    const restarted = new EncryptedFilePayloadVault({ directory, generation: 7, cryptography });
    const restored = await restarted.readExact({
      handle,
      requestDigest: `sha256:${'b'.repeat(64)}`,
      purpose: 'orchestration',
      principalId: 'principal:orchestrator-1',
      destinationId: 'destination:model-1',
    }, new AbortController().signal);
    expect(new TextDecoder().decode(restored)).toBe('private customer objective 314159');

    const objectFile = join(directory, 'objects', `${handle.vaultObjectId.slice('vault-object:'.length)}.json`);
    const persisted = await readFile(objectFile, 'utf8');
    expect(persisted).not.toContain('private customer objective 314159');
    expect(persisted).not.toContain(Buffer.from(key).toString('base64'));
    expect(persisted).not.toContain('subject:customer-1');
    const lifecycle = await restarted.resolveLifecycleObject(handle, new AbortController().signal);
    expect(lifecycle).toMatchObject({
      handle,
      retention: descriptor.retention,
      locations: {
        tenantId: descriptor.tenantId,
        projectId: descriptor.projectId,
        objectId: descriptor.objectId,
        vaultObjectId: handle.vaultObjectId,
        descriptorDigest: handle.descriptorDigest,
        revision: 1,
        locations: [{ kind: 'vault_primary', deletionMode: 'crypto_erase' }],
      },
    });
    expect(lifecycle?.subjectDigests).toHaveLength(1);
    expect(JSON.stringify(lifecycle)).not.toContain('subject:customer-1');
    const audits = await readdir(join(directory, 'audit'));
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(await readFile(join(directory, 'audit', audit), 'utf8'))
        .not.toContain('private customer objective 314159');
    }
  });

  it('fails closed on absent generation key authority and authenticated corruption', async () => {
    const directory = join(tmpdir(), `zhin-payload-vault-${randomUUID()}`);
    const key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const input = sourceInput(new TextEncoder().encode('governed objective'));
    const missing = new EncryptedFilePayloadVault({
      directory,
      generation: 3,
      cryptography: { wrap: async () => null, unwrap: async () => null },
    });
    await expect(missing.putSource(input, new AbortController().signal))
      .rejects.toBeInstanceOf(PayloadVaultCryptographyUnavailableError);

    const cryptography = testCryptography(key, 'kms:key-3');
    const vault = new EncryptedFilePayloadVault({ directory, generation: 3, cryptography });
    const handle = await vault.putSource(input, new AbortController().signal);
    const nextGeneration = new EncryptedFilePayloadVault({
      directory, generation: 4, cryptography,
    });
    await expect(nextGeneration.putSource(input, new AbortController().signal)).resolves.toEqual(handle);
    await expect(nextGeneration.readExact({
      handle,
      requestDigest: `sha256:${'f'.repeat(64)}`,
      purpose: 'orchestration',
      principalId: 'principal:orchestrator',
      destinationId: 'destination:model',
    }, new AbortController().signal)).resolves.toEqual(input.payload);

    const objectFile = join(directory, 'objects', `${handle.vaultObjectId.slice('vault-object:'.length)}.json`);
    const envelope = JSON.parse(await readFile(objectFile, 'utf8')) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
    await writeFile(objectFile, JSON.stringify(envelope), 'utf8');

    await expect(vault.readExact({
      handle,
      requestDigest: `sha256:${'e'.repeat(64)}`,
      purpose: 'orchestration',
      principalId: 'principal:orchestrator',
      destinationId: 'destination:model',
    }, new AbortController().signal)).rejects.toBeInstanceOf(PayloadVaultIntegrityError);

    await expect(nextGeneration.readExact({
      handle,
      requestDigest: `sha256:${'f'.repeat(64)}`,
      purpose: 'orchestration',
      principalId: 'principal:orchestrator',
      destinationId: 'destination:model',
    }, new AbortController().signal)).rejects.toBeInstanceOf(PayloadVaultIntegrityError);
  });

  it('rejects a forged Descriptor instead of trusting loose metadata next to its digest', async () => {
    const directory = join(tmpdir(), `zhin-payload-vault-${randomUUID()}`);
    const body = new TextEncoder().encode('restricted bytes');
    const descriptor = descriptorFor(body, 'object:descriptor', `sha256:${'7'.repeat(64)}`);
    const vault = new EncryptedFilePayloadVault({
      directory, generation: 1,
      cryptography: testCryptography(new Uint8Array(32).fill(5), 'kms:key'),
    });
    const forged = structuredClone(descriptor);
    forged.categories = ['different_category'];
    await expect(vault.putSource({
      descriptor: forged,
      descriptorDigest: digestCanonicalWorkroomValue(descriptor),
      payload: body,
      sourceBindingDigest: `sha256:${'6'.repeat(64)}`,
    }, new AbortController().signal)).rejects.toBeInstanceOf(PayloadVaultIntegrityError);
  });

  it('zeroes the owned DEK copy when the Root crypto provider rejects wrapping', async () => {
    const directory = join(tmpdir(), `zhin-payload-vault-${randomUUID()}`);
    const body = new TextEncoder().encode('zero this data key');
    let captured: Uint8Array | undefined;
    const vault = new EncryptedFilePayloadVault({
      directory, generation: 1,
      cryptography: {
        wrap: async ({ dataKey }) => {
          captured = dataKey;
          throw new Error('kms unavailable');
        },
        unwrap: async () => null,
      },
    });
    await expect(vault.putSource(sourceInput(body), new AbortController().signal))
      .rejects.toThrow('kms unavailable');
    expect(captured).toBeDefined();
    expect([...captured!]).toEqual(new Array(32).fill(0));
  });
});

function sourceInput(body: Uint8Array) {
  return {
    descriptor: descriptorFor(body, 'conversation-event:source-8', `sha256:${'c'.repeat(64)}`),
    descriptorDigest: digestCanonicalWorkroomValue(
      descriptorFor(body, 'conversation-event:source-8', `sha256:${'c'.repeat(64)}`),
    ),
    payload: body, sourceBindingDigest: `sha256:${'8'.repeat(64)}`,
  };
}

function descriptorFor(body: Uint8Array, objectId: string, registryDigest: string) {
  return {
    objectId, payloadHash: sha(body), tenantId: 'tenant-1', projectId: 'project-1',
    kind: 'source_message' as const, confidentiality: 'confidential' as const,
    categories: ['customer_content'], allowedPurposes: ['orchestration' as const],
    allowedRegions: ['ap-southeast-1'], subjectRefs: ['subject:customer-1'],
    retention: { class: 'operational' as const, minimumRetainUntil: 10, deleteAfter: 1000 },
    lineage: { sourceObjectIds: ['conversation:event:source'] },
    classificationSource: {
      categoryRegistryId: 'registry:tenant-1', categoryRegistryRevision: 1,
      categoryRegistryDigest: registryDigest,
    },
  };
}

function sha(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
