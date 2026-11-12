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
 * After that, configuration that names these fields
 * again stops startup with {@link LegacyChatRoleConfigError}, pointing at the upgrade guide.
 * The interim `features.selfService.platformAdmins | roles | allowUsers` switches and the removed
 * `roles` (mapping rule) blocks of adapters / accounts always stop startup.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CHAT_ROLES, higherChatRole, isChatIdentity, normalizeChatRoleScope, type ChatRole,
} from '@zhin.js/core';
import { adapterFeatureId, isAdapterIndex, resolveStaticCapabilities } from '@zhin.js/adapter';
import {
  readPluginConfigurationMap, type CapabilityId, type ConfigDocumentPort, type FeatureConfigLevel, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { InstanceChatRoleService } from './chat-roles.js';

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
  let plugins: Readonly<Record<string, unknown>> = {};
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

interface MigrationRecord {
  readonly version: 1;
  readonly status: 'pending' | 'done';
  readonly grants: readonly LegacyChatRoleGrant[];
  readonly startedAt: number;
  readonly completedAt?: number;
  /** Last start that could only apply the grants in memory (no relational database). */
  readonly memoryOnlyAt?: number;
}

async function readRecord(file: string): Promise<MigrationRecord | undefined> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return undefined; }
  const value = JSON.parse(text) as Partial<MigrationRecord>;
  if (value.version !== 1 || (value.status !== 'pending' && value.status !== 'done') || !Array.isArray(value.grants)) {
    throw new Error(`${file} is malformed; restore it or delete it after checking chat_roles (${CHAT_ROLE_UPGRADE_GUIDE})`);
  }
  const grants = value.grants.filter((grant): grant is LegacyChatRoleGrant => record(grant)
    && (grant.level === 'global' || grant.level === 'adapter' || grant.level === 'endpoint')
    && typeof grant.key === 'string' && isChatIdentity(grant) && (CHAT_ROLES as readonly string[]).includes(String(grant.role)));
  return { version: 1, status: value.status, grants, startedAt: Number(value.startedAt) || 0,
    ...(value.completedAt ? { completedAt: Number(value.completedAt) } : {}),
    ...(value.memoryOnlyAt ? { memoryOnlyAt: Number(value.memoryOnlyAt) } : {}) };
}

async function writeRecord(file: string, value: MigrationRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

export interface ChatRoleMigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** How an adapter instance alias is classified for global grants: a local simulation, a real platform, or unknown. */
export type ChatRoleMigrationAdapterKind = 'simulated' | 'platform' | undefined;

/**
 * Classifies the adapter instances of a snapshot by their capability profile (ADR 0044: no
 * platform names): `runtime.sandbox` marks a local simulation whose clients choose their sender id.
 */
export function chatRoleMigrationAdapterKinds(snapshot: Pick<RuntimeSnapshot, 'projections' | 'tree'> | undefined): (alias: string) => ChatRoleMigrationAdapterKind {
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
  return alias => kinds.get(alias);
}

export interface ChatRoleMigrationCompleteOptions {
  /** False without a relational database: grants are applied in memory only. */
  readonly persistent?: boolean;
  /**
   * Classifies adapter aliases for the global grants of `ai.trigger.*` ({@link chatRoleMigrationAdapterKinds}).
   * Simulated and unknown adapters get no global grant (fail closed; both are logged).
   */
  readonly adapterKind?: (alias: string) => ChatRoleMigrationAdapterKind;
}

export interface ChatRoleMigration {
  /** Grants still to be written once the database is loaded. */
  readonly pending: readonly LegacyChatRoleGrant[];
  /** Writes pending grants (existing stored roles at the same scope are kept) and completes the record. */
  complete(roles: InstanceChatRoleService, options?: ChatRoleMigrationCompleteOptions): Promise<void>;
}

const isTriggerGrant = (grant: LegacyChatRoleGrant) => grant.level === 'global' && grant.source.startsWith('ai.trigger.');

/**
 * Before the Runtime reads the configuration: migrate legacy fields out of it (first start) or
 * refuse them (afterwards). `expand` resolves `${ENV}` placeholders for the values.
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
  let current = await readRecord(file);
  if (legacy.paths.length) {
    const fields = legacy.paths.map(path => path.join('.'));
    if (current?.status === 'done') throw new LegacyChatRoleConfigError(fields);
    const grants = dedupe([...(current?.grants ?? []), ...legacy.grants]);
    current = { version: 1, status: 'pending', grants, startedAt: current?.startedAt ?? now() };
    // Record first: the configuration edit below is then always recoverable.
    await writeRecord(file, current);
    const prepared = await options.config.prepare(snapshot, legacy.paths.map(path => ({ op: 'remove' as const, path })));
    await prepared.commit();
    options.logger.info(`Chat roles (ADR 0056): moved ${grants.length} role grant(s) out of the configuration `
      + `(${fields.join(', ')}); they are written to the project database chat_roles. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
    for (const item of legacy.skipped) options.logger.warn(`Chat roles migration skipped ${item}`);
  }
  const pending = current?.status === 'pending' ? current.grants : [];
  const record_ = current;
  return Object.freeze({
    pending,
    async complete(roles: InstanceChatRoleService, completeOptions: ChatRoleMigrationCompleteOptions = {}) {
      if (!record_ || record_.status !== 'pending') return;
      const kind = completeOptions.adapterKind ?? (() => undefined);
      const grants = record_.grants.filter(grant => {
        if (!isTriggerGrant(grant)) return true;
        const classified = kind(grant.adapter);
        if (classified === 'platform') return true;
        if (classified === 'simulated') {
          options.logger.info(`Chat roles migration: ${grant.source} ${grant.userId} is not granted on ${grant.adapter} `
            + '(local simulation adapter: its clients choose their own sender id).');
        } else {
          options.logger.warn(`Chat roles migration: ${grant.source} ${grant.userId} is not granted on ${grant.adapter} `
            + `(adapter not loaded, its kind is unknown); grant it in the Console if needed. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
        }
        return false;
      });
      const persistent = completeOptions.persistent !== false && roles.store.persistent;
      if (!persistent) {
        // No relational database: effective in memory only. Grants / revocations are refused on such
        // a store, so a revoked migrated role can never come back; the record waits for a database.
        const added = roles.store.seed(grants.map(grant => ({ ...grant, grantedBy: `migration:${grant.source}` })));
        await writeRecord(file, { ...record_, memoryOnlyAt: now() });
        options.logger.warn(`Chat roles: ${added} migrated grant(s) are held in memory only (no relational database); `
          + `${CHAT_ROLE_MIGRATION_FILE} stays pending until a relational database (sqlite / mysql / pg) is configured.`);
        return;
      }
      let written = 0;
      for (const grant of grants) {
        const existing = roles.store.get(grant.level, grant.key, grant);
        if (existing) continue;
        await roles.store.grant({ ...grant, grantedBy: `migration:${grant.source}` });
        written += 1;
      }
      const { memoryOnlyAt: _memoryOnly, ...done } = record_;
      await writeRecord(file, { ...done, status: 'done', completedAt: now() });
      options.logger.info(`Chat roles: wrote ${written} migrated grant(s) to chat_roles.`);
    },
  });
}
