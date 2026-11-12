/**
 * ADR 0056 §3: one-time migration of configured people lists into `chat_roles`.
 *
 * - Adapter block `master` → adapter-level `owner`, `trusted` → adapter-level `trusted`;
 *   `endpoints[i].master` / `endpoints[i].trusted` → the same at the account (endpoint) level.
 * - `ai.trigger.masters` / `ai.trigger.trusted` → global `owner` / `trusted`, one identity per
 *   configured adapter (those lists named user ids without a platform).
 *
 * The first start records the grants in `.zhin/chat-roles-migration.json` (status `pending`),
 * removes the fields from the configuration file and logs what moved; once the project database
 * is loaded the grants are written to `chat_roles` and the record turns `done`. A crash in between
 * replays the pending record on the next start. After that, configuration that names these fields
 * again stops startup with {@link LegacyChatRoleConfigError}, pointing at the upgrade guide.
 * The interim `features.selfService.platformAdmins | roles | allowUsers` switches are replaced by
 * mapping rules and always stop startup.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CHAT_ROLES, higherChatRole, isChatIdentity, normalizeChatRoleScope, type ChatRole,
} from '@zhin.js/core';
import { readPluginConfigurationMap, type ConfigDocumentPort, type FeatureConfigLevel } from '@zhin.js/plugin-runtime';
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
      + `and platform roles map through roles.mappings. See ${CHAT_ROLE_UPGRADE_GUIDE}.`);
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
    for (const [field, role] of [['master', 'owner'], ['trusted', 'trusted']] as const) {
      if (block[field] === undefined) continue;
      add('adapter', alias, alias, role, block[field], `${alias}.${field}`);
      paths.push([alias, field]);
    }
    block.endpoints.forEach((entry, index) => {
      if (!record(entry)) return;
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
    ...(value.completedAt ? { completedAt: Number(value.completedAt) } : {}) };
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

export interface ChatRoleMigration {
  /** Grants still to be written once the database is loaded. */
  readonly pending: readonly LegacyChatRoleGrant[];
  /** Writes pending grants (existing stored roles at the same scope are kept) and completes the record. */
  complete(roles: InstanceChatRoleService, options?: Readonly<{ persistent?: boolean }>): Promise<void>;
}

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
    async complete(roles: InstanceChatRoleService, completeOptions: Readonly<{ persistent?: boolean }> = {}) {
      if (!record_ || record_.status !== 'pending') return;
      let written = 0;
      for (const grant of record_.grants) {
        const existing = roles.store.get(grant.level, grant.key, grant);
        if (existing) continue;
        await roles.store.grant({ ...grant, grantedBy: `migration:${grant.source}` });
        written += 1;
      }
      if (completeOptions.persistent === false) {
        // No relational database: keep the record pending so every start replays it into memory.
        options.logger.warn(`Chat roles: ${written} migrated grant(s) are held in memory only (no relational database); `
          + `${CHAT_ROLE_MIGRATION_FILE} stays pending.`);
        return;
      }
      await writeRecord(file, { ...record_, status: 'done', completedAt: now() });
      options.logger.info(`Chat roles: wrote ${written} migrated grant(s) to chat_roles.`);
    },
  });
}
