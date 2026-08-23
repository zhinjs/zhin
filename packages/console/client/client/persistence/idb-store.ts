import { parseConsoleInboxEvent } from "@zhin.js/console-protocol";

const DB_NAME = "zhin-console";
const DB_VERSION = 2;
const STORE_INBOX = "inbox";
const STORE_PENDING = "pending";

let inboxEventSeq = 0;

export type InboxRecord = {
  id: string;
  adapter: string;
  endpoint_id: string;
  kind: "message" | "request" | "notice";
  payload: unknown;
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INBOX)) {
        db.createObjectStore(STORE_INBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: "id" });
      }
    };
  });
}

export async function idbPutInbox(record: InboxRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_INBOX, "readwrite");
    tx.objectStore(STORE_INBOX).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function idbListInbox(
  adapter: string,
  endpoint_id: string,
  kind: InboxRecord["kind"],
): Promise<InboxRecord[]> {
  const db = await openDb();
  const all = await new Promise<InboxRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_INBOX, "readonly");
    const req = tx.objectStore(STORE_INBOX).getAll();
    req.onsuccess = () => resolve((req.result as InboxRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all.filter(
    (r) =>
      r.adapter === adapter &&
      (r.endpoint_id === endpoint_id ||
        (r as { endpointKey?: string }).endpointKey === endpoint_id) &&
      r.kind === kind,
  );
}

export async function applyConsoleEvent(event: {
  type: string;
  data?: unknown;
  runtimeId?: string;
  eventId?: number;
  timestamp?: number;
}): Promise<void> {
  const parsed = parseConsoleInboxEvent(event);
  if (!parsed) return;
  const updatedAt = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? event.timestamp
    : Date.now();
  const resumableId = typeof event.runtimeId === 'string'
    && event.runtimeId
    && Number.isSafeInteger(event.eventId)
    && (event.eventId ?? 0) > 0
    ? `${event.runtimeId}:${event.eventId}`
    : null;
  await idbPutInbox({
    // Resumable Host events are idempotent across history/live redelivery.
    // Legacy/unsequenced sources retain collision-safe append ids.
    id: resumableId
      ?? `${parsed.adapter}:${parsed.endpointKey}:${parsed.type}:${updatedAt}:${inboxEventSeq++}:${Math.random().toString(36).slice(2, 8)}`,
    adapter: parsed.adapter,
    endpoint_id: parsed.endpointKey,
    kind: parsed.kind,
    payload: parsed.payload,
    updatedAt,
  });
}
