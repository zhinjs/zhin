import { createRelationalStateStore, TASK_TARGET_COLUMNS, TASK_RECEIPT_COLUMNS, encodeTaskTarget, decodeTaskTarget,
  encodeTaskReceipts, decodeTaskReceipts, encodeStorageIdentity, decodeStorageIdentity, type PluginDatabaseHost, type RelationalStateCodec } from 'zhin.js/plugin-runtime';
import { ADMIN_RSS_STATE_KEY, type AdministratorRssBook } from './admin-tasks.js';

const tasks = 'admin_rss_tasks', seen = 'admin_rss_seen', items = 'admin_rss_pending_items', receipts = 'admin_rss_receipts';
const text = { type: 'text', nullable: true } as const;
const time = { type: 'bigint', nullable: true } as const;
const child = { id: { type: 'text', length: 80, primary: true }, task_id: { type: 'text', length: 36, nullable: false }, position: { type: 'integer', nullable: false } };

const codec: RelationalStateCodec = {
  key: ADMIN_RSS_STATE_KEY,
  header: { table: 'admin_rss_book', definition: { version: { type: 'integer', nullable: true }, revision: text } },
  addColumns: { [tasks]: ['locale', 'detail_key'] },
  tables: {
    [tasks]: { id: { type: 'text', length: 36, primary: true }, position: { type: 'integer', nullable: false }, ...TASK_TARGET_COLUMNS,
      creation: text, version: text, locale: text, url: text, state: text, created_at: time, claim_id: text, last_check_at: time, last_run_at: time, detail: text, detail_key: text,
      seen_known: { type: 'boolean', nullable: false }, quiet_timezone: text, quiet_start: text, quiet_end: text,
      pending_kind: text, pending_from: time, pending_to: time, pending_count: { type: 'integer', nullable: true },
      pending_capped: { type: 'boolean', nullable: true } },
    [seen]: { ...child, item_key: { type: 'text', nullable: false } },
    [items]: { ...child, item_key: text, title: text, link: text },
    [receipts]: TASK_RECEIPT_COLUMNS,
  },
  encode(value) {
    const book = value as AdministratorRssBook;
    if (![1, 2].includes(book.version) || !Array.isArray(book.tasks) || !Array.isArray(book.receipts)) throw new Error('Unsupported RSS book; original state was preserved');
    return { header: { version: book.version, revision: book.revision }, rows: {
      [tasks]: book.tasks.map((task, position) => ({ id: task.id, position, ...encodeTaskTarget(task.target),
        creation: task.creation, version: task.version, locale: task.locale ?? 'zh-CN', url: encodeStorageIdentity(task.url), state: task.state, created_at: task.createdAt,
        claim_id: task.claimId, last_check_at: task.lastCheckAt, last_run_at: task.lastRunAt, detail: encodeStorageIdentity(task.detail), detail_key: task.detailKey ?? null,
        seen_known: task.seen !== null, quiet_timezone: task.quiet?.timezone ?? null, quiet_start: task.quiet?.start ?? null, quiet_end: task.quiet?.end ?? null,
        pending_kind: task.pending === undefined ? 'absent' : task.pending === null ? 'null' : 'value',
        pending_from: task.pending?.from ?? null, pending_to: task.pending?.to ?? null,
        pending_count: task.pending?.count ?? null, pending_capped: task.pending?.countCapped ?? null,
      })),
      [seen]: book.tasks.flatMap((task: AdministratorRssBook['tasks'][number]) => (task.seen ?? []).map((key, position) => ({ id: `${task.id}:${position}`, task_id: task.id, position, item_key: encodeStorageIdentity(key) }))),
      [items]: book.tasks.flatMap((task: AdministratorRssBook['tasks'][number]) => (task.pending?.items ?? []).map((item, position) => ({ id: `${task.id}:${position}`, task_id: task.id, position, item_key: encodeStorageIdentity(item.key), title: encodeStorageIdentity(item.title), link: encodeStorageIdentity(item.link) }))),
      [receipts]: encodeTaskReceipts(book.receipts),
    } };
  },
  decode(header, rows) {
    return { version: Number(header.version), revision: String(header.revision), receipts: decodeTaskReceipts(rows[receipts]!),
      tasks: rows[tasks]!.map(row => ({ id: String(row.id), target: decodeTaskTarget(row), creation: String(row.creation), version: String(row.version),
        url: decodeStorageIdentity(row.url), locale: row.locale == null ? 'zh-CN' : String(row.locale), state: String(row.state), createdAt: Number(row.created_at), claimId: row.claim_id == null ? null : String(row.claim_id),
        lastCheckAt: row.last_check_at == null ? null : Number(row.last_check_at), lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at), detail: decodeStorageIdentity(row.detail), ...(row.detail_key == null ? {} : { detailKey: String(row.detail_key) }),
        seen: row.seen_known ? rows[seen]!.filter(item => item.task_id === row.id).map(item => decodeStorageIdentity(item.item_key)) : null,
        ...(row.quiet_timezone == null ? {} : { quiet: { timezone: String(row.quiet_timezone), start: String(row.quiet_start), end: String(row.quiet_end) } }),
        ...(row.pending_kind === 'absent' ? {} : { pending: row.pending_kind === 'null' ? null : {
          from: Number(row.pending_from), to: Number(row.pending_to), count: Number(row.pending_count), countCapped: Boolean(row.pending_capped),
          items: rows[items]!.filter(item => item.task_id === row.id).map(item => ({ key: decodeStorageIdentity(item.item_key), title: decodeStorageIdentity(item.title), link: decodeStorageIdentity(item.link) })),
        } }),
      })),
    };
  },
};

export function createAdministratorRssState(database: PluginDatabaseHost) {
  return createRelationalStateStore(database, [codec]);
}
