import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { getLogger } from '@zhin.js/logger';
import { compileLegacySessionSelection } from '@zhin.js/agent/migration';
import { personalSessionIdentity, personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import {
  normalizeProviderJson,
  providerPlanFingerprint,
  type JsonObject,
  type ProfileSelection,
  type ProviderMutationReceipt,
} from '@zhin.js/ai/provider';
import { type JsonValue } from '@zhin.js/plugin-runtime';
import { normalizeDatabaseHostConfig } from '../database-config.js';
import { assertStopped, withProjectLock } from '../migrate/instance-declarations.js';
import {
  createHostDocumentCipher,
  privateDirectory,
  readPrivateDocument,
  syncPrivateDirectory,
} from '../host-credential-storage.js';
import { openHeadlessInferenceHost } from './headless-host.js';
import {
  verifyInferenceMigrationPreview,
  type InferenceMigrationPreview,
} from './migration-preview.js';
import type { LegacyInferenceSources } from './migration-source.js';
import { writePrivateMigrationRecord } from './migration-record.js';
import {
  applyMigrationSessionJournal,
  type MigrationSessionJournal,
} from './migration-session-journal.js';
import { InferenceApplyRejectedError, type PreparedInferenceChange } from './management.js';

interface MigrationUnitJournal {
  readonly id: string;
  readonly ownerId: string;
  readonly mutationId: string;
  readonly prepared: PreparedInferenceChange;
  receipt?: ProviderMutationReceipt;
}
interface MigrationJournal {
  readonly version: 1;
  readonly previewId: string;
  readonly fingerprint: string;
  readonly rootId: string;
  readonly sourceFile: string;
  readonly backupFile: string;
  readonly database: JsonObject;
  readonly units: MigrationUnitJournal[];
  readonly sessions: MigrationSessionJournal[];
  retiredFields?: readonly string[];
  phase:
    | 'prepared'
    | 'graph-unknown'
    | 'graphs-committed'
    | 'sessions-unknown'
    | 'conflict'
    | 'committed'
    | 'finalizing'
    | 'finalized';
}
export interface ApplyInferenceMigrationOptions {
  readonly preview: InferenceMigrationPreview;
  /** Explicit operator statements; these are preconditions, not proof of a complete backup. */
  readonly maintenance: boolean;
  readonly backupConfirmed: boolean;
  readonly withCredentials: boolean;
  /** Fault injection only, never supplied by CLI data. */
  readonly beforeFinalize?: () => void | Promise<void>;
}
export interface InferenceMigrationRunView {
  readonly id: string;
  readonly phase: MigrationJournal['phase'];
  readonly graphMutations: number;
  readonly migratedSessions: number;
  readonly backupFile: string;
}
function object(value: unknown): JsonObject {
  const parsed = normalizeProviderJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid migration record');
  return parsed as JsonObject;
}
function paths(root: string, id: string) {
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error('Invalid migration id');
  const directory = join(root, '.zhin', 'inference-migrations', id);
  return {
    directory,
    journal: join(directory, 'journal.json'),
    backup: join(directory, 'root-config.backup'),
  };
}
async function writeJournal(journal: MigrationJournal): Promise<void> {
  const { directory } = paths(journal.rootId, journal.previewId);
  await writePrivateMigrationRecord({
    directory,
    filename: 'journal.json',
    document: journal,
  });
}
async function readJournal(
  preview: InferenceMigrationPreview
): Promise<MigrationJournal | undefined> {
  const file = paths(preview.rootId, preview.id).journal;
  let value: unknown;
  try {
    value = await readPrivateDocument(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  const journal = object(value);
  if (
    journal.version !== 1 ||
    journal.rootId !== preview.rootId ||
    journal.previewId !== preview.id ||
    journal.fingerprint !== preview.fingerprint ||
    !Array.isArray(journal.units) ||
    !Array.isArray(journal.sessions)
  )
    throw new Error('Migration journal does not match the reviewed preview');
  return structuredClone(journal) as unknown as MigrationJournal;
}
function keyAtPath(config: JsonObject, path: string): string {
  const candidates: string[] = [];
  function visit(value: JsonValue, prefix: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (next === path && typeof child === 'string') candidates.push(child);
      else visit(child, next);
    }
  }
  visit(config, '');
  if (candidates.length !== 1 || !candidates[0].trim())
    throw new Error('Legacy credential locator is missing or ambiguous');
  return candidates[0];
}
async function keysForUnit(
  input: Readonly<{
    unit: InferenceMigrationPreview['units'][number];
    source: LegacyInferenceSources;
    authorized: boolean;
  }>
): Promise<ReadonlyMap<string, string>> {
  const keys = new Map<string, string>();
  const references = input.unit.migration.credentials.filter(
    (value) => value.source.kind !== 'environment'
  );
  if (references.length && !input.authorized)
    throw new Error(
      'Credential transfer requires --with-credentials; alternatively import a new plan and enter keys through the authenticated Console'
    );
  const config =
    input.unit.id === 'deployment'
      ? object(input.source.document.ai)
      : {
          modelCatalog: object(
            input.source.stateRows.find(
              (row) =>
                row.value.kind === 'personal-catalog' && row.value.ownerId === input.unit.ownerId
            )?.value.catalog
          ),
        };
  const oldDirectory = join(input.source.rootId, '.zhin', 'personal-model-credentials'),
    cipher = createHostDocumentCipher(oldDirectory);
  for (const reference of references) {
    let key: string;
    if (reference.source.kind === 'legacy-config') key = keyAtPath(config, reference.source.path);
    else if (reference.source.kind === 'legacy-vault') {
      const ref = reference.source.reference;
      if (!/^personal-model-secret:v1:[a-f0-9]{48}$/u.test(ref))
        throw new Error('Invalid old vault reference');
      const document = await readPrivateDocument(
        join(oldDirectory, `${createHash('sha256').update(ref).digest('hex')}.json`)
      );
      key = await cipher.open(
        document,
        Buffer.from(JSON.stringify(['personal-model-credential', 1, input.unit.ownerId, ref]))
      );
    } else continue;
    keys.set(reference.accountAlias, key);
  }
  return keys;
}
function summary(journal: MigrationJournal): InferenceMigrationRunView {
  return {
    id: journal.previewId,
    phase: journal.phase,
    graphMutations: journal.units.filter((unit) => unit.receipt).length,
    migratedSessions: journal.sessions.filter((session) => session.status === 'committed').length,
    backupFile: journal.backupFile,
  };
}
/** Explicit offline writer: no project plugin, adapter, schedule, environment file or supplier is started. */
export async function applyInferenceMigration(
  options: ApplyInferenceMigrationOptions
): Promise<InferenceMigrationRunView> {
  const { preview } = options;
  if (!options.maintenance || !options.backupConfirmed)
    throw new Error(
      'Confirm maintenance and an operator backup of configuration, database and original keys'
    );
  if (preview.blocked.length || preview.units.some((unit) => unit.migration.blocked.length))
    throw new Error(
      'Resolve every migration mapping before applying; no unresolved reference is replaced with inherit'
    );
  await assertStopped(preview.rootId);
  return withProjectLock(preview.rootId, async () => {
    const location = paths(preview.rootId, preview.id),
      cipher = createHostDocumentCipher(join(preview.rootId, '.zhin', 'inference'));
    let journal = await readJournal(preview),
      source: LegacyInferenceSources | undefined;
    if (!journal) {
      source = await verifyInferenceMigrationPreview(preview);
      await privateDirectory(location.directory, true);
      const backup = await open(location.backup, 'wx', 0o600);
      try {
        await backup.writeFile(source.source);
        await backup.sync();
      } finally {
        await backup.close();
      }
      const database = await cipher.seal(
        JSON.stringify(source.database),
        Buffer.from(JSON.stringify(['inference-migration-database', preview.rootId, preview.id]))
      );
      journal = {
        version: 1,
        previewId: preview.id,
        fingerprint: preview.fingerprint,
        rootId: preview.rootId,
        sourceFile: source.configFile,
        backupFile: location.backup,
        database: { ...database },
        units: [],
        sessions: [],
        phase: 'prepared',
      };
      await writeJournal(journal);
    }
    if (journal.phase === 'finalized' || journal.phase === 'finalizing') return summary(journal);
    const database = object(
      JSON.parse(
        await cipher.open(
          journal.database,
          Buffer.from(JSON.stringify(['inference-migration-database', preview.rootId, preview.id]))
        )
      )
    );
    if (Object.values(database).some((value) => typeof value === 'string' && value.includes('${')))
      throw new Error('Provide explicit non-.env database configuration for offline migration');
    if (typeof database.dialect !== 'string') throw new Error('Invalid migration database');
    const opened = await openHeadlessInferenceHost({
      projectRoot: preview.rootId,
      database: normalizeDatabaseHostConfig({
        ...database,
        dialect: database.dialect,
      }),
      resolveSource: () => {
        throw new Error('Migration never resolves environment credentials');
      },
    });
    const { host, database: db } = opened;
    try {
      for (const unit of preview.units) {
        let operation = journal.units.find((value) => value.id === unit.id);
        if (operation) {
          const receipt = await host.repository.readMutation({
            rootId: host.rootId,
            mutationId: operation.mutationId,
          });
          if (receipt) {
            if (
              receipt.fingerprint !== operation.prepared.fingerprint ||
              object(receipt.result).ownerId !== unit.ownerId
            )
              throw new Error('Migration receipt identity conflict');
            operation.receipt = receipt;
            await writeJournal(journal);
            continue;
          }
          if (journal.phase === 'graph-unknown') return summary(journal);
        }
        source = await verifyInferenceMigrationPreview(preview);
        const lease = host.acquireManagement(),
          principal = {
            ownerId: unit.ownerId,
            hostAdministrator: unit.ownerId === host.hostOwnerId,
          };
        try {
          if (!operation) {
            const prepared = await lease.management.reviewImportedKeys(
              principal,
              { plan: unit.migration.plan },
              await keysForUnit({
                unit,
                source,
                authorized: options.withCredentials,
              })
            );
            operation = {
              id: unit.id,
              ownerId: unit.ownerId,
              mutationId: randomUUID(),
              prepared,
            };
            journal.units.push(operation);
            await writeJournal(journal);
          }
          await verifyInferenceMigrationPreview(preview);
          journal.phase = 'graph-unknown';
          await writeJournal(journal);
          let result;
          try {
            result = await lease.management.apply(principal, {
              prepared: operation.prepared.prepared,
              mutationId: operation.mutationId,
            });
          } catch (error) {
            if (error instanceof InferenceApplyRejectedError) {
              journal.phase = 'prepared';
              await writeJournal(journal);
            }
            throw error;
          }
          if (result.status === 'commit-unknown') {
            journal.phase = 'graph-unknown';
            await writeJournal(journal);
            return summary(journal);
          }
          if (result.status !== 'committed') {
            journal.phase = 'prepared';
            await writeJournal(journal);
            throw new Error(`Migration graph was not committed: ${result.status}`);
          }
          journal.phase = 'prepared';
          operation.receipt = result.receipt;
          await writeJournal(journal);
        } finally {
          await lease.release();
        }
      }
      journal.phase = 'graphs-committed';
      await writeJournal(journal);
      // State units are separately journaled CAS writes; never presented as part of the graph SQL transaction.
      if (!journal.sessions.length && preview.sessions.length) {
        source ??= await verifyInferenceMigrationPreview(preview);
        const graph = await host.repository.readGraph({ rootId: host.rootId });
        if (!graph) throw new Error('Committed migration graph is unavailable');
        for (const session of preview.sessions) {
          const identity = personalSessionIdentity(
            object(session.identity).address as unknown as Parameters<
              typeof personalSessionIdentity
            >[0]
          );
          if (identity.key !== session.identity.key || identity.address.rootId !== host.rootId)
            throw new Error('Legacy Session identity is invalid');
          const ownerId = personalSessionOwnerId(identity.owner),
            mappings: Record<string, ProfileSelection<'language'>> = {};
          if (session.selection.kind === 'preset') {
            const target = session.target;
            const unit = preview.units.find(
              (unit) =>
                unit.id === target?.unitId &&
                (unit.ownerId === ownerId || unit.ownerId === host.hostOwnerId)
            );
            const operation = unit && journal.units.find((value) => value.id === unit.id);
            if (
              !unit ||
              !operation?.receipt ||
              !target ||
              typeof session.selection.presetId !== 'string'
            )
              throw new Error('Session target was not reviewed');
            const profiles = object(object(object(operation.receipt.result).bindings).profiles),
              profileId = profiles[target.profileAlias];
            const profile = typeof profileId === 'string' ? graph.profiles[profileId] : undefined,
              account = profile && graph.accounts[profile.accountId];
            if (
              !profile ||
              !account ||
              !graph.services[account.serviceId].models[profile.model].kinds.includes('language')
            )
              throw new Error('Session target Profile is unavailable');
            mappings[session.selection.presetId] = {
              id: profile.id,
              rootId: graph.rootId,
              accountId: account.id,
              accountIncarnation: account.incarnation,
              kind: 'language',
            };
          }
          const selection = compileLegacySessionSelection({
            selection: session.selection,
            mappings,
          });
          const row = source.stateRows.find((row) => row.id === session.sourceId);
          if (!row || row.revision !== session.sourceRevision)
            throw new Error('Legacy Session source changed');
          const oldState = object(row.value.state);
          journal.sessions.push({
            sourceId: row.id,
            key: identity.key,
            sourceRevision: row.revision,
            before: row.value,
            after: object({
              version: 2,
              kind: 'personal-session',
              state: {
                identity,
                revision: Number(oldState.revision) + 1,
                selection,
              },
            }),
            status: 'prepared',
          });
        }
        await writeJournal(journal);
      }
      const state = db.state;
      if (!state) throw new Error('Migration Session state is unavailable');
      const settled = await applyMigrationSessionJournal({
        state,
        sessions: journal.sessions,
        checkpoint: () => writeJournal(journal!),
      });
      if (settled !== 'committed') {
        journal.phase = settled === 'unknown' ? 'sessions-unknown' : 'conflict';
        await writeJournal(journal);
        return summary(journal);
      }
      journal.phase = 'committed';
      await writeJournal(journal);
      return summary(journal);
    } finally {
      try {
        await opened.close();
      } catch {
        try {
          getLogger('inference-migration').warn(
            'Migration resource cleanup failed; committed results remain unchanged'
          );
        } catch {
          /* Diagnostic only. */
        }
      }
    }
  });
}

/** Explicit file cutover only after every data unit is proved. No process restart or external call. */
export async function finalizeInferenceMigration(
  options: ApplyInferenceMigrationOptions
): Promise<InferenceMigrationRunView> {
  const { preview } = options;
  if (!options.maintenance || !options.backupConfirmed)
    throw new Error('Confirm maintenance and the operator backup before file cutover');
  await assertStopped(preview.rootId);
  return withProjectLock(preview.rootId, async () => {
    const journal = await readJournal(preview);
    if (!journal || !['committed', 'finalizing', 'finalized'].includes(journal.phase))
      throw new Error(
        'Every database and Session mutation must be confirmed before startup-file cutover'
      );
    if (journal.phase === 'finalized') return summary(journal);
    const original = await readFile(journal.backupFile, 'utf8');
    const ast = parseDocument(original, { uniqueKeys: true });
    if (ast.errors.length) throw new Error('The preserved startup file is damaged');
    const remove = (path: readonly string[]) => {
      if (ast.hasIn(path)) ast.deleteIn(path);
    };
    for (const key of [
      'providers',
      'modelCatalog',
      'modelPolicy',
      'defaultProvider',
      'decisions',
      'imageGeneration',
    ])
      remove(['ai', key]);
    const document = object(ast.toJS({ maxAliasCount: 100 })),
      ai = object(document.ai ?? {});
    for (const name of Object.keys(object(ai.agents ?? {})))
      for (const key of ['provider', 'model', 'preset']) remove(['ai', 'agents', name, key]);
    remove(['ai', 'trigger', 'ambient', 'judge']);
    remove(['ai', 'agent', 'providerResilience', 'fallback']);
    journal.retiredFields = preview.retiredFields;
    for (const key of ['provider', 'model', 'fallbacks'])
      remove(['ai', 'multimodal', 'perception', key]);
    const contracts: Record<string, JsonObject> = {};
    const harnessServices: Record<string, JsonObject> = Object.fromEntries(
      Object.entries(object(object(object(ai.agent ?? {}).modelHarness ?? {}).services ?? {})).map(
        ([id, value]) => [id, object(value)]
      )
    );
    for (const unit of preview.units) {
      const committed = journal.units.find((value) => value.id === unit.id)?.receipt;
      if (!committed) throw new Error('A migration receipt is missing');
      const services = object(object(committed.result).bindings).services;
      for (const mapping of unit.migration.workroomServiceMappings) {
        const target = object(services)[mapping.serviceAlias];
        if (typeof target !== 'string') throw new Error('Workroom service mapping is incomplete');
        contracts[target] = mapping.contract;
      }
      for (const mapping of unit.migration.harnessServiceMappings) {
        const target = object(services)[mapping.serviceAlias];
        if (typeof target !== 'string') throw new Error('Harness service mapping is incomplete');
        const current = object(harnessServices[target] ?? {});
        if (mapping.model)
          harnessServices[target] = {
            ...current,
            models: {
              ...object(current.models ?? {}),
              [mapping.model]: mapping.settings,
            },
          };
        else harnessServices[target] = { ...current, defaults: mapping.settings };
      }
    }
    if (Object.keys(harnessServices).length)
      ast.setIn(['ai', 'agent', 'modelHarness', 'services'], harnessServices);
    remove(['ai', 'agent', 'modelHarness', 'providerPatterns']);
    remove(['ai', 'agent', 'modelHarness', 'models']);
    if (Object.keys(contracts).length)
      ast.setIn(['ai', 'workroom', 'disclosure', 'modelServices'], contracts);
    remove(['ai', 'workroom', 'disclosure', 'modelProviders']);
    const candidate = journal.sourceFile.endsWith('.json')
      ? `${JSON.stringify(ast.toJS({ maxAliasCount: 100 }), null, 2)}\n`
      : ast.toString();
    const current = await readFile(journal.sourceFile, 'utf8');
    if (current === candidate) {
      journal.phase = 'finalized';
      await writeJournal(journal);
      return summary(journal);
    }
    if (current !== original)
      throw new Error(
        'Startup configuration changed; preserve it and review the migration cutover manually'
      );
    journal.phase = 'finalizing';
    await writeJournal(journal);
    await options.beforeFinalize?.();
    const temporary = `${journal.sourceFile}.${randomUUID()}.migration.tmp`,
      handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(candidate);
      await handle.sync();
      await handle.close();
      if ((await readFile(journal.sourceFile, 'utf8')) !== original)
        throw new Error('Startup configuration changed before replacement');
      await rename(temporary, journal.sourceFile);
      await syncPrivateDirectory(resolve(journal.sourceFile, '..'));
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    journal.phase = 'finalized';
    await writeJournal(journal);
    return summary(journal);
  });
}
