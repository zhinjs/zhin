import { createRelationalStateStore, TASK_TARGET_COLUMNS, TASK_RECEIPT_COLUMNS, encodeTaskTarget, decodeTaskTarget,
  encodeTaskReceipts, decodeTaskReceipts, encodeStorageIdentity, decodeStorageIdentity,
  type PluginDatabaseHost, type RelationalStateCodec } from 'zhin.js/plugin-runtime';
import { REMINDER_STATE_KEY, type ReminderBook } from './service.js';
import { ADMIN_REMINDER_STATE_KEY, type AdminReminderBook } from './admin-tasks.js';

const taskColumns = {
  id: { type: 'text', length: 36, primary: true }, position: { type: 'integer', nullable: false },
  ...TASK_TARGET_COLUMNS, sender_id: { type: 'text', nullable: true }, creation: { type: 'text', nullable: true },
  content: { type: 'text', nullable: false }, state: { type: 'text', length: 24, nullable: false },
  created_at: { type: 'bigint', nullable: false }, next_run_at: { type: 'bigint', nullable: false },
  interval_ms: { type: 'bigint', nullable: true }, claim_id: { type: 'text', nullable: true },
  last_run_at: { type: 'bigint', nullable: true }, detail: { type: 'text', nullable: false },
};

function codec(admin: boolean): RelationalStateCodec {
  const table = admin ? 'admin_reminder_tasks' : 'reminder_tasks';
  const receipts = 'admin_reminder_receipts';
  return {
    key: admin ? ADMIN_REMINDER_STATE_KEY : REMINDER_STATE_KEY,
    header: { table: `${table}_book`, definition: {
      version: { type: 'integer', nullable: true }, revision: { type: 'text', nullable: true },
    } },
    tables: { [table]: taskColumns, ...(admin ? { [receipts]: TASK_RECEIPT_COLUMNS } : {}) },
    encode(value) {
      const book = value as ReminderBook | AdminReminderBook;
      if (book.version !== 1 || !Array.isArray(book.tasks)) throw new Error('Unsupported reminder book; original state was preserved');
      return { header: { version: book.version, revision: 'revision' in book ? book.revision : null }, rows: {
        [table]: book.tasks.map((task, position) => ({ id: task.id, position, ...encodeTaskTarget(task.target),
          sender_id: 'senderId' in task ? encodeStorageIdentity(task.senderId) : null,
          creation: 'creation' in task ? task.creation : null, content: encodeStorageIdentity(task.text),
          state: 'status' in task ? task.status : task.state, created_at: task.createdAt, next_run_at: task.nextRunAt,
          interval_ms: task.intervalMs, claim_id: task.claimId, last_run_at: task.lastRunAt, detail: encodeStorageIdentity(task.detail) })),
        ...(admin ? { [receipts]: encodeTaskReceipts((book as AdminReminderBook).receipts) } : {}),
      } };
    },
    decode(header, rows) {
      return { version: Number(header.version), ...(admin ? { revision: String(header.revision) } : {}),
        tasks: rows[table]!.map(row => ({ id: String(row.id), target: decodeTaskTarget(row), text: decodeStorageIdentity(row.content),
          createdAt: Number(row.created_at), nextRunAt: Number(row.next_run_at), intervalMs: row.interval_ms == null ? null : Number(row.interval_ms),
          claimId: row.claim_id == null ? null : String(row.claim_id), lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at), detail: decodeStorageIdentity(row.detail),
          ...(admin ? { creation: String(row.creation), state: String(row.state) } : { senderId: decodeStorageIdentity(row.sender_id), status: String(row.state) }),
        })), ...(admin ? { receipts: decodeTaskReceipts(rows[receipts]!) } : {}),
      };
    },
  };
}

/** Both pools keep their existing CAS API but persist independent rows atomically. */
export function createReminderState(database: PluginDatabaseHost) {
  return createRelationalStateStore(database, [codec(false), codec(true)]);
}
