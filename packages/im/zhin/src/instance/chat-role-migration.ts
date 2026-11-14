/**
 * ADR 0056 §3: one-time migration of configured people lists into `chat_roles`, keeping the old
 * semantics:
 *
 * - An adapter block's `master` applied to every account that had no `master` of its own (an
 *   account's own `master` replaced it): it becomes an account-level `owner` on each such account —
 *   never an adapter-level owner, which would also cover accounts with their own master.
 *   `endpoints[i].master` → account-level `owner`.
 * - `trusted` lists were merged (adapter ∪ account): adapter block `trusted` → adapter-level
 *   `trusted`, `endpoints[i].trusted` → account-level `trusted`.
 * - `ai.trigger.masters` / `ai.trigger.trusted` → global `owner` / `trusted`, one identity per
 *   configured adapter (those lists named user ids without a platform) — except adapters whose
 *   capability profile marks them as a local simulation (`runtime.sandbox`), where a client picks
 *   its own sender id; those are skipped and logged when the grants are written.
 *
 * The first start records the grants in `.zhin/chat-roles-migration.json` (status `pending`),
 * removes the fields from the configuration file and logs what moved; once the project database
 * is loaded the grants are written to `chat_roles` and the record turns `done`. A crash in between
 * replays the pending record on the next start. Without a relational database the grants only take
 * effect in memory (grants and revocations are refused there, so nothing revoked comes back) and
 * the record stays `pending` — marked `memoryOnly` — until a relational database is configured.
 *
 * ADR 0060 §4.2 (replaces the startup failure of ADR 0056): configuration that names these fields
 * again after the import is never granted automatically — the next editor of the file is not
 * necessarily an owner. The fields become candidates in the record (`pendingImports`, recorded
 * before they are removed from the file, since adapter schemas reject them) and wait for a global
 * `iam.manage` Console user to import or ignore each ({@link ChatRoleImportBook}). A stored role is
 * only ever raised by an import, never lowered or removed (ADR 0060 §4.3).
 * The interim `features.selfService.platformAdmins | roles | allowUsers` switches and the removed
 * `roles` (mapping rule) blocks of adapters / accounts always stop startup.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  higherChatRole, isChatIdentity, normalizeChatRoleScope, type ChatIdentity, type ChatRole,
} from '@zhin.js/core';
import { adapterFeatureId, isAdapterIndex, resolveStaticCapabilities } from '@zhin.js/adapter';
import {
  readPluginConfigurationMap, type CapabilityId, type ConfigDocumentPort, type FeatureConfigLevel, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { ChatRoleStorageUnavailableError, type InstanceChatRoleService } from './chat-roles.js';
import { ChatPeople } from './chat-people.js';

export const CHAT_ROLE_UPGRADE_GUIDE = 'docs/migrations/chat-roles.md';
export const CHAT_ROLE_MIGRATION_FILE = join('.zhin', 'chat-roles-migration.json');

export interface LegacyChatRoleGrant {
  readonly level: Exclude<FeatureConfigLevel, 'conversation'>;
  readonly key: string;
  readonly adapter: string;
  readonly userId: string;
  readonly role: Extract<ChatRole, 'owner' | 'trusted'>;
  /** Configuration path it came from, e.g. `qq.endpoints[0].master`. */
  readonly source: string;
}

export interface LegacyChatRoleConfig {
  readonly grants: readonly LegacyChatRoleGrant[];
  /** Configuration paths to remove. */
  readonly paths: readonly (readonly string[])[];
  /** Fields that have no migration and stop startup. */
  readonly unsupported: readonly string[];
  /** Values that could not be migrated (logged). */
  readonly skipped: readonly string[];
}

export class LegacyChatRoleConfigError extends Error {
  readonly code = 'LEGACY_CHAT_ROLE_CONFIG';
  constructor(readonly fields: readonly string[]) {
    super(`Configuration still names removed chat role fields: ${fields.join(', ')}. `
      + `People lists live in the project database now (chat_roles; Console or the in-chat \`role\` command), `
      + `and platform standing is never mapped into zhin roles (roles.mappings was removed; use platform:* / bot:* permits). `
      + `See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
    this.name = 'LegacyChatRoleConfigError';
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/u).map(item => item.trim()).filter(Boolean);
  if (typeof value === 'number') return [String(value)];
  return [];
}

/** Legacy fields of a configuration document (expanded values; paths are the same in the raw file). */
export function readLegacyChatRoleConfig(document: Readonly<Record<string, unknown>>): LegacyChatRoleConfig {
  const grants: LegacyChatRoleGrant[] = [];
  const paths: string[][] = [];
  const skipped: string[] = [];
  const unsupported: string[] = [];
  let plugins: Readonly<Record<string, unknown>>;
  try { plugins = readPluginConfigurationMap(document); } catch { plugins = {}; }
  const adapters: string[] = [];
  const add = (level: LegacyChatRoleGrant['level'], key: string, adapter: string, role: LegacyChatRoleGrant['role'], value: unknown, source: string) => {
    for (const userId of ids(value)) {
      if (!isChatIdentity({ adapter, userId })) { skipped.push(`${source}: ${userId}`); continue; }
      try { normalizeChatRoleScope(level, key); } catch { skipped.push(`${source}: invalid scope ${key}`); continue; }
      grants.push(Object.freeze({ level, key, adapter, userId, role, source }));
    }
  };
  for (const [alias, block] of Object.entries(plugins)) {
    // Only adapter blocks (with an account list) carried people lists; other plugins' fields stay.
    if (!record(block) || !Array.isArray(block.endpoints)) continue;
    adapters.push(alias);
    // ADR 0056 §4 (revised 2026-11-12): platform → zhin role mapping rules were removed, no compatibility.
    if (block.roles !== undefined) unsupported.push(`${alias}.roles`);
    if (block.trusted !== undefined) {
      add('adapter', alias, alias, 'trusted', block.trusted, `${alias}.trusted`);
      paths.push([alias, 'trusted']);
    }
    if (block.master !== undefined) {
      // The adapter master applied only to accounts without their own master (leaf ?? base).
      let applied = 0;
      block.endpoints.forEach((entry, index) => {
        if (!record(entry) || entry.master !== undefined) return;
        const endpointId = entry.id !== undefined && String(entry.id).trim() ? String(entry.id) : entry.name !== undefined ? String(entry.name) : undefined;
        if (!endpointId) { skipped.push(`${alias}.master for ${alias}.endpoints[${index}]: account without id`); return; }
        add('endpoint', `${alias}/${endpointId}`, alias, 'owner', block.master, `${alias}.master`);
        applied += 1;
      });
      if (!applied && ids(block.master).length) skipped.push(`${alias}.master: every account has its own master (or none is configured)`);
      paths.push([alias, 'master']);
    }
    block.endpoints.forEach((entry, index) => {
      if (!record(entry)) return;
      if (entry.roles !== undefined) unsupported.push(`${alias}.endpoints[${index}].roles`);
      const endpointId = entry.id !== undefined && String(entry.id).trim() ? String(entry.id) : entry.name !== undefined ? String(entry.name) : undefined;
      for (const [field, role] of [['master', 'owner'], ['trusted', 'trusted']] as const) {
        if (entry[field] === undefined) continue;
        if (endpointId) add('endpoint', `${alias}/${endpointId}`, alias, role, entry[field], `${alias}.endpoints[${index}].${field}`);
        else skipped.push(`${alias}.endpoints[${index}].${field}: account without id`);
        paths.push([alias, 'endpoints', String(index), field]);
      }
    });
  }
  const ai = record(document.ai) ? document.ai : undefined;
  const trigger = ai && record(ai.trigger) ? ai.trigger : undefined;
  for (const [field, role] of [['masters', 'owner'], ['trusted', 'trusted']] as const) {
    if (!trigger || trigger[field] === undefined) continue;
    if (!adapters.length && ids(trigger[field]).length) skipped.push(`ai.trigger.${field}: no adapter configured to bind the ids to`);
    for (const alias of adapters) add('global', '', alias, role, trigger[field], `ai.trigger.${field}`);
    paths.push(['ai', 'trigger', field]);
  }
  const features = record(document.features) ? document.features : undefined;
  const selfService = features && record(features.selfService) ? features.selfService : undefined;
  for (const field of ['platformAdmins', 'roles', 'allowUsers']) {
    if (selfService && selfService[field] !== undefined) unsupported.push(`features.selfService.${field}`);
  }
  return Object.freeze({ grants: Object.freeze(dedupe(grants)), paths: Object.freeze(paths), unsupported: Object.freeze(unsupported), skipped: Object.freeze(skipped) });
}

/** One role per identity and scope; the higher role wins. */
function dedupe(grants: readonly LegacyChatRoleGrant[]): LegacyChatRoleGrant[] {
  const byScope = new Map<string, LegacyChatRoleGrant>();
  for (const grant of grants) {
    const id = JSON.stringify([grant.level, grant.key, grant.adapter, grant.userId]);
    const current = byScope.get(id);
    if (!current || higherChatRole(current.role, grant.role) !== current.role) byScope.set(id, grant);
  }
  return [...byScope.values()];
}

/** Outcome of importing one configured grant. */
export type ChatRoleImportResult = 'written' | 'upgraded' | 'kept' | 'memory' | 'skipped';

/** One grant of the first import (ADR 0060 §4.1), as the `chat-roles.imported` item lists it. */
export interface ChatRoleImportedGrant extends LegacyChatRoleGrant {
  /** {@link chatRoleImportId}. */
  readonly id: string;
  readonly result: ChatRoleImportResult;
  /** `skipped` only: a local simulation adapter, or an adapter that was not loaded. */
  readonly reason?: 'simulated' | 'unknown-adapter';
  readonly at: number;
}

/** A configured grant that re-appeared after the first import (ADR 0060 §4.2): waits for a Console decision. */
export interface ChatRolePendingImport extends LegacyChatRoleGrant {
  readonly id: string;
  /** When the configuration named it (first time). */
  readonly seenAt: number;
}

/**
 * `.zhin/chat-roles-migration.json`. Version 2 (ADR 0060) adds the first import's outcome and the
 * re-appeared candidates; a version 1 file is read as before and kept as `.v1.json` the first time
 * version 2 is written (downgrade: restore that copy, `docs/migrations/chat-roles.md`).
 */
interface MigrationRecord {
  readonly version: 2;
  readonly status: 'pending' | 'done';
  readonly grants: readonly LegacyChatRoleGrant[];
  readonly startedAt: number;
  readonly completedAt?: number;
  /** Last start that could only apply the grants in memory (no relational database). */
  readonly memoryOnlyAt?: number;
  readonly imported?: readonly ChatRoleImportedGrant[];
  /** A Console user marked the first import as read (`chat-roles.imported` disappears). */
  readonly importedAcknowledgedAt?: number;
  readonly pendingImports?: readonly ChatRolePendingImport[];
}

/** Version 1 copy kept for a downgrade (ADR 0060 §4.5). */
export const CHAT_ROLE_MIGRATION_V1_BACKUP = join('.zhin', 'chat-roles-migration.v1.json');

/** Idempotency key of a configured grant: `(source path, alias, user id, level, scope key)` (ADR 0060 §4.3). */
export function chatRoleImportId(grant: Pick<LegacyChatRoleGrant, 'source' | 'adapter' | 'userId' | 'level' | 'key'>): string {
  return createHash('sha256').update(JSON.stringify([grant.source, grant.adapter, grant.userId, grant.level, grant.key])).digest('hex').slice(0, 24);
}

const isGrant = (grant: unknown): grant is LegacyChatRoleGrant => record(grant)
  && (grant.level === 'global' || grant.level === 'adapter' || grant.level === 'endpoint')
  && typeof grant.key === 'string' && typeof grant.source === 'string' && isChatIdentity(grant)
  && (grant.role === 'owner' || grant.role === 'trusted');

const grantOf = (grant: LegacyChatRoleGrant): LegacyChatRoleGrant => Object.freeze({
  level: grant.level, key: grant.key, adapter: grant.adapter, userId: grant.userId, role: grant.role, source: grant.source,
});

const RESULTS: readonly string[] = ['written', 'upgraded', 'kept', 'memory', 'skipped'];

interface ReadRecord {
  readonly value: MigrationRecord;
  /** The raw text of a version 1 file (kept as `.v1.json` on the first version 2 write). */
  readonly v1Text?: string;
}

async function readRecord(file: string): Promise<ReadRecord | undefined> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return undefined; }
  const value = JSON.parse(text) as Partial<Omit<MigrationRecord, 'version'>> & { version?: unknown };
  if ((value.version !== 1 && value.version !== 2) || (value.status !== 'pending' && value.status !== 'done') || !Array.isArray(value.grants)) {
    throw new Error(`${file} is malformed; restore it or delete it after checking chat_roles (${CHAT_ROLE_UPGRADE_GUIDE})`);
  }
  const grants = value.grants.filter(isGrant).map(grantOf);
  const imported = Array.isArray(value.imported) ? value.imported.filter((entry): entry is ChatRoleImportedGrant => isGrant(entry)
    && typeof (entry as ChatRoleImportedGrant).id === 'string' && RESULTS.includes(String((entry as ChatRoleImportedGrant).result)))
    .map(entry => Object.freeze({ ...grantOf(entry), id: entry.id, result: entry.result,
      ...(entry.reason === 'simulated' || entry.reason === 'unknown-adapter' ? { reason: entry.reason } : {}), at: Number(entry.at) || 0 })) : undefined;
  const pendingImports = Array.isArray(value.pendingImports) ? value.pendingImports
    .filter((entry): entry is ChatRolePendingImport => isGrant(entry) && typeof (entry as ChatRolePendingImport).id === 'string')
    .map(entry => Object.freeze({ ...grantOf(entry), id: entry.id, seenAt: Number(entry.seenAt) || 0 })) : undefined;
  return {
    value: { version: 2, status: value.status, grants, startedAt: Number(value.startedAt) || 0,
      ...(value.completedAt ? { completedAt: Number(value.completedAt) } : {}),
      ...(value.memoryOnlyAt ? { memoryOnlyAt: Number(value.memoryOnlyAt) } : {}),
      ...(imported ? { imported } : {}),
      ...(value.importedAcknowledgedAt ? { importedAcknowledgedAt: Number(value.importedAcknowledgedAt) } : {}),
      ...(pendingImports?.length ? { pendingImports } : {}) },
    ...(value.version === 1 ? { v1Text: text } : {}),
  };
}

async function writeRecord(file: string, value: MigrationRecord, v1Text?: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  if (v1Text !== undefined) {
    // Keep the first version 1 text for a downgrade; never overwrite an existing copy.
    try { await writeFile(join(dirname(file), basename(CHAT_ROLE_MIGRATION_V1_BACKUP)), v1Text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

export interface ChatRoleMigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Audit sink (the instance's audit channel to the gateway's audit log). */
export type ChatRoleAudit = (entry: Readonly<{
  actor: string; action: string; target?: string; outcome: 'ok' | 'denied' | 'error'; detail?: Readonly<Record<string, unknown>>;
}>) => void;

/** How an adapter instance alias is classified for global grants: a local simulation, a real platform, or unknown. */
export type ChatRoleMigrationAdapterKind = 'simulated' | 'platform' | undefined;

/**
 * Classifies the adapter instances of a snapshot by their capability profile (ADR 0044: no
 * platform names): `runtime.sandbox` marks a local simulation whose clients choose their sender id.
 */
export function chatRoleMigrationAdapterKinds(snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined): (alias: string) => ChatRoleMigrationAdapterKind {
  const kinds = classifyAdapters(snapshot);
  return alias => kinds.get(alias);
}

/** Aliases of the snapshot's local simulation adapters (`runtime.sandbox`), sorted. */
export function simulatedAdapterAliases(snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined): readonly string[] {
  return Object.freeze([...classifyAdapters(snapshot)].filter(([, kind]) => kind === 'simulated').map(([alias]) => alias).sort());
}

function classifyAdapters(snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined): Map<string, Exclude<ChatRoleMigrationAdapterKind, undefined>> {
  const kinds = new Map<string, Exclude<ChatRoleMigrationAdapterKind, undefined>>();
  try {
    const index = snapshot?.projections.get(adapterFeatureId);
    if (snapshot && isAdapterIndex(index)) {
      for (const row of index.describe()) {
        const alias = snapshot.tree.get(row.owner)?.instanceKey;
        const profile = index.capabilityProfile(row.id as CapabilityId);
        if (!alias || !profile) continue;
        const simulated = resolveStaticCapabilities(profile, []).runtime?.sandbox === true;
        if (simulated || !kinds.has(alias)) kinds.set(alias, simulated ? 'simulated' : 'platform');
      }
    }
  } catch { /* unknown: every alias stays unclassified */ }
  return kinds;
}

export interface ChatRoleMigrationCompleteOptions {
  /** False without a relational database: grants are applied in memory only. */
  readonly persistent?: boolean;
  /**
   * Classifies adapter aliases for the global grants of `ai.trigger.*` ({@link chatRoleMigrationAdapterKinds}).
   * Simulated and unknown adapters get no global grant (fail closed; both are logged).
   */
  readonly adapterKind?: (alias: string) => ChatRoleMigrationAdapterKind;
  /** Each written grant is audited as `chat-roles.import` (actor `migration`). */
  readonly audit?: ChatRoleAudit;
}

export interface ChatRoleMigration {
  /** Grants still to be written once the database is loaded. */
  readonly pending: readonly LegacyChatRoleGrant[];
  /** Writes pending grants (a higher stored role at the same scope is kept) and completes the record. */
  complete(roles: InstanceChatRoleService, options?: ChatRoleMigrationCompleteOptions): Promise<void>;
}

const isTriggerGrant = (grant: LegacyChatRoleGrant) => grant.level === 'global' && grant.source.startsWith('ai.trigger.');

/**
 * Applies one configured grant (first import and Console import share the rules of ADR 0060 §4.3):
 * global grants of `ai.trigger.*` only on real platform adapters; a stored role at the same scope
 * is only ever raised, never lowered or removed.
 */
async function applyConfiguredGrant(
  roles: InstanceChatRoleService,
  grant: LegacyChatRoleGrant,
  options: Readonly<{ kind: (alias: string) => ChatRoleMigrationAdapterKind; persistent: boolean; grantedBy: string }>,
): Promise<{ result: ChatRoleImportResult; reason?: 'simulated' | 'unknown-adapter' }> {
  if (isTriggerGrant(grant)) {
    const classified = options.kind(grant.adapter);
    if (classified === 'simulated') return { result: 'skipped', reason: 'simulated' };
    if (classified !== 'platform') return { result: 'skipped', reason: 'unknown-adapter' };
  }
  if (!options.persistent) {
    return { result: await roles.store.seed([{ ...grant, grantedBy: options.grantedBy }]) ? 'memory' : 'kept' };
  }
  const existing = roles.store.get(grant.level, grant.key, grant);
  if (existing && higherChatRole(existing.role, grant.role) === existing.role) return { result: 'kept' };
  await roles.store.grant({ ...grantOf(grant), grantedBy: options.grantedBy });
  return { result: existing ? 'upgraded' : 'written' };
}

function auditImport(audit: ChatRoleAudit | undefined, actor: string, grant: LegacyChatRoleGrant, outcome: 'ok' | 'error', detail: Record<string, unknown>): void {
  try {
    audit?.({ actor, action: 'chat-roles.import', target: `${grant.level}:${grant.key}`.slice(0, 512), outcome,
      detail: Object.freeze({ source: grant.source, adapter: grant.adapter, userId: grant.userId, role: grant.role, level: grant.level, ...detail }) });
  } catch { /* audit never breaks an import */ }
}

/**
 * Before the Runtime reads the configuration: migrate legacy fields out of it (first start), or
 * — once that is done — record them as candidates waiting for a Console decision (ADR 0060 §4.2:
 * never granted automatically) and remove them from the file. `expand` resolves `${ENV}`
 * placeholders for the values.
 */
export async function prepareChatRoleMigration(options: Readonly<{
  projectRoot: string;
  config: ConfigDocumentPort;
  expand: (document: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
  logger: ChatRoleMigrationLogger;
  now?: () => number;
}>): Promise<ChatRoleMigration> {
  const file = join(options.projectRoot, CHAT_ROLE_MIGRATION_FILE);
  const now = options.now ?? Date.now;
  const snapshot = await options.config.read();
  const legacy = readLegacyChatRoleConfig(options.expand(snapshot.document));
  if (legacy.unsupported.length) throw new LegacyChatRoleConfigError(legacy.unsupported);
  const read = await readRecord(file);
  let current = read?.value;
  if (legacy.paths.length) {
    const fields = legacy.paths.map(path => path.join('.'));
    if (current?.status === 'done') {
      // ADR 0060 §4.2: whoever edits the file now is not necessarily an owner — never auto-grant.
      const at = now();
      const candidates = new Map((current.pendingImports ?? []).map(entry => [entry.id, entry] as const));
      let added = 0;
      for (const grant of legacy.grants) {
        const id = chatRoleImportId(grant);
        if (candidates.has(id)) continue;
        candidates.set(id, Object.freeze({ ...grantOf(grant), id, seenAt: at }));
        added += 1;
      }
      current = { ...current, pendingImports: Object.freeze([...candidates.values()]) };
      // Record first: the configuration edit below is then always recoverable.
      await writeRecord(file, current, read?.v1Text);
      const prepared = await options.config.prepare(snapshot, legacy.paths.map(path => ({ op: 'remove' as const, path })));
      await prepared.commit();
      options.logger.warn(`Chat roles (ADR 0060): the configuration names people lists again (${fields.join(', ')}); `
        + `they were NOT granted. ${added} candidate(s) wait for review in the Console (「需要你处理」→ chat-roles.import-pending, `
        + `global iam.manage) and the fields were removed from the configuration file. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
      for (const item of legacy.skipped) options.logger.warn(`Chat roles import skipped ${item}`);
    } else {
      const grants = dedupe([...(current?.grants ?? []), ...legacy.grants]);
      current = { version: 2, status: 'pending', grants, startedAt: current?.startedAt ?? now() };
      // Record first: the configuration edit below is then always recoverable.
      await writeRecord(file, current, read?.v1Text);
      const prepared = await options.config.prepare(snapshot, legacy.paths.map(path => ({ op: 'remove' as const, path })));
      await prepared.commit();
      options.logger.info(`Chat roles (ADR 0056): moved ${grants.length} role grant(s) out of the configuration `
        + `(${fields.join(', ')}); they are written to the project database chat_roles. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
      for (const item of legacy.skipped) options.logger.warn(`Chat roles migration skipped ${item}`);
    }
  }
  const pending = current?.status === 'pending' ? current.grants : [];
  const record_ = current;
  const v1Text = legacy.paths.length ? undefined : read?.v1Text;
  return Object.freeze({
    pending,
    async complete(roles: InstanceChatRoleService, completeOptions: ChatRoleMigrationCompleteOptions = {}) {
      if (!record_ || record_.status !== 'pending') return;
      const kind = completeOptions.adapterKind ?? (() => undefined);
      const persistent = completeOptions.persistent !== false && roles.store.persistent;
      const at = now();
      const imported: ChatRoleImportedGrant[] = [];
      for (const grant of record_.grants) {
        const outcome = await applyConfiguredGrant(roles, grant, { kind, persistent, grantedBy: `migration:${grant.source}` });
        imported.push(Object.freeze({ ...grantOf(grant), id: chatRoleImportId(grant), ...outcome, at }));
        if (outcome.reason === 'simulated') {
          options.logger.info(`Chat roles migration: ${grant.source} ${grant.userId} is not granted on ${grant.adapter} `
            + '(local simulation adapter: its clients choose their own sender id).');
        } else if (outcome.reason === 'unknown-adapter') {
          options.logger.warn(`Chat roles migration: ${grant.source} ${grant.userId} is not granted on ${grant.adapter} `
            + `(adapter not loaded, its kind is unknown); grant it in the Console if needed. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
        }
      }
      if (!persistent) {
        // No relational database: effective in memory only. Grants / revocations are refused on such
        // a store, so a revoked migrated role can never come back; the record waits for a database.
        const added = imported.filter(entry => entry.result === 'memory').length;
        await writeRecord(file, { ...record_, memoryOnlyAt: now() }, v1Text);
        options.logger.warn(`Chat roles: ${added} migrated grant(s) are held in memory only (no relational database); `
          + `${CHAT_ROLE_MIGRATION_FILE} stays pending until a relational database (sqlite / mysql / pg) is configured.`);
        return;
      }
      for (const entry of imported) {
        if (entry.result === 'written' || entry.result === 'upgraded') auditImport(completeOptions.audit, 'migration', entry, 'ok', { result: entry.result });
      }
      // ADR 0060 §4.1: one `ai.trigger.*` id across adapters is one person.
      const people = new ChatPeople({ store: roles.store, ...(completeOptions.audit ? { audit: () => completeOptions.audit } : {}) });
      const named = new Map<string, ChatIdentity[]>();
      for (const entry of imported) {
        if (!entry.source.startsWith('ai.trigger.') || entry.result === 'skipped') continue;
        const list = named.get(entry.userId) ?? [];
        list.push({ adapter: entry.adapter, userId: entry.userId });
        named.set(entry.userId, list);
      }
      for (const identities of named.values()) {
        await people.mergeConfigured(identities, 'migration:ai.trigger').catch(error =>
          options.logger.warn(`Chat roles migration: ai.trigger ids not grouped into one person (${(error as Error).message}).`));
      }
      const { memoryOnlyAt: _memoryOnly, ...done } = record_;
      await writeRecord(file, { ...done, status: 'done', completedAt: now(), imported: Object.freeze(imported) }, v1Text);
      const written = imported.filter(entry => entry.result === 'written' || entry.result === 'upgraded').length;
      options.logger.info(`Chat roles: wrote ${written} migrated grant(s) to chat_roles.`);
    },
  });
}

class RecordQueue {
  #queue: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

/** What the Console sees of the migration record. */
export interface ChatRoleImportState {
  /** The first import's grants (empty before it completed). */
  readonly imported: readonly ChatRoleImportedGrant[];
  readonly importedAt?: number;
  readonly importedAcknowledgedAt?: number;
  /** Re-appeared configured grants waiting for 「导入」/「忽略」. */
  readonly pending: readonly ChatRolePendingImport[];
}

export type ChatRoleImportDecision = 'import' | 'ignore';

export type ChatRoleImportResolution =
  | Readonly<{ status: 'imported'; result: ChatRoleImportResult; reason?: 'simulated' | 'unknown-adapter'; grant: ChatRolePendingImport }>
  | Readonly<{ status: 'ignored'; grant: ChatRolePendingImport }>
  | Readonly<{ status: 'not-found' }>;

/**
 * ADR 0060 §4.2: the Console side of the migration record — the first import (`chat-roles.imported`)
 * and the re-appeared candidates (`chat-roles.import-pending`). Callers authorize (global
 * `iam.manage`); every decision is audited as `chat-roles.import`.
 */
export class ChatRoleImportBook {
  readonly #file: string;
  readonly #queue = new RecordQueue();
  readonly #options: Readonly<{
    roles: () => InstanceChatRoleService | undefined;
    adapterKind: () => (alias: string) => ChatRoleMigrationAdapterKind;
    audit?: ChatRoleAudit;
    now?: () => number;
  }>;

  constructor(options: Readonly<{
    projectRoot: string;
    roles: () => InstanceChatRoleService | undefined;
    /** Classification of the current generation's adapters (read per decision). */
    adapterKind: () => (alias: string) => ChatRoleMigrationAdapterKind;
    audit?: ChatRoleAudit;
    now?: () => number;
  }>) {
    this.#file = join(options.projectRoot, CHAT_ROLE_MIGRATION_FILE);
    this.#options = options;
  }

  async read(): Promise<ChatRoleImportState> {
    const read = await readRecord(this.#file);
    const value = read?.value;
    if (!value) return Object.freeze({ imported: Object.freeze([]), pending: Object.freeze([]) });
    return Object.freeze({
      imported: value.imported ?? Object.freeze([]),
      ...(value.status === 'done' && value.completedAt ? { importedAt: value.completedAt } : {}),
      ...(value.importedAcknowledgedAt ? { importedAcknowledgedAt: value.importedAcknowledgedAt } : {}),
      pending: value.pendingImports ?? Object.freeze([]),
    });
  }

  /** 「导入」 or 「忽略」 one candidate. Import needs a relational database (the candidate stays otherwise). */
  resolve(input: Readonly<{ id: string; decision: ChatRoleImportDecision; actor: string }>): Promise<ChatRoleImportResolution> {
    return this.#queue.run(async () => {
      const read = await readRecord(this.#file);
      const value = read?.value;
      const grant = value?.pendingImports?.find(entry => entry.id === input.id);
      if (!value || !grant) return Object.freeze({ status: 'not-found' as const });
      let resolution: ChatRoleImportResolution;
      if (input.decision === 'import') {
        const roles = this.#options.roles();
        if (!roles || !roles.store.persistent) throw new ChatRoleStorageUnavailableError();
        let outcome: Awaited<ReturnType<typeof applyConfiguredGrant>>;
        try {
          outcome = await applyConfiguredGrant(roles, grant, { kind: this.#options.adapterKind(), persistent: true, grantedBy: input.actor });
        } catch (error) {
          auditImport(this.#options.audit, input.actor, grant, 'error', { decision: 'import' });
          throw error;
        }
        auditImport(this.#options.audit, input.actor, grant, 'ok', { decision: 'import', result: outcome.result, ...(outcome.reason ? { reason: outcome.reason } : {}) });
        resolution = Object.freeze({ status: 'imported' as const, ...outcome, grant });
      } else {
        auditImport(this.#options.audit, input.actor, grant, 'ok', { decision: 'ignore' });
        resolution = Object.freeze({ status: 'ignored' as const, grant });
      }
      const pendingImports = value.pendingImports!.filter(entry => entry.id !== input.id);
      const { pendingImports: _old, ...rest } = value;
      await writeRecord(this.#file, { ...rest, ...(pendingImports.length ? { pendingImports } : {}) }, read?.v1Text);
      return resolution;
    });
  }

  /** Marks the first import as read (the `chat-roles.imported` item disappears). */
  acknowledge(actor: string): Promise<'saved' | 'unchanged'> {
    return this.#queue.run(async () => {
      const read = await readRecord(this.#file);
      const value = read?.value;
      if (!value?.imported?.length || value.importedAcknowledgedAt) return 'unchanged' as const;
      await writeRecord(this.#file, { ...value, importedAcknowledgedAt: (this.#options.now ?? Date.now)() }, read?.v1Text);
      try {
        this.#options.audit?.({ actor, action: 'chat-roles.import', target: 'imported', outcome: 'ok', detail: Object.freeze({ decision: 'acknowledge' }) });
      } catch { /* audit never breaks a request */ }
      return 'saved' as const;
    });
  }
}
