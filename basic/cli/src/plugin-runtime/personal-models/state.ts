import { createHash } from 'node:crypto';
import { normalizeModelCatalogConfig, type ModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import {
  freezePersonalSessionSelection, personalSessionIdentity, samePersonalSessionAddress, samePersonalSessionOwner,
  PersonalSessionRepositoryIntegrityError,
  type PersonalSessionIdentity, type PersonalSessionRepository, type PersonalSessionState, type PersonalSessionWriteResult,
} from '@zhin.js/agent/personal-session';
import { rootPluginId, type JsonValue, type PersistentStatePort, type StateRecord, type StateScope } from '@zhin.js/plugin-runtime';

export class PersonalModelStateUnavailableError extends Error {
  readonly code = 'personal_model_state_unavailable';
  constructor() { super('Personal model persistence is unavailable'); this.name = 'PersonalModelStateUnavailableError'; }
}
export class PersonalModelStateIntegrityError extends Error {
  readonly code = 'personal_model_state_integrity';
  constructor() { super('Personal model persistence contains invalid metadata'); this.name = 'PersonalModelStateIntegrityError'; }
}

export interface PersonalModelCatalogSnapshot {
  readonly revision: number;
  readonly value: ModelCatalogConfig;
}
export type PersonalModelCatalogWriteResult =
  | Readonly<{ kind: 'updated'; snapshot: PersonalModelCatalogSnapshot }>
  | Readonly<{ kind: 'conflict'; actualRevision: number }>;

const SCOPE: StateScope = Object.freeze({ kind: 'plugin' });
const OWNER_ID = /^personal-owner:v1:[a-f0-9]{64}$/u;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalModelStateIntegrityError();
  return value as Record<string, unknown>;
}
function validRevision(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function expectedRevision(value: number): void {
  if (!validRevision(value) || value >= Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid expected personal model revision');
}
function catalogKey(ownerId: string): string {
  if (!OWNER_ID.test(ownerId)) throw new TypeError('Personal catalog requires an authenticated owner id');
  return `personal-catalog:v1:${createHash('sha256').update(ownerId).digest('hex')}`;
}
function json(value: unknown): JsonValue {
  // Only detached, closed-schema domain snapshots enter this serializer.
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
function sessionSnapshot(value: PersonalSessionState, expected: PersonalSessionIdentity): PersonalSessionState {
  try {
    const identity = personalSessionIdentity(value.identity.address);
    if (value.identity.key !== identity.key || value.identity.sceneKey !== identity.sceneKey
      || !samePersonalSessionOwner(value.identity.owner, identity.owner)
      || !samePersonalSessionAddress(identity.address, expected.address) || identity.key !== expected.key
      || identity.sceneKey !== expected.sceneKey || !samePersonalSessionOwner(identity.owner, expected.owner)
      || !validRevision(value.revision, 1)) throw new PersonalSessionRepositoryIntegrityError();
    return Object.freeze({ identity, revision: value.revision, selection: freezePersonalSessionSelection(value.selection) });
  } catch { throw new PersonalSessionRepositoryIntegrityError(); }
}
function readSession(record: StateRecord | undefined, identity: PersonalSessionIdentity): PersonalSessionState | undefined {
  if (!record) return undefined;
  try {
    const value = object(record.value);
    if (record.expiresAt !== null || value.version !== 1 || value.kind !== 'personal-session') {
      throw new PersonalSessionRepositoryIntegrityError();
    }
    return sessionSnapshot(value.state as unknown as PersonalSessionState, identity);
  } catch { throw new PersonalSessionRepositoryIntegrityError(); }
}
function normalizeCatalog(ownerId: string, value: unknown): ModelCatalogConfig {
  const catalog = normalizeModelCatalogConfig(value);
  if (Object.values(catalog.connections).some(connection => connection.ownerId !== ownerId)) {
    throw new PersonalModelStateIntegrityError();
  }
  return catalog;
}
function readCatalog(record: StateRecord | undefined, ownerId: string): PersonalModelCatalogSnapshot | undefined {
  if (!record) return undefined;
  try {
    const value = object(record.value);
    if (record.expiresAt !== null || value.version !== 1 || value.kind !== 'personal-catalog'
      || value.ownerId !== ownerId || !validRevision(value.revision, 1)) throw new PersonalModelStateIntegrityError();
    return Object.freeze({ revision: value.revision, value: normalizeCatalog(ownerId, value.catalog) });
  } catch { throw new PersonalModelStateIntegrityError(); }
}

/** Existing persistent-state CAS, with no memory fallback, expiry or implicit write retry. */
export class PersonalModelStateStore implements PersonalSessionRepository {
  constructor(private readonly state: () => PersistentStatePort | undefined) {}

  private port(): PersistentStatePort {
    const port = this.state();
    if (!port) throw new PersonalModelStateUnavailableError();
    return port;
  }

  async read(identity: PersonalSessionIdentity): Promise<PersonalSessionState | undefined> {
    const port = this.port();
    return readSession(await port.read(rootPluginId(), SCOPE, identity.key), identity);
  }

  async compareAndSet(revision: number, value: PersonalSessionState): Promise<PersonalSessionWriteResult> {
    expectedRevision(revision);
    const next = sessionSnapshot(value, value.identity);
    if (next.revision !== revision + 1) throw new PersonalSessionRepositoryIntegrityError();
    const port = this.port();
    const record = await port.read(rootPluginId(), SCOPE, next.identity.key);
    const current = readSession(record, next.identity);
    if ((current?.revision ?? 0) !== revision) return Object.freeze({ kind: 'conflict', actualRevision: current?.revision ?? 0 });
    const written = await port.compareExchange(rootPluginId(), SCOPE, next.identity.key, record?.revision,
      json({ version: 1, kind: 'personal-session', state: next }), null);
    if (!written) {
      const actual = readSession(await port.read(rootPluginId(), SCOPE, next.identity.key), next.identity);
      return Object.freeze({ kind: 'conflict', actualRevision: actual?.revision ?? 0 });
    }
    return Object.freeze({ kind: 'updated', state: next });
  }

  async loadCatalog(ownerId: string): Promise<PersonalModelCatalogSnapshot | undefined> {
    const key = catalogKey(ownerId);
    const port = this.port();
    return readCatalog(await port.read(rootPluginId(), SCOPE, key), ownerId);
  }

  async compareExchangeCatalog(ownerId: string, revision: number, value: ModelCatalogConfig): Promise<PersonalModelCatalogWriteResult> {
    expectedRevision(revision);
    const key = catalogKey(ownerId);
    const next = Object.freeze({ revision: revision + 1, value: normalizeCatalog(ownerId, value) });
    const port = this.port();
    const record = await port.read(rootPluginId(), SCOPE, key);
    const current = readCatalog(record, ownerId);
    if ((current?.revision ?? 0) !== revision) return Object.freeze({ kind: 'conflict', actualRevision: current?.revision ?? 0 });
    const written = await port.compareExchange(rootPluginId(), SCOPE, key, record?.revision,
      json({ version: 1, kind: 'personal-catalog', ownerId, revision: next.revision, catalog: next.value }), null);
    if (!written) {
      const actual = readCatalog(await port.read(rootPluginId(), SCOPE, key), ownerId);
      return Object.freeze({ kind: 'conflict', actualRevision: actual?.revision ?? 0 });
    }
    return Object.freeze({ kind: 'updated', snapshot: next });
  }
}
