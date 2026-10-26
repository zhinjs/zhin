import { resolveLocale, type Locale } from 'zhin.js/i18n';
import type { DatabaseHostModel, DeliveryTarget, PluginDatabaseHost } from 'zhin.js';

export const ENTRY_TABLE = 'ledger_entries';
export const USER_TABLE = 'ledger_users';
/** Separate table: existing databases only run CREATE TABLE IF NOT EXISTS, so new columns on `ledger_users` would never appear. */
export const PRIVATE_TARGET_TABLE = 'ledger_private_targets';

/** One expense. `seq` is the per-user number shown as `#id`; amounts are integer cents. */
export interface LedgerEntry {
  readonly ownerKey: string;
  readonly seq: number;
  readonly category: string;
  readonly amountCents: number;
  readonly note: string;
  readonly createdAt: number;
}

/** Per-user settings: the next entry number and the opt-in daily report. */
export interface LedgerUserRecord {
  readonly ownerKey: string;
  readonly nextSeq: number;
  readonly reportEnabled: boolean;
  readonly reportLocale?: Locale;
  readonly reportTarget: DeliveryTarget | undefined;
  readonly lastReportDate: string;
}

/** Registers both tables; called from `setup()` before the database starts. */
export function defineLedgerTables(database: Pick<PluginDatabaseHost, 'define'>): void {
  database.define(ENTRY_TABLE, {
    owner_key: { type: 'text', nullable: false },
    seq: { type: 'integer', nullable: false },
    category: { type: 'text', nullable: false },
    amount_cents: { type: 'integer', nullable: false },
    note: { type: 'text', default: '' },
    created_at: { type: 'text', nullable: false },
  });
  database.define(USER_TABLE, {
    owner_key: { type: 'text', nullable: false },
    next_seq: { type: 'integer', default: 1 },
    report_enabled: { type: 'integer', default: 0 },
    report_locale: { type: 'text', length: 16, nullable: true },
    report_target: { type: 'text', default: '' },
    last_report_date: { type: 'text', default: '' },
  }, { addColumns: ['report_locale'] });
  database.define(PRIVATE_TARGET_TABLE, {
    owner_key: { type: 'text', nullable: false },
    target: { type: 'text', nullable: false },
  });
}

function toEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    ownerKey: String(row.owner_key),
    seq: Number(row.seq),
    category: String(row.category),
    amountCents: Number(row.amount_cents),
    note: String(row.note ?? ''),
    createdAt: Date.parse(String(row.created_at)),
  };
}

function parseTarget(raw: unknown): DeliveryTarget | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    return JSON.parse(raw) as DeliveryTarget;
  } catch {
    return undefined;
  }
}

function toUser(row: Record<string, unknown>): LedgerUserRecord {
  return {
    ownerKey: String(row.owner_key),
    nextSeq: Number(row.next_seq ?? 1),
    reportEnabled: Number(row.report_enabled ?? 0) === 1,
    reportLocale: resolveLocale(row.report_locale),
    reportTarget: parseTarget(row.report_target),
    lastReportDate: String(row.last_report_date ?? ''),
  };
}

/**
 * Every query filters on `owner_key`, the caller's own identity, so one user can never read,
 * number or delete another user's entries. Models are looked up per call because the
 * database only starts after `setup()`.
 */
export class LedgerStore {
  readonly #database: PluginDatabaseHost;

  constructor(database: PluginDatabaseHost) {
    this.#database = database;
  }

  #model(table: string): DatabaseHostModel {
    const model = this.#database.models.get(table);
    if (!model) throw new Error(`记账数据表 ${table} 不可用`);
    return model;
  }

  async getUser(ownerKey: string): Promise<LedgerUserRecord | undefined> {
    const rows = await this.#model(USER_TABLE)
      .select('owner_key', 'next_seq', 'report_enabled', 'report_locale', 'report_target', 'last_report_date')
      .where({ owner_key: ownerKey });
    const first = rows[0];
    return first ? toUser(first) : undefined;
  }

  async #ensureUser(ownerKey: string): Promise<LedgerUserRecord> {
    const existing = await this.getUser(ownerKey);
    if (existing) return existing;
    await this.#model(USER_TABLE).insert({
      owner_key: ownerKey,
      next_seq: 1,
      report_enabled: 0,
      report_target: '',
      last_report_date: '',
    });
    return { ownerKey, nextSeq: 1, reportEnabled: false, reportTarget: undefined, lastReportDate: '' };
  }

  /** Reserves the next per-user entry number. Callers serialise per user (see LedgerService). */
  async reserveSequence(ownerKey: string): Promise<number> {
    const user = await this.#ensureUser(ownerKey);
    const reserved = user.nextSeq;
    await this.#model(USER_TABLE).update({ next_seq: reserved + 1 }).where({ owner_key: ownerKey });
    return reserved;
  }

  async insertEntry(entry: LedgerEntry): Promise<void> {
    await this.#model(ENTRY_TABLE).insert({
      owner_key: entry.ownerKey,
      seq: entry.seq,
      category: entry.category,
      amount_cents: entry.amountCents,
      note: entry.note,
      created_at: new Date(entry.createdAt).toISOString(),
    });
  }

  async listEntries(ownerKey: string): Promise<LedgerEntry[]> {
    const rows = await this.#model(ENTRY_TABLE)
      .select('owner_key', 'seq', 'category', 'amount_cents', 'note', 'created_at')
      .where({ owner_key: ownerKey });
    return rows.map(toEntry);
  }

  async findEntry(ownerKey: string, seq: number): Promise<LedgerEntry | undefined> {
    const rows = await this.#model(ENTRY_TABLE)
      .select('owner_key', 'seq', 'category', 'amount_cents', 'note', 'created_at')
      .where({ owner_key: ownerKey, seq });
    const first = rows[0];
    return first ? toEntry(first) : undefined;
  }

  async deleteEntry(ownerKey: string, seq: number): Promise<void> {
    await this.#model(ENTRY_TABLE).delete().where({ owner_key: ownerKey, seq });
  }

  async setReport(ownerKey: string, enabled: boolean, target: DeliveryTarget | undefined, lastReportDate: string, locale?: Locale): Promise<void> {
    await this.#ensureUser(ownerKey);
    await this.#model(USER_TABLE).update({
      report_enabled: enabled ? 1 : 0,
      ...(enabled ? { report_locale: resolveLocale(locale) } : {}),
      report_target: target ? JSON.stringify(target) : '',
      last_report_date: lastReportDate,
    }).where({ owner_key: ownerKey });
  }

  /** The real private conversation saved when the user talked to the bot in private. */
  async getPrivateTarget(ownerKey: string): Promise<DeliveryTarget | undefined> {
    const rows = await this.#model(PRIVATE_TARGET_TABLE).select('owner_key', 'target').where({ owner_key: ownerKey });
    return parseTarget(rows[0]?.target);
  }

  /** Saves the real private conversation; an enabled daily report follows it. */
  async setPrivateTarget(ownerKey: string, target: DeliveryTarget): Promise<void> {
    const raw = JSON.stringify(target);
    const model = this.#model(PRIVATE_TARGET_TABLE);
    const existing = await model.select('owner_key', 'target').where({ owner_key: ownerKey });
    if (existing.length > 0) await model.update({ target: raw }).where({ owner_key: ownerKey });
    else await model.insert({ owner_key: ownerKey, target: raw });
    const user = await this.getUser(ownerKey);
    if (user?.reportEnabled) {
      await this.#model(USER_TABLE).update({ report_target: raw }).where({ owner_key: ownerKey });
    }
  }

  async listReportSubscribers(): Promise<LedgerUserRecord[]> {
    const rows = await this.#model(USER_TABLE)
      .select('owner_key', 'next_seq', 'report_enabled', 'report_locale', 'report_target', 'last_report_date')
      .where({ report_enabled: 1 });
    return rows.map(toUser);
  }

  async markReported(ownerKey: string, dateKey: string): Promise<void> {
    await this.#model(USER_TABLE).update({ last_report_date: dateKey }).where({ owner_key: ownerKey });
  }
}
