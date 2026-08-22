import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type {
  PayloadVaultDerivedWriteInput,
  PayloadVaultObjectHandle,
  PayloadVaultPort,
  PayloadVaultReadInput,
} from './disclosure-manifest.js';
import {
  PayloadVaultIntegrityError,
  openEncryptedPayloadVaultEnvelope,
  readEncryptedPayloadVaultAudit,
  resolveEncryptedPayloadVaultLifecycleObject,
  sealEncryptedPayloadVaultEnvelope,
  type PayloadVaultCryptographyPort,
  type PayloadVaultSourceWriteInput,
  type SealedPayloadVaultObject,
  type VaultObjectEnvelope,
} from './encrypted-file-payload-vault.js';
import type { PayloadLifecycleObjectAuthority } from './payload-lifecycle.js';

export interface EncryptedPayloadVaultDatabaseModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

export interface EncryptedPayloadVaultDatabaseTransaction {
  select(table: string): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface EncryptedPayloadVaultDatabase {
  transaction<T>(
    operation: (transaction: EncryptedPayloadVaultDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export interface EncryptedDatabasePayloadVaultOptions {
  readonly database: EncryptedPayloadVaultDatabase;
  readonly objectModel: EncryptedPayloadVaultDatabaseModel;
  readonly auditModel: EncryptedPayloadVaultDatabaseModel;
  readonly generation: number;
  readonly cryptography: PayloadVaultCryptographyPort;
  /** Stable Root-owned database identity, never a connection string or credential. */
  readonly repositoryIdentity: string;
}

/** Root-private Database adapter. Only governed materializers receive its narrow ports. */
export class EncryptedDatabasePayloadVault implements PayloadVaultPort {
  readonly #database: EncryptedPayloadVaultDatabase;
  readonly #objectModel: EncryptedPayloadVaultDatabaseModel;
  readonly #auditModel: EncryptedPayloadVaultDatabaseModel;
  readonly #generation: number;
  readonly #cryptography: PayloadVaultCryptographyPort;
  readonly #storage = {
    locationIdPrefix: 'vault-database',
    authorityDigest: '',
  };

  constructor(options: EncryptedDatabasePayloadVaultOptions) {
    this.#database = options.database;
    this.#objectModel = options.objectModel;
    this.#auditModel = options.auditModel;
    this.#generation = positiveInteger(options.generation, 'generation');
    this.#cryptography = options.cryptography;
    const repositoryIdentity = required(options.repositoryIdentity, 'repositoryIdentity');
    this.#storage = deepFreeze({
      locationIdPrefix: 'vault-database',
      authorityDigest: digest({
        version: 1,
        adapter: 'encrypted-database-payload-vault',
        repositoryIdentityDigest: digest({ repositoryIdentity }),
      }),
    });
  }

  putSource(
    input: PayloadVaultSourceWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    return this.#put(input, signal);
  }

  putDerived(
    input: PayloadVaultDerivedWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    return this.#put(input, signal);
  }

  async readExact(input: PayloadVaultReadInput, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    const envelope = await this.#readEnvelope(input.handle);
    const plaintext = await openEncryptedPayloadVaultEnvelope({
      generation: this.#generation,
      cryptography: this.#cryptography,
      envelope,
      input,
      signal,
    });
    await this.#appendAudit(readEncryptedPayloadVaultAudit(this.#generation, input), signal);
    return plaintext;
  }

  async resolveLifecycleObject(
    handle: PayloadVaultObjectHandle,
    signal: AbortSignal,
  ): Promise<PayloadLifecycleObjectAuthority | undefined> {
    signal.throwIfAborted();
    const rows = await this.#objectModel.select().where({ vault_object_id: handle.vaultObjectId });
    if (rows.length === 0) return undefined;
    return resolveEncryptedPayloadVaultLifecycleObject(parseObjectRow(rows, handle), handle);
  }

  async #put(
    input: PayloadVaultSourceWriteInput | PayloadVaultDerivedWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle> {
    signal.throwIfAborted();
    const sealed = await sealEncryptedPayloadVaultEnvelope({
      generation: this.#generation,
      cryptography: this.#cryptography,
      storage: this.#storage,
      input,
      signal,
    });
    try {
      return await this.#database.transaction(async transaction => {
        signal.throwIfAborted();
        const rows = await transaction.select('payload_vault_objects').where({
          vault_object_id: sealed.handle.vaultObjectId,
        });
        if (rows.length > 0) {
          const winner = parseObjectRow(rows, sealed.handle);
          await insertAudit(transaction, sealed.audit);
          return winner.handle;
        }
        await transaction.insertMany('payload_vault_objects', [objectRow(sealed)]);
        await insertAudit(transaction, sealed.audit);
        return sealed.handle;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (!isDatabaseCasLoser(error)) throw error;
      const winner = await this.#readEnvelope(sealed.handle);
      await this.#appendAudit(sealed.audit, signal);
      return winner.handle;
    }
  }

  async #readEnvelope(handle: PayloadVaultObjectHandle): Promise<VaultObjectEnvelope> {
    const rows = await this.#objectModel.select().where({ vault_object_id: handle.vaultObjectId });
    return parseObjectRow(rows, handle);
  }

  async #appendAudit(value: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const candidate = auditRow(value);
    try {
      await this.#database.transaction(async transaction => {
        signal.throwIfAborted();
        const rows = await transaction.select('payload_vault_audit').where({ id: candidate.id });
        if (rows.length > 0) {
          assertAuditRows(rows, candidate);
          return;
        }
        await transaction.insertMany('payload_vault_audit', [candidate]);
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (!isDatabaseCasLoser(error)) throw error;
      assertAuditRows(await this.#auditModel.select().where({ id: candidate.id }), candidate);
    }
  }
}

export const ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  vault_object_id: { type: 'text' as const, nullable: false },
  tenant_id: { type: 'text' as const, nullable: false },
  project_id: { type: 'text' as const, nullable: false },
  object_id: { type: 'text' as const, nullable: false },
  payload_hash: { type: 'text' as const, nullable: false },
  descriptor_digest: { type: 'text' as const, nullable: false },
  location_manifest_digest: { type: 'text' as const, nullable: false },
  envelope_digest: { type: 'text' as const, nullable: false },
  envelope_json: { type: 'text' as const, nullable: false },
};

export const ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  vault_object_id: { type: 'text' as const, nullable: false },
  operation: { type: 'text' as const, nullable: false },
  audit_digest: { type: 'text' as const, nullable: false },
  audit_json: { type: 'text' as const, nullable: false },
};

export function defineEncryptedPayloadVaultDatabaseModels(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('payload_vault_objects', ENCRYPTED_PAYLOAD_VAULT_OBJECT_MODEL);
  database.define('payload_vault_audit', ENCRYPTED_PAYLOAD_VAULT_AUDIT_MODEL);
}

function objectRow(sealed: SealedPayloadVaultObject): Record<string, unknown> {
  return {
    id: sealed.handle.vaultObjectId,
    vault_object_id: sealed.handle.vaultObjectId,
    tenant_id: sealed.handle.tenantId,
    project_id: sealed.handle.projectId,
    object_id: sealed.handle.objectId,
    payload_hash: sealed.handle.payloadHash,
    descriptor_digest: sealed.handle.descriptorDigest,
    location_manifest_digest: sealed.handle.locationManifestDigest,
    envelope_digest: sealed.envelope.digest,
    envelope_json: canonicalWorkroomJson(sealed.envelope),
  };
}

function parseObjectRow(
  rows: readonly Record<string, unknown>[],
  handle: PayloadVaultObjectHandle,
): VaultObjectEnvelope {
  if (rows.length !== 1) {
    throw new PayloadVaultIntegrityError('Payload Vault Database object is absent or duplicated');
  }
  const row = rows[0]!;
  exactKeys(row, [
    'id', 'vault_object_id', 'tenant_id', 'project_id', 'object_id', 'payload_hash',
    'descriptor_digest', 'location_manifest_digest', 'envelope_digest', 'envelope_json',
  ], 'object');
  if (row.id !== handle.vaultObjectId || row.vault_object_id !== handle.vaultObjectId
    || row.tenant_id !== handle.tenantId || row.project_id !== handle.projectId
    || row.object_id !== handle.objectId || row.payload_hash !== handle.payloadHash
    || row.descriptor_digest !== handle.descriptorDigest
    || row.location_manifest_digest !== handle.locationManifestDigest
    || typeof row.envelope_json !== 'string') {
    throw new PayloadVaultIntegrityError('Payload Vault Database row authority binding mismatch');
  }
  let envelope: VaultObjectEnvelope;
  try {
    envelope = JSON.parse(row.envelope_json) as VaultObjectEnvelope;
  } catch (error) {
    throw new PayloadVaultIntegrityError('Payload Vault Database envelope is malformed', { cause: error });
  }
  if (canonicalWorkroomJson(envelope) !== row.envelope_json
    || row.envelope_digest !== envelope.digest) {
    throw new PayloadVaultIntegrityError('Payload Vault Database envelope row digest mismatch');
  }
  // The shared assertion binds full handle, AAD, manifest and envelope digest.
  resolveEncryptedPayloadVaultLifecycleObject(envelope, handle);
  return deepFreeze(structuredClone(envelope));
}

async function insertAudit(
  transaction: EncryptedPayloadVaultDatabaseTransaction,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  const candidate = auditRow(value);
  const rows = await transaction.select('payload_vault_audit').where({ id: candidate.id });
  if (rows.length > 0) {
    assertAuditRows(rows, candidate);
    return;
  }
  await transaction.insertMany('payload_vault_audit', [candidate]);
}

function auditRow(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const body = deepFreeze(structuredClone(value));
  const auditDigest = digest(body);
  const content = deepFreeze({ ...body, digest: auditDigest });
  const vaultObjectId = required(body.vaultObjectId, 'audit.vaultObjectId');
  const operation = required(body.operation, 'audit.operation');
  return {
    id: digest(content),
    vault_object_id: vaultObjectId,
    operation,
    audit_digest: auditDigest,
    audit_json: canonicalWorkroomJson(content),
  };
}

function assertAuditRows(
  rows: readonly Record<string, unknown>[],
  expected: Record<string, unknown>,
): void {
  if (rows.length !== 1) throw new PayloadVaultIntegrityError('Payload Vault Database audit is absent or duplicated');
  exactKeys(rows[0]!, ['id', 'vault_object_id', 'operation', 'audit_digest', 'audit_json'], 'audit');
  if (canonicalWorkroomJson(rows[0]) !== canonicalWorkroomJson(expected)) {
    throw new PayloadVaultIntegrityError('Payload Vault Database audit replay drift');
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (canonicalWorkroomJson(Object.keys(value).sort()) !== canonicalWorkroomJson([...expected].sort())) {
    throw new PayloadVaultIntegrityError(`Payload Vault Database ${label} row shape drift`);
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new PayloadVaultIntegrityError(`Payload Vault Database ${label} is invalid`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PayloadVaultIntegrityError(`Payload Vault Database ${label} must be positive`);
  }
  return value;
}

function isDatabaseCasLoser(error: unknown): boolean {
  return error instanceof Error
    && ('code' in error && ['23505', 'SQLITE_CONSTRAINT', 'ER_DUP_ENTRY'].includes(String(error.code))
      || /unique|duplicate|constraint/iu.test(error.message));
}
