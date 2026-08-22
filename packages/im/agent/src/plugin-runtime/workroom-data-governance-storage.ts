import type {
  PayloadVaultDerivedWriteInput,
  PayloadVaultObjectHandle,
  PayloadVaultReadInput,
} from '../data-governance/disclosure-manifest.js';
import type { PayloadLifecycleJournal } from '../data-governance/payload-lifecycle.js';
import {
  ActivatablePayloadLifecycleRepository,
  DatabasePayloadLifecycleRepository,
  type PayloadLifecycleDatabaseTransaction,
} from '../data-governance/database-payload-lifecycle-repository.js';
import {
  EncryptedDatabasePayloadVault,
  type EncryptedPayloadVaultDatabaseTransaction,
} from '../data-governance/encrypted-database-payload-vault.js';
import {
  EncryptedFilePayloadVault,
  type PayloadVaultCryptographyPort,
  type PayloadVaultSourceWriteInput,
} from '../data-governance/encrypted-file-payload-vault.js';
import { FilePayloadLifecycleRepository } from '../data-governance/file-payload-lifecycle-repository.js';
import { join } from 'node:path';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomDataGovernancePayloadVaultPort } from './workroom-data-governance-runtime.js';

export interface WorkroomDataGovernanceStorageActivationReceipt {
  readonly version: 1;
  readonly generation: number;
  readonly source: 'file';
  readonly target: 'database';
  readonly repositoryIdentityDigest: string;
  readonly streams: readonly Readonly<{
    projectId: string;
    objectId: string;
    eventCount: number;
    eventStreamDigest: string;
  }>[];
  readonly digest: string;
}

/**
 * Root-private generation latch. Existing File handles remain readable after
 * cutover; only new writes move to Database after exact Lifecycle replay.
 */
export class ActivatableWorkroomDataGovernanceStorage {
  readonly lifecycle = new ActivatablePayloadLifecycleRepository();
  readonly vault: WorkroomDataGovernancePayloadVaultPort;
  readonly #generation: number;
  readonly #fileVault: WorkroomDataGovernancePayloadVaultPort;
  readonly #fileLifecycle: PayloadLifecycleJournal;
  #writer?: WorkroomDataGovernancePayloadVaultPort;
  #database?: WorkroomDataGovernancePayloadVaultPort;

  constructor(options: Readonly<{
    generation: number;
    fileVault: WorkroomDataGovernancePayloadVaultPort;
    fileLifecycle: PayloadLifecycleJournal;
  }>) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error('Workroom Data Governance storage generation is invalid');
    }
    this.#generation = options.generation;
    this.#fileVault = options.fileVault;
    this.#fileLifecycle = options.fileLifecycle;
    this.vault = Object.freeze({
      putSource: async (input: PayloadVaultSourceWriteInput, signal: AbortSignal) =>
        await this.#requireWriter().putSource(input, signal),
      putDerived: async (input: PayloadVaultDerivedWriteInput, signal: AbortSignal) =>
        await this.#requireWriter().putDerived(input, signal),
      readExact: async (input: PayloadVaultReadInput, signal: AbortSignal) => {
        signal.throwIfAborted();
        if (this.#database && await this.#database.resolveLifecycleObject?.(input.handle, signal)) {
          return await this.#database.readExact(input, signal);
        }
        return await this.#fileVault.readExact(input, signal);
      },
      resolveLifecycleObject: async (handle: PayloadVaultObjectHandle, signal: AbortSignal) => {
        signal.throwIfAborted();
        const database = await this.#database?.resolveLifecycleObject?.(handle, signal);
        return database ?? await this.#fileVault.resolveLifecycleObject?.(handle, signal);
      },
    });
  }

  async activateFile(): Promise<void> {
    if (this.#writer) throw new Error('Workroom Data Governance storage is already active');
    await this.lifecycle.activate(this.#fileLifecycle, []);
    this.#writer = this.#fileVault;
  }

  async activateDatabase(input: Readonly<{
    vault: WorkroomDataGovernancePayloadVaultPort;
    lifecycle: PayloadLifecycleJournal;
    projectIds: readonly string[];
    repositoryIdentity: string;
    signal: AbortSignal;
  }>): Promise<WorkroomDataGovernanceStorageActivationReceipt> {
    input.signal.throwIfAborted();
    if (this.#writer || this.#database) {
      throw new Error('Workroom Data Governance storage is already active');
    }
    const repositoryIdentity = required(input.repositoryIdentity, 'repositoryIdentity');
    const projects = [...new Set(input.projectIds.map(id => required(id, 'projectId')))].sort();
    if (projects.length !== input.projectIds.length) {
      throw new Error('Workroom Data Governance storage Project ids contain duplicates');
    }
    const before = await lifecycleStreams(this.#fileLifecycle, projects);
    await this.lifecycle.activate(input.lifecycle, projects, this.#fileLifecycle);
    const afterSource = await lifecycleStreams(this.#fileLifecycle, projects);
    const afterTarget = await lifecycleStreams(this.lifecycle, projects);
    if (digest(before) !== digest(afterSource) || digest(before) !== digest(afterTarget)) {
      throw new Error('Workroom Data Governance Lifecycle cutover replay drift');
    }
    input.signal.throwIfAborted();
    const body = deepFreeze({
      version: 1 as const,
      generation: this.#generation,
      source: 'file' as const,
      target: 'database' as const,
      repositoryIdentityDigest: digest({ repositoryIdentity }),
      streams: before,
    });
    const receipt = deepFreeze({ ...body, digest: digest(body) });
    this.#database = input.vault;
    this.#writer = input.vault;
    return receipt;
  }

  #requireWriter(): WorkroomDataGovernancePayloadVaultPort {
    if (!this.#writer) {
      throw new Error('Workroom Data Governance storage cutover is not active');
    }
    return this.#writer;
  }
}

export interface WorkroomDataGovernanceDatabaseRoot {
  readonly models?: Readonly<{ get(name: string): unknown }>;
  transaction<T>(
    operation: (
      transaction: EncryptedPayloadVaultDatabaseTransaction & PayloadLifecycleDatabaseTransaction,
    ) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

/** Trusted composition factory. Raw adapters stay inside the returned Root latch. */
export function createGenerationOwnedWorkroomDataGovernanceStorage(options: Readonly<{
  stateRoot: string;
  generation: number;
  cryptography: PayloadVaultCryptographyPort;
}>): Readonly<{
  vault: WorkroomDataGovernancePayloadVaultPort;
  lifecycle: ActivatablePayloadLifecycleRepository;
  activateFile(): Promise<void>;
  activateDatabase(input: Readonly<{
    database: unknown;
    projectIds: readonly string[];
    repositoryIdentity: string;
    signal: AbortSignal;
  }>): Promise<WorkroomDataGovernanceStorageActivationReceipt>;
}> {
  const fileVault = new EncryptedFilePayloadVault({
    directory: join(options.stateRoot, 'workroom-payload-vault'),
    generation: options.generation,
    cryptography: options.cryptography,
  });
  const storage = new ActivatableWorkroomDataGovernanceStorage({
    generation: options.generation,
    fileVault,
    fileLifecycle: new FilePayloadLifecycleRepository(
      join(options.stateRoot, 'workroom-payload-lifecycle'),
    ),
  });
  return Object.freeze({
    vault: storage.vault,
    lifecycle: storage.lifecycle,
    activateFile: async () => await storage.activateFile(),
    activateDatabase: async input => {
      if (!isDatabaseRoot(input.database)) {
        throw new Error('Workroom Data Governance Database Root is invalid');
      }
      const database = input.database;
      const objectModel = database.models?.get('payload_vault_objects');
      const auditModel = database.models?.get('payload_vault_audit');
      const lifecycleModel = database.models?.get('payload_lifecycle_events');
      if (!objectModel || !auditModel || !lifecycleModel) {
        throw new Error('Workroom Data Governance Database models are unavailable');
      }
      return await storage.activateDatabase({
        vault: new EncryptedDatabasePayloadVault({
          database,
          objectModel: objectModel as ConstructorParameters<typeof EncryptedDatabasePayloadVault>[0]['objectModel'],
          auditModel: auditModel as ConstructorParameters<typeof EncryptedDatabasePayloadVault>[0]['auditModel'],
          generation: options.generation,
          cryptography: options.cryptography,
          repositoryIdentity: input.repositoryIdentity,
        }),
        lifecycle: new DatabasePayloadLifecycleRepository(
          database,
          lifecycleModel as ConstructorParameters<typeof DatabasePayloadLifecycleRepository>[1],
        ),
        projectIds: input.projectIds,
        repositoryIdentity: input.repositoryIdentity,
        signal: input.signal,
      });
    },
  });
}

function isDatabaseRoot(value: unknown): value is WorkroomDataGovernanceDatabaseRoot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkroomDataGovernanceDatabaseRoot>;
  return typeof candidate.transaction === 'function'
    && !!candidate.models
    && typeof candidate.models.get === 'function';
}

async function lifecycleStreams(
  journal: PayloadLifecycleJournal,
  projectIds: readonly string[],
): Promise<WorkroomDataGovernanceStorageActivationReceipt['streams']> {
  const streams: Array<WorkroomDataGovernanceStorageActivationReceipt['streams'][number]> = [];
  for (const projectId of projectIds) {
    const objectIds = await journal.listObjectIds(projectId);
    for (const objectId of objectIds) {
      const events = await journal.read(projectId, objectId);
      streams.push(deepFreeze({
        projectId,
        objectId,
        eventCount: events.length,
        eventStreamDigest: digest(events),
      }));
    }
  }
  return deepFreeze(streams.sort((left, right) =>
    compareCanonicalWorkroomText(left.projectId, right.projectId) || compareCanonicalWorkroomText(left.objectId, right.objectId)));
}

function required(value: string, field: string): string {
  if (!value || value.trim() !== value) throw new Error(`${field} must be non-empty canonical text`);
  return value;
}
