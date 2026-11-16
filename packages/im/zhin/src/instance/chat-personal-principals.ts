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
 * - One exception (#1250 `personal-principals-invalid-key-consumes-migration`): an entry the first
 *   import skipped as `not-a-user` (its key was not `user:<id>`) is not part of what was migrated.
 *   Once its key is corrected, within 30 days of the first import, an entry with the **same**
 *   `adapterId` + `subjectId` is imported like the first import would have: once per identity (any
 *   later entry for it — waiting, ignored, imported — consumes it), still never onto a person who
 *   holds grants, audited, and shown as unread under 「需要你处理」. Only the key (which Console user) is new; the
 *   chat identity is the one the configuration named when the first import ran.
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
  /**
   * Written by the one-time first import (also kept while an `unknown-adapter` entry of it is
   * retried): only such entries are retried or corrected without confirmation.
   */
  readonly firstImport?: true;
  /** A first-import `not-a-user` entry whose corrected key was imported (id of that entry). */
  readonly correctedBy?: string;
}

export type PersonalPrincipalImportReason = 'owned-elsewhere' | 'not-a-user' | 'unknown-adapter' | 'needs-confirmation' | 'ignored';

interface ImportRecord {
  readonly version: 1;
  readonly entries: readonly PersonalPrincipalImportEntry[];
  readonly acknowledgedAt?: number;
  /** When the one-time first import ran; later entries wait for confirmation. */
  readonly migratedAt?: number;
  /** Entries carry `firstImport`; older records are judged by `at <= migratedAt`. */
  readonly flags?: 1;
}

/** A configured link waiting for a global `iam.manage` holder. */
export interface PersonalPrincipalPendingEntry {
  readonly id: string;
  readonly consoleUserId: string;
  readonly adapter: string;
  /** The account the link is for, when the configuration names one (`<adapter>~<endpoint>`). */
  readonly endpoint?: string;
  readonly userId: string;
  readonly at: number;
}

export function personalPrincipalPending(entries: readonly PersonalPrincipalImportEntry[]): readonly PersonalPrincipalPendingEntry[] {
  return Object.freeze(entries.filter(entry => entry.status === 'pending' && entry.reason === 'needs-confirmation' && entry.adapter)
    .map(entry => {
      const endpoint = personalPrincipalEndpointOf(entry.adapterId);
      return Object.freeze({ id: entry.id, consoleUserId: entry.consoleUserId, adapter: entry.adapter!, ...(endpoint ? { endpoint } : {}),
        userId: entry.subjectId, at: entry.at });
    }));
}

/** The account (endpoint) part of an `ai.personalPrincipals` adapter id (`<adapter>~<endpoint>`), when it names one (#1250). */
export function personalPrincipalEndpointOf(adapterId: string): string | undefined {
  const index = adapterId.lastIndexOf('~');
  const endpoint = index >= 0 ? adapterId.slice(index + 1) : '';
  return endpoint || undefined;
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
      ...(REASONS.includes(String(entry.reason)) ? { reason: entry.reason } : {}), at: Number(entry.at) || 0,
      ...(entry.firstImport === true ? { firstImport: true as const } : {}),
      ...(typeof entry.correctedBy === 'string' ? { correctedBy: entry.correctedBy } : {}) }));
  // Records written before `migratedAt` existed: entries mean the first import already ran.
  const migratedAt = value.migratedAt ? Number(value.migratedAt) : entries.length ? entries[0]!.at || 1 : undefined;
  // Records written before `firstImport` existed: the first import stamped its entries with
  // `migratedAt`. Anything later (an `unknown-adapter` entry retried by that version moved its `at`
  // on every retry, so it cannot be told from one added after the first import) needs confirmation.
  const flagged = value.flags === 1 ? entries : entries.map(entry => migratedAt !== undefined && entry.at <= migratedAt
    ? Object.freeze({ ...entry, firstImport: true as const }) : entry);
  return { version: 1, entries: flagged, flags: 1, ...(value.acknowledgedAt ? { acknowledgedAt: Number(value.acknowledgedAt) } : {}),
    ...(migratedAt !== undefined ? { migratedAt } : {}) };
}

/** `<adapter alias>:<subjectId>（账号 <endpoint>）`: one openid on two accounts is two entries (#1250). */
export function personalPrincipalSourceLabel(entry: Readonly<{ adapterId: string; subjectId: string; adapter?: string }>): string {
  const endpoint = personalPrincipalEndpointOf(entry.adapterId);
  const adapter = entry.adapter ?? entry.adapterId.split(/[\0~]/u).filter(Boolean).pop() ?? entry.adapterId;
  return `${adapter}:${entry.subjectId}${endpoint ? `（账号 ${endpoint}）` : ''}`;
}

const pairOf = (entry: Readonly<{ adapterId: string; subjectId: string }>) => JSON.stringify([entry.adapterId, entry.subjectId]);

/** A corrected key is imported without confirmation only this long after the first import. */
export const PERSONAL_PRINCIPAL_CORRECTION_WINDOW_MS = 30 * 86_400_000;

const isSkippedFirstImport = (entry: PersonalPrincipalImportEntry) => entry.status === 'skipped' && entry.reason === 'not-a-user' && entry.firstImport === true;

/**
 * Identities (`adapterId` + `subjectId`) a corrected key may still import without confirmation:
 * the first import skipped them as `not-a-user`, none of those skipped entries was corrected, and no
 * other entry for the identity exists (one that waited, was ignored or imported — in this version or
 * an earlier one — consumes it). An `unknown-adapter` retry does not: it is still that correction.
 */
function correctableIdentities(entries: readonly PersonalPrincipalImportEntry[]): Map<string, PersonalPrincipalImportEntry[]> {
  const byPair = new Map<string, PersonalPrincipalImportEntry[]>();
  for (const entry of entries) byPair.set(pairOf(entry), [...(byPair.get(pairOf(entry)) ?? []), entry]);
  const correctable = new Map<string, PersonalPrincipalImportEntry[]>();
  for (const [pair, list] of byPair) {
    const skipped = list.filter(isSkippedFirstImport);
    if (!skipped.length || skipped.some(entry => entry.correctedBy)) continue;
    const consumed = list.some(entry => !isSkippedFirstImport(entry) && !(entry.status === 'pending' && entry.reason === 'unknown-adapter')
      && !(entry.status === 'skipped' && entry.reason === 'not-a-user'));
    if (!consumed) correctable.set(pair, skipped);
  }
  return correctable;
}

async function writeImportRecord(file: string, value: ImportRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...value, flags: 1 }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
      // First-import entries skipped only because their key was not `user:<id>`, by identity: not
      // part of what was migrated, so a corrected key is imported like that first import (#1250).
      // Each identity is corrected at most once, and only within the window after the first import.
      const now = this.#now();
      const inWindow = migrated && now - record.migratedAt! <= PERSONAL_PRINCIPAL_CORRECTION_WINDOW_MS;
      const correctable = inWindow ? correctableIdentities(record.entries) : new Map<string, PersonalPrincipalImportEntry[]>();
      const corrects = (seed: PersonalPrincipalSeed) => !!consoleUserOfPersonalPrincipalKey(seed.key) && correctable.has(pairOf(seed));
      const fresh = input.seeds.filter(seed => {
        const previous = known.get(personalPrincipalImportId(seed));
        if (!previous) return true;
        if (previous.status === 'pending' && previous.reason !== 'needs-confirmation') return true;
        // A key still not `user:<id>` is reported again (it never was imported).
        return previous.status === 'skipped' && previous.reason === 'not-a-user';
      });
      const already = input.seeds.length - fresh.length;
      if (already > 0) input.logger.warn(`ai.personalPrincipals 已导入为「人 ↔ Console 账号」链接，数据库为准；配置中的 ${already} 条不再生效，可从 zhin.config 删除（ADR 0060）`);
      if (!fresh.length) return Object.freeze({ entries: record.entries, ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}) });
      const at = now;
      const results = new Map(known);
      const byUser = new Map<string, PersonalPrincipalSeed[]>();
      /** Seeds imported because they correct a first-import `not-a-user` entry (id → that entry). */
      const corrected = new Map<string, PersonalPrincipalImportEntry[]>();
      let changed = false;
      for (const seed of fresh) {
        const id = personalPrincipalImportId(seed);
        const previous = known.get(id);
        const base = { id, consoleUserId: consoleUserOfPersonalPrincipalKey(seed.key) ?? seed.key, adapterId: seed.adapterId, subjectId: seed.subjectId, at };
        const source = personalPrincipalSourceLabel({ adapterId: seed.adapterId, subjectId: seed.subjectId, ...(seed.identity ? { adapter: seed.identity.adapter } : {}) });
        if (!consoleUserOfPersonalPrincipalKey(seed.key)) {
          const firstImport = !migrated || previous?.firstImport === true;
          if (!previous) {
            results.set(id, Object.freeze({ ...base, status: 'skipped' as const, reason: 'not-a-user' as const, ...(firstImport ? { firstImport: true as const } : {}) }));
            changed = true;
          }
          // The exemption only while this identity can still be corrected (not used, within the window).
          const exempt = !migrated || (firstImport && correctable.has(pairOf(seed)));
          input.logger.warn(`ai.personalPrincipals.${seed.key}（${source}）：键不是 Console 用户（应为 user:<Console 用户 id>），未导入；`
            + `运行 zhin console user list 查看可用的 user id（网关自己的日志——前台运行时的终端或 .zhin/logs/gateway.log——会给出建议的键）。${exempt
              ? '首次导入后 30 天内改正，下次启动按首次导入处理，不需要 Console 确认（ADR 0060）'
              : '改正后的条目等待 Console 确认（需要你处理）'}`);
          continue;
        }
        // While the adapter is not loaded the identity is not consumed: the correction waits as
        // `unknown-adapter` (no `firstImport`) and is judged again, window included, once it loads.
        const correcting = !previous?.firstImport && seed.identity && corrects(seed) ? correctable.get(pairOf(seed)) : undefined;
        if (correcting) {
          // One correction per identity, however many invalid keys named it.
          correctable.delete(pairOf(seed));
          for (const skipped of correcting) results.set(skipped.id, Object.freeze({ ...skipped, correctedBy: id }));
          corrected.set(id, correcting);
        }
        const firstImport = !migrated || previous?.firstImport === true || !!correcting;
        changed = true;
        if (!seed.identity) {
          results.set(id, Object.freeze({ ...base, status: 'pending' as const, reason: 'unknown-adapter' as const, ...(firstImport ? { firstImport: true as const } : {}) }));
          input.logger.warn(`ai.personalPrincipals.${seed.key}：适配器 ${seed.adapterId.replace(/\0/gu, '/')} 未加载，下次启动再导入`);
          continue;
        }
        if (!firstImport) {
          // After the one-time first import a configuration edit never links by itself; only
          // entries of that first import (`unknown-adapter` retries, corrected keys) still do.
          results.set(id, Object.freeze({ ...base, adapter: seed.identity.adapter, status: 'pending' as const, reason: 'needs-confirmation' as const }));
          input.logger.warn(`ai.personalPrincipals.${seed.key}：新的或已修改的条目 ${source} 等待 Console 确认（需要你处理）`);
          continue;
        }
        if (seed.foreignRoot) input.logger.warn(`ai.personalPrincipals.${seed.key} 的 rootId 不是当前项目目录；已按适配器别名 ${seed.identity.adapter} 与 subjectId 导入`);
        const list = byUser.get(seed.key) ?? [];
        list.push(seed);
        byUser.set(seed.key, list);
      }
      let unread = false;
      for (const [key, seeds] of byUser) {
        const consoleUserId = consoleUserOfPersonalPrincipalKey(key)!;
        const outcome = await input.people.importPersonalPrincipal({ consoleUserId, identities: seeds.map(seed => seed.identity!), actor: 'import:ai.personalPrincipals' });
        if (outcome.needsConfirmation) {
          for (const seed of seeds) {
            results.set(personalPrincipalImportId(seed), Object.freeze({ id: personalPrincipalImportId(seed), consoleUserId, adapterId: seed.adapterId,
              subjectId: seed.subjectId, adapter: seed.identity!.adapter, status: 'pending' as const, reason: 'needs-confirmation' as const, at, firstImport: true as const }));
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
            ...(outcome.principalId ? { principalId: outcome.principalId } : {}), at, firstImport: true as const,
            ...(elsewhere ? { status: 'skipped' as const, reason: 'owned-elsewhere' as const } : { status: 'imported' as const }) }));
          const skipped = corrected.get(id)?.[0];
          if (skipped && !elsewhere) {
            unread = true;
            try { input.audit?.({ actor: 'import:ai.personalPrincipals', action: 'chat-roles.import', target: 'personal-principals', outcome: 'ok',
              detail: Object.freeze({ decision: 'corrected-key', consoleUserId, identity: `${seed.identity!.adapter}:${seed.subjectId}`,
                previousKey: skipped.consoleUserId, ...(outcome.principalId ? { principalId: outcome.principalId } : {}) }) }); } catch { /* never breaks */ }
          }
        }
        const fixedKeys = seeds.filter(seed => corrected.has(personalPrincipalImportId(seed))).length;
        input.logger.info(`ai.personalPrincipals.${key} 已导入：链接到聊天中的人 ${outcome.principalId}（不授予任何角色）${fixedKeys
          ? `；其中 ${fixedKeys} 条是首次导入时因键无效而跳过、现已改正的条目` : ''}`);
      }
      if (!changed && record.migratedAt !== undefined) return Object.freeze({ entries: record.entries, ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}) });
      // A corrected key links someone after the first import: it shows up as unread again.
      const acknowledgedAt = unread ? undefined : record.acknowledgedAt;
      const next: ImportRecord = { version: 1, entries: Object.freeze([...results.values()]),
        ...(acknowledgedAt ? { acknowledgedAt } : {}), migratedAt: record.migratedAt ?? at };
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
      // A decided identity (imported or ignored) can no longer be corrected by a later key edit.
      const entries = Object.freeze(record.entries.map(candidate => candidate.id === entry.id ? next
        : isSkippedFirstImport(candidate) && !candidate.correctedBy && pairOf(candidate) === pairOf(entry) ? Object.freeze({ ...candidate, correctedBy: entry.id }) : candidate));
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
