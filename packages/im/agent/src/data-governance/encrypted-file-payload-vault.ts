import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConfidentialityClass,
  DataDescriptor,
  DisclosurePurpose,
} from './data-governance.js';
import type {
  PayloadVaultDerivedWriteInput,
  PayloadVaultObjectHandle,
  PayloadVaultPort,
  PayloadVaultReadInput,
} from './disclosure-manifest.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import {
  createPayloadLifecycleObjectAuthority,
  createPayloadLocationManifest,
  digestPayloadSubjectRef,
  type PayloadLifecycleObjectAuthority,
  type PayloadLocationManifest,
} from './payload-lifecycle.js';

export interface PayloadVaultWrappedKey {
  readonly keyId: string;
  /** Provider-opaque wrapped DEK. It must never be the raw key encoding. */
  readonly wrappedKey: string;
}

export interface PayloadVaultCryptographyContext {
  readonly version: 1;
  readonly generation: number;
  readonly tenantId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly descriptorDigest: string;
  readonly aadDigest: string;
}

/** Trusted Root-only crypto/KMS seam. KEK bytes never leave the provider. */
export interface PayloadVaultCryptographyPort {
  wrap(
    request: PayloadVaultCryptographyContext & Readonly<{ dataKey: Uint8Array }>,
    signal: AbortSignal,
  ): PayloadVaultWrappedKey | null | Promise<PayloadVaultWrappedKey | null>;
  unwrap(
    request: PayloadVaultCryptographyContext & PayloadVaultWrappedKey,
    signal: AbortSignal,
  ): Uint8Array | null | Promise<Uint8Array | null>;
}

export interface PayloadVaultSourceWriteInput {
  /** Complete canonical descriptor; loose classification fields are forbidden. */
  readonly descriptor: DataDescriptor;
  readonly descriptorDigest: string;
  readonly payload: Uint8Array;
  readonly sourceBindingDigest: string;
}

export class PayloadVaultCryptographyUnavailableError extends Error {
  constructor(readonly tenantId: string, readonly projectId: string, readonly keyId?: string) {
    super(`Payload Vault key authority is unavailable for ${tenantId}/${projectId}`);
    this.name = 'PayloadVaultCryptographyUnavailableError';
  }
}

export class PayloadVaultIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PayloadVaultIntegrityError';
  }
}

export interface VaultObjectEnvelope {
  readonly version: 1;
  readonly handle: PayloadVaultObjectHandle;
  readonly aad: Readonly<{
    version: 1;
    issuedGeneration: number;
    objectId: string;
    payloadHash: string;
    descriptorDigest: string;
    tenantId: string;
    projectId: string;
    confidentiality: Exclude<ConfidentialityClass, 'unknown'>;
    categories: readonly string[];
    subjectDigests: readonly string[];
    lineage: Readonly<{
      sourceObjectIds: readonly string[];
      transformRef?: string;
      sourceBindingDigest?: string;
    }>;
    retention: DataDescriptor['retention'];
    locationManifest: PayloadLocationManifest;
  }>;
  readonly encryption: Readonly<{
    algorithm: 'aes-256-gcm';
    keyId: string;
    payloadIv: string;
    payloadTag: string;
    wrappedKey: string;
  }>;
  readonly ciphertext: string;
  readonly digest: string;
}

export interface EncryptedFilePayloadVaultOptions {
  /** Repository leaf; its parent must already exist. */
  readonly directory: string;
  readonly generation: number;
  readonly cryptography: PayloadVaultCryptographyPort;
}

export interface EncryptedPayloadVaultStorageAuthority {
  readonly locationIdPrefix: string;
  readonly authorityDigest: string;
}

export interface SealedPayloadVaultObject {
  readonly handle: PayloadVaultObjectHandle;
  readonly envelope: VaultObjectEnvelope;
  readonly audit: Readonly<Record<string, unknown>>;
}

/**
 * Immutable AES-256-GCM envelope Vault. Every object receives a random DEK;
 * only a KeyProvider-wrapped DEK is persisted. Handles reveal no path or key id.
 */
export class EncryptedFilePayloadVault implements PayloadVaultPort {
  readonly #root: DurableFileStore;
  readonly #objects: DurableFileStore;
  readonly #audit: DurableFileStore;
  readonly #generation: number;
  readonly #cryptography: PayloadVaultCryptographyPort;
  readonly #locationAuthorityDigest: string;
  #ready?: Promise<void>;

  constructor(options: EncryptedFilePayloadVaultOptions) {
    this.#generation = positiveInteger(options.generation, 'generation');
    this.#cryptography = options.cryptography;
    this.#locationAuthorityDigest = digest({
      version: 1,
      adapter: 'encrypted-file-payload-vault',
      repositoryIdentityDigest: digest({ directory: options.directory }),
    });
    this.#root = new DurableFileStore(options.directory);
    this.#objects = new DurableFileStore(join(options.directory, 'objects'));
    this.#audit = new DurableFileStore(join(options.directory, 'audit'));
  }

  async putSource(
    input: PayloadVaultSourceWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    return await this.#put(input, signal);
  }

  async putDerived(
    input: PayloadVaultDerivedWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    return await this.#put(input, signal);
  }

  async readExact(input: PayloadVaultReadInput, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    await this.#ensureReady();
    assertHandle(input.handle);
    requireDigest(input.requestDigest, 'requestDigest');
    requireText(input.principalId, 'principalId');
    requireText(input.destinationId, 'destinationId');
    const envelope = await this.#readEnvelope(this.#objectPath(input.handle.vaultObjectId));
    const plaintext = await openEncryptedPayloadVaultEnvelope({
      generation: this.#generation,
      cryptography: this.#cryptography,
      envelope,
      input,
      signal,
    });
    await this.#recordAudit(readAudit(this.#generation, input));
    return plaintext;
  }

  /** Trusted Root lifecycle resolver; never publish the Vault itself as a Resource. */
  async resolveLifecycleObject(
    handle: PayloadVaultObjectHandle,
    signal: AbortSignal,
  ): Promise<PayloadLifecycleObjectAuthority | undefined> {
    signal.throwIfAborted();
    await this.#ensureReady();
    let envelope: VaultObjectEnvelope;
    try {
      envelope = await this.#readEnvelope(this.#objectPath(handle.vaultObjectId));
    } catch (error) {
      if (error instanceof PayloadVaultIntegrityError) return undefined;
      throw error;
    }
    return resolveEncryptedPayloadVaultLifecycleObject(envelope, handle);
  }

  async #put(
    input: PayloadVaultSourceWriteInput | PayloadVaultDerivedWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    signal.throwIfAborted();
    await this.#ensureReady();
    const sealed = await sealEncryptedPayloadVaultEnvelope({
      generation: this.#generation,
      cryptography: this.#cryptography,
      storage: {
        locationIdPrefix: 'vault-file',
        authorityDigest: this.#locationAuthorityDigest,
      },
      input,
      signal,
    });
    const target = this.#objectPath(sealed.handle.vaultObjectId);
    const published = await this.#objects.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(sealed.envelope),
      createdValue: sealed.handle,
      onConflict: async () => {
        const winner = await this.#readEnvelope(target);
        assertEnvelope(winner, sealed.handle);
        return winner.handle;
      },
    });
    await this.#recordAudit(sealed.audit);
    return published.value;
  }

  #objectPath(vaultObjectId: string): string {
    const match = /^vault-object:([a-f\d]{64})$/u.exec(vaultObjectId);
    if (!match) throw new PayloadVaultIntegrityError('Payload Vault object id is invalid');
    return join(this.#objects.directory, `${match[1]}.json`);
  }

  async #readEnvelope(path: string): Promise<VaultObjectEnvelope> {
    await this.#objects.syncLeaf();
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new PayloadVaultIntegrityError('Payload Vault object is absent or malformed', { cause: error });
    }
    if (!value || typeof value !== 'object') {
      throw new PayloadVaultIntegrityError('Payload Vault object is malformed');
    }
    return value as VaultObjectEnvelope;
  }

  async #recordAudit(value: Readonly<Record<string, unknown>>): Promise<void> {
    const content = deepFreeze({ ...structuredClone(value), digest: digest(value) });
    const id = digest(content).slice('sha256:'.length);
    const target = join(this.#audit.directory, `${id}.json`);
    await this.#audit.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(content),
      createdValue: undefined,
      onConflict: async () => {
        await this.#audit.syncLeaf();
        const winner = await readFile(target, 'utf8');
        if (winner !== canonicalWorkroomJson(content)) {
          throw new PayloadVaultIntegrityError('Payload Vault audit replay drift');
        }
      },
    });
  }

  #ensureReady(): Promise<void> {
    this.#ready ??= (async () => {
      await this.#root.ensureDurableLeaf('Encrypted Payload Vault');
      await this.#objects.ensureDurableLeaf('Encrypted Payload Vault objects');
      await this.#audit.ensureDurableLeaf('Encrypted Payload Vault audit');
      await this.#root.syncLeafAndParent();
    })();
    return this.#ready;
  }
}

export async function sealEncryptedPayloadVaultEnvelope(options: Readonly<{
  generation: number;
  cryptography: PayloadVaultCryptographyPort;
  storage: EncryptedPayloadVaultStorageAuthority;
  input: PayloadVaultSourceWriteInput | PayloadVaultDerivedWriteInput;
  signal: AbortSignal;
}>): Promise<SealedPayloadVaultObject> {
  options.signal.throwIfAborted();
  const generation = positiveInteger(options.generation, 'generation');
  requireText(options.storage.locationIdPrefix, 'locationIdPrefix');
  requireDigest(options.storage.authorityDigest, 'storage authorityDigest');
  const normalized = normalizeWrite(options.input);
  const identity = deepFreeze({
    version: 1 as const,
    objectId: normalized.objectId,
    payloadHash: normalized.payloadHash,
    descriptorDigest: normalized.descriptorDigest,
    tenantId: normalized.tenantId,
    projectId: normalized.projectId,
  });
  const vaultObjectId = `vault-object:${digest(identity).slice('sha256:'.length)}`;
  const locationManifest = createPayloadLocationManifest({
    version: 1,
    tenantId: normalized.tenantId,
    projectId: normalized.projectId,
    objectId: normalized.objectId,
    vaultObjectId,
    descriptorDigest: normalized.descriptorDigest,
    revision: 1,
    locations: [{
      id: `${options.storage.locationIdPrefix}:${vaultObjectId}`,
      kind: 'vault_primary',
      authorityDigest: options.storage.authorityDigest,
      deletionMode: 'crypto_erase',
    }],
  });
  const handle = deepFreeze<PayloadVaultObjectHandle>({
    version: 1,
    vaultObjectId,
    objectId: normalized.objectId,
    payloadHash: normalized.payloadHash,
    descriptorDigest: normalized.descriptorDigest,
    tenantId: normalized.tenantId,
    projectId: normalized.projectId,
    locationManifestDigest: locationManifest.digest,
  });
  const aad = deepFreeze<VaultObjectEnvelope['aad']>({
    ...identity,
    issuedGeneration: generation,
    confidentiality: normalized.confidentiality,
    categories: normalized.categories,
    subjectDigests: normalized.subjectRefs.map(subjectRef =>
      digestPayloadSubjectRef(normalized.tenantId, subjectRef)),
    lineage: normalized.lineage,
    retention: normalized.retention,
    locationManifest,
  });
  const dataKey = randomBytes(32);
  try {
    const payloadCipher = encrypt(dataKey, Buffer.from(normalized.payload), Buffer.from(canonicalWorkroomJson(aad)));
    const wrappedKey = await wrapEncryptedPayloadVaultKey(options.cryptography, {
      version: 1,
      generation,
      tenantId: normalized.tenantId,
      projectId: normalized.projectId,
      objectId: normalized.objectId,
      descriptorDigest: normalized.descriptorDigest,
      aadDigest: digest(aad),
      dataKey: new Uint8Array(dataKey),
    }, options.signal);
    const body = deepFreeze<Omit<VaultObjectEnvelope, 'digest'>>({
      version: 1,
      handle,
      aad,
      encryption: {
        algorithm: 'aes-256-gcm',
        keyId: wrappedKey.keyId,
        payloadIv: payloadCipher.iv,
        payloadTag: payloadCipher.tag,
        wrappedKey: wrappedKey.wrappedKey,
      },
      ciphertext: payloadCipher.ciphertext,
    });
    return deepFreeze({
      handle,
      envelope: deepFreeze({ ...body, digest: digest(body) }),
      audit: writeAudit(generation, handle, normalized.lineage),
    });
  } finally {
    dataKey.fill(0);
    normalized.payload.fill(0);
  }
}

export async function openEncryptedPayloadVaultEnvelope(options: Readonly<{
  generation: number;
  cryptography: PayloadVaultCryptographyPort;
  envelope: VaultObjectEnvelope;
  input: PayloadVaultReadInput;
  signal: AbortSignal;
}>): Promise<Uint8Array> {
  options.signal.throwIfAborted();
  const generation = positiveInteger(options.generation, 'generation');
  assertHandle(options.input.handle);
  requireDigest(options.input.requestDigest, 'requestDigest');
  requireText(options.input.principalId, 'principalId');
  requireText(options.input.destinationId, 'destinationId');
  assertEnvelope(options.envelope, options.input.handle);
  const dataKey = await unwrapEncryptedPayloadVaultKey(options.cryptography, {
    version: 1,
    generation,
    tenantId: options.input.handle.tenantId,
    projectId: options.input.handle.projectId,
    objectId: options.input.handle.objectId,
    descriptorDigest: options.input.handle.descriptorDigest,
    aadDigest: digest(options.envelope.aad),
    keyId: options.envelope.encryption.keyId,
    wrappedKey: options.envelope.encryption.wrappedKey,
  }, options.signal);
  try {
    const plaintext = decrypt(
      Buffer.from(dataKey),
      options.envelope.encryption.payloadIv,
      options.envelope.encryption.payloadTag,
      options.envelope.ciphertext,
      Buffer.from(canonicalWorkroomJson(options.envelope.aad)),
    );
    if (hashBytes(plaintext) !== options.input.handle.payloadHash) {
      throw new PayloadVaultIntegrityError('Payload Vault decrypted body hash mismatch');
    }
    return new Uint8Array(plaintext);
  } finally {
    dataKey.fill(0);
  }
}

export function resolveEncryptedPayloadVaultLifecycleObject(
  envelope: VaultObjectEnvelope,
  handle: PayloadVaultObjectHandle,
): PayloadLifecycleObjectAuthority {
  assertEnvelope(envelope, handle);
  const manifest = createPayloadLocationManifest(envelope.aad.locationManifest);
  if (canonicalWorkroomJson(manifest) !== canonicalWorkroomJson(envelope.aad.locationManifest)) {
    throw new PayloadVaultIntegrityError('Payload Vault Location Manifest is non-canonical');
  }
  return createPayloadLifecycleObjectAuthority({
    version: 1,
    handle,
    retention: envelope.aad.retention,
    subjectDigests: envelope.aad.subjectDigests,
    locations: manifest,
  });
}

export function readEncryptedPayloadVaultAudit(
  generation: number,
  input: PayloadVaultReadInput,
): Readonly<Record<string, unknown>> {
  return readAudit(generation, input);
}

async function wrapEncryptedPayloadVaultKey(
  cryptography: PayloadVaultCryptographyPort,
  request: PayloadVaultCryptographyContext & Readonly<{ dataKey: Uint8Array }>,
  signal: AbortSignal,
): Promise<PayloadVaultWrappedKey> {
  const ownedDataKey = new Uint8Array(request.dataKey);
  try {
    const authority = await abortable(Promise.resolve(cryptography.wrap(
      Object.freeze({ ...request, dataKey: ownedDataKey }),
      signal,
    )), signal);
    if (!authority) throw new PayloadVaultCryptographyUnavailableError(request.tenantId, request.projectId);
    requireText(authority.keyId, 'keyId');
    requireText(authority.wrappedKey, 'wrappedKey');
    if (authority.wrappedKey === Buffer.from(ownedDataKey).toString('base64')) {
      throw new PayloadVaultIntegrityError('Payload Vault crypto provider returned an unwrapped data key');
    }
    return { keyId: authority.keyId, wrappedKey: authority.wrappedKey };
  } finally {
    ownedDataKey.fill(0);
  }
}

async function unwrapEncryptedPayloadVaultKey(
  cryptography: PayloadVaultCryptographyPort,
  request: PayloadVaultCryptographyContext & PayloadVaultWrappedKey,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const key = await abortable(Promise.resolve(cryptography.unwrap(deepFreeze(request), signal)), signal);
  if (!key) throw new PayloadVaultCryptographyUnavailableError(request.tenantId, request.projectId, request.keyId);
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new PayloadVaultIntegrityError('Payload Vault crypto provider returned an invalid data key');
  }
  return new Uint8Array(key);
}

function writeAudit(
  generation: number,
  handle: PayloadVaultObjectHandle,
  lineage: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    version: 1,
    operation: 'write',
    generation,
    vaultObjectId: handle.vaultObjectId,
    objectId: handle.objectId,
    descriptorDigest: handle.descriptorDigest,
    payloadHash: handle.payloadHash,
    tenantId: handle.tenantId,
    projectId: handle.projectId,
    lineageDigest: digest(lineage),
  });
}

function readAudit(
  generation: number,
  input: PayloadVaultReadInput,
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    version: 1,
    operation: 'read',
    generation,
    vaultObjectId: input.handle.vaultObjectId,
    objectId: input.handle.objectId,
    descriptorDigest: input.handle.descriptorDigest,
    payloadHash: input.handle.payloadHash,
    tenantId: input.handle.tenantId,
    projectId: input.handle.projectId,
    requestDigest: input.requestDigest,
    purpose: input.purpose,
    principalId: input.principalId,
    destinationId: input.destinationId,
  });
}

function normalizeWrite(input: PayloadVaultSourceWriteInput | PayloadVaultDerivedWriteInput) {
  const descriptor = structuredClone(input.descriptor);
  requireText(descriptor.objectId, 'objectId');
  requireDigest(descriptor.payloadHash, 'payloadHash');
  requireText(descriptor.tenantId, 'tenantId');
  requireText(descriptor.projectId, 'projectId');
  const descriptorDigest = digest(descriptor);
  requireDigest(input.descriptorDigest, 'descriptorDigest');
  if (input.descriptorDigest !== descriptorDigest) {
    throw new PayloadVaultIntegrityError('Payload Vault Descriptor digest mismatch');
  }
  if (!(input.payload instanceof Uint8Array) || hashBytes(input.payload) !== descriptor.payloadHash) {
    throw new PayloadVaultIntegrityError('Payload Vault write body does not match payloadHash');
  }
  if (!['public', 'project_internal', 'confidential', 'restricted'].includes(descriptor.confidentiality)) {
    throw new PayloadVaultIntegrityError('Payload Vault confidentiality is invalid');
  }
  const categories = uniqueTexts(descriptor.categories, 'categories');
  const subjectRefs = uniqueTexts(descriptor.subjectRefs, 'subjectRefs');
  const sourceObjectIds = uniqueTexts(descriptor.lineage.sourceObjectIds, 'lineage.sourceObjectIds');
  if (sourceObjectIds.length === 0) {
    throw new PayloadVaultIntegrityError('Payload Vault source lineage is empty');
  }
  const lineage = 'sourceBindingDigest' in input
    ? deepFreeze({
      sourceObjectIds,
      sourceBindingDigest: requireDigest(input.sourceBindingDigest, 'sourceBindingDigest'),
    })
    : deepFreeze({
      sourceObjectIds,
      ...(descriptor.lineage.transformRef === undefined
        ? {}
        : { transformRef: requireText(descriptor.lineage.transformRef, 'transformRef') }),
    });
  if (!descriptor.retention || !Number.isSafeInteger(descriptor.retention.minimumRetainUntil)
    || !Number.isSafeInteger(descriptor.retention.deleteAfter)
    || descriptor.retention.minimumRetainUntil < 0
    || descriptor.retention.deleteAfter < descriptor.retention.minimumRetainUntil) {
    throw new PayloadVaultIntegrityError('Payload Vault retention window is invalid');
  }
  if (canonicalWorkroomJson(descriptor.categories) !== canonicalWorkroomJson(categories)
    || canonicalWorkroomJson(descriptor.subjectRefs) !== canonicalWorkroomJson(subjectRefs)
    || canonicalWorkroomJson(descriptor.lineage.sourceObjectIds) !== canonicalWorkroomJson(sourceObjectIds)) {
    throw new PayloadVaultIntegrityError('Payload Vault Descriptor is non-canonical');
  }
  // ECMAScript rejects freezing non-empty typed arrays. The Vault owns this
  // byte copy and never exposes it; all authority-bearing metadata is frozen.
  return Object.freeze({
    objectId: descriptor.objectId,
    payload: new Uint8Array(input.payload),
    payloadHash: descriptor.payloadHash,
    descriptorDigest,
    tenantId: descriptor.tenantId,
    projectId: descriptor.projectId,
    confidentiality: descriptor.confidentiality,
    categories,
    subjectRefs,
    lineage,
    retention: { ...descriptor.retention },
  });
}

function assertEnvelope(
  value: VaultObjectEnvelope,
  handle: PayloadVaultObjectHandle,
): void {
  let manifest: PayloadLocationManifest;
  try {
    manifest = createPayloadLocationManifest(value.aad?.locationManifest);
  } catch (error) {
    throw new PayloadVaultIntegrityError('Payload Vault Location Manifest is malformed', { cause: error });
  }
  if (value.version !== 1 || value.encryption?.algorithm !== 'aes-256-gcm'
    || canonicalWorkroomJson(value.handle) !== canonicalWorkroomJson(handle)
    || !Number.isSafeInteger(value.aad?.issuedGeneration)
    || value.aad.issuedGeneration < 1
    || value.aad.objectId !== handle.objectId
    || value.aad.payloadHash !== handle.payloadHash
    || value.aad.descriptorDigest !== handle.descriptorDigest
    || value.aad.tenantId !== handle.tenantId
    || value.aad.projectId !== handle.projectId
    || canonicalWorkroomJson(manifest) !== canonicalWorkroomJson(value.aad.locationManifest)
    || manifest.digest !== handle.locationManifestDigest) {
    throw new PayloadVaultIntegrityError('Payload Vault envelope authority binding mismatch');
  }
  const { digest: actualDigest, ...body } = value;
  if (actualDigest !== digest(body)) {
    throw new PayloadVaultIntegrityError('Payload Vault envelope digest mismatch');
  }
}

function assertHandle(value: PayloadVaultObjectHandle): void {
  if (value.version !== 1 || !/^vault-object:[a-f\d]{64}$/u.test(value.vaultObjectId)) {
    throw new PayloadVaultIntegrityError('Payload Vault handle is invalid');
  }
  requireText(value.objectId, 'objectId');
  requireDigest(value.payloadHash, 'payloadHash');
  requireDigest(value.descriptorDigest, 'descriptorDigest');
  requireText(value.tenantId, 'tenantId');
  requireText(value.projectId, 'projectId');
  requireDigest(value.locationManifestDigest, 'locationManifestDigest');
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt(key: Buffer, iv: string, tag: string, ciphertext: string, aad: Buffer): Buffer {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  } catch (error) {
    throw new PayloadVaultIntegrityError('Payload Vault authenticated decryption failed', { cause: error });
  }
}

function uniqueTexts(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new PayloadVaultIntegrityError(`Payload Vault ${label} is invalid`);
  return Object.freeze([...new Set(values.map(value => requireText(value, label)))].sort());
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new PayloadVaultIntegrityError(`Payload Vault ${label} is invalid`);
  }
  return value;
}

function requireDigest(value: string, label: string): string {
  if (!/^sha256:[a-f\d]{64}$/u.test(value)) {
    throw new PayloadVaultIntegrityError(`Payload Vault ${label} is invalid`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PayloadVaultIntegrityError(`Payload Vault ${label} must be positive`);
  }
  return value;
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new DOMException('Payload Vault cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
