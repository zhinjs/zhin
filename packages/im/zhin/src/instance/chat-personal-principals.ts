/**
 * ADR 0060 §4.1 / §4.4 (P3): `ai.personalPrincipals` becomes people and Console links.
 *
 * - First start (per entry): the configured owners are turned into chat identities (adapter
 *   capability id → instance alias of the current generation) and joined to the person linked to
 *   the Console user (`ChatPeople.importPersonalPrincipal`); **no role is granted** (Q2).
 * - A `rootId` that is not the current project directory no longer fails the start: the entry is
 *   imported by alias + `subjectId` and a warning is logged.
 * - An entry whose adapter is not loaded stays `pending` and is retried on the next start (§4.3).
 * - Never automatic onto a person who holds grants: whoever edits the configuration is not
 *   necessarily an owner, and a Console link hands the user what that person may do (Sandbox).
 *   Such an entry waits as `pending` / `needs-confirmation`.
 * - After the first import (`migratedAt`) every new or changed entry waits the same way (entries
 *   the first import left `unknown-adapter` are retried, still under the rule above): a global
 *   `iam.manage` holder imports or ignores it in the Console (`chat-roles.imports.resolve`, listed
 *   under 「需要你处理」 `chat-roles.import-pending`).
 * - Afterwards the links are the source: the configuration entry is only reported as
 *   「已导入，数据库为准」; the record (`.zhin/personal-principals-import.json`) keeps what happened
 *   for 「需要你处理」 (`chat-roles.imported`) until a Console user marks it as read.
 * - Needs a relational project database (sqlite / mysql / pg); otherwise nothing is imported.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ChatIdentity } from '@zhin.js/core';
import type { ChatPeople } from './chat-people.js';
import type { ChatRoleAudit } from './chat-role-migration.js';

export const PERSONAL_PRINCIPALS_IMPORT_FILE = join('.zhin', 'personal-principals-import.json');

/** One configured owner of `ai.personalPrincipals[key]`, as the Agent Host resolved it. */
export interface PersonalPrincipalSeed {
  /** The configuration key (`user:<consoleUserId>`). */
  readonly key: string;
  readonly adapterId: string;
  readonly subjectId: string;
  /** Chat identity in the current generation; undefined while the adapter is not loaded. */
  readonly identity?: ChatIdentity;
  /** The configured `rootId` is not this project's directory (moved project, ADR 0060 §4.1). */
  readonly foreignRoot?: boolean;
}

export type PersonalPrincipalImportStatus = 'imported' | 'pending' | 'skipped';

export interface PersonalPrincipalImportEntry {
  readonly id: string;
  readonly consoleUserId: string;
  readonly adapterId: string;
  readonly subjectId: string;
  readonly status: PersonalPrincipalImportStatus;
  readonly adapter?: string;
  readonly principalId?: string;
  /**
   * `owned-elsewhere`: the identity belongs to another person; `not-a-user`: the key is not
   * `user:<id>`; `unknown-adapter`: not loaded; `needs-confirmation`: waits for a global
   * `iam.manage` holder (`pending`); `ignored`: that holder declined it (`skipped`).
   */
  readonly reason?: PersonalPrincipalImportReason;
  readonly at: number;
}

export type PersonalPrincipalImportReason = 'owned-elsewhere' | 'not-a-user' | 'unknown-adapter' | 'needs-confirmation' | 'ignored';

interface ImportRecord {
  readonly version: 1;
  readonly entries: readonly PersonalPrincipalImportEntry[];
  readonly acknowledgedAt?: number;
  /** When the one-time first import ran; later entries wait for confirmation. */
  readonly migratedAt?: number;
}

/** A configured link waiting for a global `iam.manage` holder. */
export interface PersonalPrincipalPendingEntry {
  readonly id: string;
  readonly consoleUserId: string;
  readonly adapter: string;
  readonly userId: string;
  readonly at: number;
}

export function personalPrincipalPending(entries: readonly PersonalPrincipalImportEntry[]): readonly PersonalPrincipalPendingEntry[] {
  return Object.freeze(entries.filter(entry => entry.status === 'pending' && entry.reason === 'needs-confirmation' && entry.adapter)
    .map(entry => Object.freeze({ id: entry.id, consoleUserId: entry.consoleUserId, adapter: entry.adapter!, userId: entry.subjectId, at: entry.at })));
}

export interface PersonalPrincipalImportState {
  readonly entries: readonly PersonalPrincipalImportEntry[];
  readonly acknowledgedAt?: number;
}

export type PersonalPrincipalResolution =
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'ignored' }>
  | Readonly<{ status: 'imported' | 'skipped'; principalId?: string; reason?: PersonalPrincipalImportReason }>;

const STATUSES: readonly string[] = ['imported', 'pending', 'skipped'];
const REASONS: readonly string[] = ['owned-elsewhere', 'not-a-user', 'unknown-adapter', 'needs-confirmation', 'ignored'];

export function personalPrincipalImportId(seed: Pick<PersonalPrincipalSeed, 'key' | 'adapterId' | 'subjectId'>): string {
  return createHash('sha256').update(JSON.stringify([seed.key, seed.adapterId, seed.subjectId])).digest('hex').slice(0, 24);
}

/** `user:<id>` → `<id>`. */
export function consoleUserOfPersonalPrincipalKey(key: string): string | undefined {
  const match = /^user:(.{1,128})$/u.exec(key);
  return match?.[1];
}

async function readImportRecord(file: string): Promise<ImportRecord> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return { version: 1, entries: [] }; }
  const value = JSON.parse(text) as Partial<ImportRecord>;
  if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error(`${file} is malformed; delete it to import ai.personalPrincipals again`);
  const entries = value.entries.filter((entry): entry is PersonalPrincipalImportEntry => !!entry && typeof entry === 'object'
    && typeof entry.id === 'string' && typeof entry.consoleUserId === 'string' && typeof entry.adapterId === 'string'
    && typeof entry.subjectId === 'string' && STATUSES.includes(String(entry.status)))
    .map(entry => Object.freeze({ id: entry.id, consoleUserId: entry.consoleUserId, adapterId: entry.adapterId, subjectId: entry.subjectId,
      status: entry.status, ...(typeof entry.adapter === 'string' ? { adapter: entry.adapter } : {}),
      ...(typeof entry.principalId === 'string' ? { principalId: entry.principalId } : {}),
      ...(REASONS.includes(String(entry.reason)) ? { reason: entry.reason } : {}), at: Number(entry.at) || 0 }));
  return { version: 1, entries, ...(value.acknowledgedAt ? { acknowledgedAt: Number(value.acknowledgedAt) } : {}),
    // Records written before `migratedAt` existed: entries mean the first import already ran.
    ...(value.migratedAt ? { migratedAt: Number(value.migratedAt) } : entries.length ? { migratedAt: entries[0]!.at || 1 } : {}) };
}

async function writeImportRecord(file: string, value: ImportRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

export interface PersonalPrincipalImportLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** The import record and its first-start import. */
export class PersonalPrincipalImportBook {
  readonly #file: string;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #now: () => number;

  constructor(options: Readonly<{ projectRoot: string; now?: () => number }>) {
    this.#file = join(options.projectRoot, PERSONAL_PRINCIPALS_IMPORT_FILE);
    this.#now = options.now ?? Date.now;
  }

  #run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async read(): Promise<PersonalPrincipalImportState> {
    const record = await readImportRecord(this.#file);
    return Object.freeze({ entries: record.entries, ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}) });
  }

  /**
   * Imports the seeds not imported (or skipped) before; `pending` ones are retried. Without a
   * persistent chat store nothing is written (the record stays as it is).
   */
  run(input: Readonly<{ seeds: readonly PersonalPrincipalSeed[]; people: ChatPeople; logger: PersonalPrincipalImportLogger; audit?: ChatRoleAudit }>): Promise<PersonalPrincipalImportState> {
    return this.#run(async () => {
      const record = await readImportRecord(this.#file);
      const known = new Map(record.entries.map(entry => [entry.id, entry] as const));
      if (!input.seeds.length) {
        // A project without entries has had its first import too: an entry added later waits for
        // confirmation instead of being linked as a "first import" (security review).
        if (record.migratedAt === undefined && input.people.store.persistent) {
          await writeImportRecord(this.#file, { ...record, migratedAt: this.#now() });
        }
        return Object.freeze({ entries: record.entries, ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}) });
      }
      if (!input.people.store.persistent) {
        input.logger.warn('ai.personalPrincipals 未导入：项目数据库不能保存聊天身份（需要 sqlite / mysql / pg），仍按配置读取不到个人推理主体');
        return Object.freeze({ entries: record.entries });
      }
      const migrated = record.migratedAt !== undefined;
      const fresh = input.seeds.filter(seed => {
        const previous = known.get(personalPrincipalImportId(seed));
        return !previous || (previous.status === 'pending' && previous.reason !== 'needs-confirmation');
      });
      const already = input.seeds.length - fresh.length;
      if (already > 0) input.logger.warn(`ai.personalPrincipals 已导入为「人 ↔ Console 账号」链接，数据库为准；配置中的 ${already} 条不再生效，可从 zhin.config 删除（ADR 0060）`);
      if (!fresh.length) return Object.freeze({ entries: record.entries, ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}) });
      const at = this.#now();
      const results = new Map(known);
      const byUser = new Map<string, PersonalPrincipalSeed[]>();
      for (const seed of fresh) {
        const id = personalPrincipalImportId(seed);
        const base = { id, consoleUserId: consoleUserOfPersonalPrincipalKey(seed.key) ?? seed.key, adapterId: seed.adapterId, subjectId: seed.subjectId, at };
        if (!consoleUserOfPersonalPrincipalKey(seed.key)) {
          results.set(id, Object.freeze({ ...base, status: 'skipped' as const, reason: 'not-a-user' as const }));
          input.logger.warn(`ai.personalPrincipals.${seed.key} 不是 Console 用户（user:<id>），未导入`);
          continue;
        }
        if (!seed.identity) {
          results.set(id, Object.freeze({ ...base, status: 'pending' as const, reason: 'unknown-adapter' as const }));
          input.logger.warn(`ai.personalPrincipals.${seed.key}：适配器 ${seed.adapterId.replace(/\0/gu, '/')} 未加载，下次启动再导入`);
          continue;
        }
        if (migrated && !known.has(id)) {
          // After the one-time first import a configuration edit never links by itself (an entry
          // the first import left `unknown-adapter` is part of it and retried, still guarded).
          results.set(id, Object.freeze({ ...base, adapter: seed.identity.adapter, status: 'pending' as const, reason: 'needs-confirmation' as const }));
          input.logger.warn(`ai.personalPrincipals.${seed.key}：新的或已修改的条目 ${seed.identity.adapter}:${seed.subjectId} 等待 Console 确认（需要你处理）`);
          continue;
        }
        if (seed.foreignRoot) input.logger.warn(`ai.personalPrincipals.${seed.key} 的 rootId 不是当前项目目录；已按适配器别名 ${seed.identity.adapter} 与 subjectId 导入`);
        const list = byUser.get(seed.key) ?? [];
        list.push(seed);
        byUser.set(seed.key, list);
      }
      for (const [key, seeds] of byUser) {
        const consoleUserId = consoleUserOfPersonalPrincipalKey(key)!;
        const outcome = await input.people.importPersonalPrincipal({ consoleUserId, identities: seeds.map(seed => seed.identity!), actor: 'import:ai.personalPrincipals' });
        if (outcome.needsConfirmation) {
          for (const seed of seeds) {
            results.set(personalPrincipalImportId(seed), Object.freeze({ id: personalPrincipalImportId(seed), consoleUserId, adapterId: seed.adapterId,
              subjectId: seed.subjectId, adapter: seed.identity!.adapter, status: 'pending' as const, reason: 'needs-confirmation' as const, at }));
          }
          input.logger.warn(`ai.personalPrincipals.${key}：涉及持有聊天角色的人，未自动链接，等待 Console 确认（需要你处理）`);
          continue;
        }
        if (outcome.linkConflict || outcome.ownedElsewhere.length) {
          input.logger.warn(`ai.personalPrincipals.${key}：${outcome.ownedElsewhere.map(identity => `${identity.adapter}:${identity.userId}`).join('、')} 已属于另一个人，未归入（一对一链接，ADR 0060 §4.3）`);
        }
        for (const seed of seeds) {
          const id = personalPrincipalImportId(seed);
          const elsewhere = outcome.ownedElsewhere.some(identity => identity.adapter === seed.identity!.adapter && identity.userId === seed.identity!.userId);
          results.set(id, Object.freeze({ id, consoleUserId, adapterId: seed.adapterId, subjectId: seed.subjectId, adapter: seed.identity!.adapter,
            ...(outcome.principalId ? { principalId: outcome.principalId } : {}), at, ...(elsewhere ? { status: 'skipped' as const, reason: 'owned-elsewhere' as const } : { status: 'imported' as const }) }));
        }
        input.logger.info(`ai.personalPrincipals.${key} 已导入：链接到聊天中的人 ${outcome.principalId}（不授予任何角色）`);
      }
      const next: ImportRecord = { version: 1, entries: Object.freeze([...results.values()]),
        ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}), migratedAt: record.migratedAt ?? at };
      await writeImportRecord(this.#file, next);
      return Object.freeze({ entries: next.entries, ...(next.acknowledgedAt ? { acknowledgedAt: next.acknowledgedAt } : {}) });
    });
  }

  /**
   * A global `iam.manage` holder decided a waiting entry: `import` links it (even onto a person who
   * holds grants: the holder confirmed it), `ignore` drops it. Audited as `chat-roles.import`.
   */
  resolve(input: Readonly<{ id: string; decision: 'import' | 'ignore'; people: ChatPeople; actor: string; audit?: ChatRoleAudit }>): Promise<PersonalPrincipalResolution> {
    return this.#run(async () => {
      const record = await readImportRecord(this.#file);
      const entry = record.entries.find(candidate => candidate.id === input.id && candidate.status === 'pending' && candidate.reason === 'needs-confirmation');
      if (!entry || !entry.adapter) return Object.freeze({ status: 'not-found' as const });
      const at = this.#now();
      let next: PersonalPrincipalImportEntry;
      let resolution: PersonalPrincipalResolution;
      if (input.decision === 'ignore') {
        next = Object.freeze({ ...entry, status: 'skipped' as const, reason: 'ignored' as const, at });
        resolution = Object.freeze({ status: 'ignored' as const });
        try { input.audit?.({ actor: input.actor, action: 'chat-roles.import', target: 'personal-principals', outcome: 'ok',
          detail: Object.freeze({ decision: 'ignore', consoleUserId: entry.consoleUserId, identity: `${entry.adapter}:${entry.subjectId}` }) }); } catch { /* never breaks */ }
      } else {
        const outcome = await input.people.importPersonalPrincipal({ consoleUserId: entry.consoleUserId,
          identities: [{ adapter: entry.adapter, userId: entry.subjectId }], actor: 'import:ai.personalPrincipals', confirmedBy: input.actor });
        try { input.audit?.({ actor: input.actor, action: 'chat-roles.import', target: 'personal-principals', outcome: 'ok',
          detail: Object.freeze({ decision: 'import', consoleUserId: entry.consoleUserId, identity: `${entry.adapter}:${entry.subjectId}`,
            ...(outcome.principalId ? { principalId: outcome.principalId } : {}), ...(outcome.ownedElsewhere.length ? { skipped: 'owned-elsewhere' } : {}) }) }); } catch { /* never breaks */ }
        const elsewhere = outcome.ownedElsewhere.length > 0;
        const { reason: _reason, ...rest } = entry;
        next = Object.freeze({ ...rest, ...(outcome.principalId ? { principalId: outcome.principalId } : {}), at,
          ...(elsewhere ? { status: 'skipped' as const, reason: 'owned-elsewhere' as const } : { status: 'imported' as const }) });
        resolution = Object.freeze({ status: elsewhere ? 'skipped' as const : 'imported' as const,
          ...(outcome.principalId ? { principalId: outcome.principalId } : {}), ...(elsewhere ? { reason: 'owned-elsewhere' as const } : {}) });
      }
      const entries = Object.freeze(record.entries.map(candidate => candidate.id === entry.id ? next : candidate));
      // A fresh import shows up as unread again.
      const acknowledgedAt = next.status === 'imported' ? undefined : record.acknowledgedAt;
      await writeImportRecord(this.#file, { version: 1, entries, ...(acknowledgedAt ? { acknowledgedAt } : {}),
        ...(record.migratedAt ? { migratedAt: record.migratedAt } : {}) });
      return resolution;
    });
  }

  /** Marks the import as read (it leaves 「需要你处理」). */
  acknowledge(actor: string, audit?: ChatRoleAudit): Promise<'saved' | 'unchanged'> {
    return this.#run(async () => {
      const record = await readImportRecord(this.#file);
      if (!record.entries.some(entry => entry.status === 'imported') || record.acknowledgedAt) return 'unchanged' as const;
      await writeImportRecord(this.#file, { ...record, acknowledgedAt: this.#now() });
      try { audit?.({ actor, action: 'chat-roles.import', target: 'personal-principals', outcome: 'ok', detail: Object.freeze({ decision: 'acknowledge' }) }); } catch { /* never breaks */ }
      return 'saved' as const;
    });
  }
}
