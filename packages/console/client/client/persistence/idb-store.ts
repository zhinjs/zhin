import {
  SIDE_EVENT_PUSH,
  normalizeConsolePushType,
} from "@zhin.js/console-protocol";

const DB_NAME = "zhin-console";
const DB_VERSION = 2;
const STORE_INBOX = "inbox";
const STORE_PENDING = "pending";

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
        (r as { endpointId?: string }).endpointId === endpoint_id) &&
      r.kind === kind,
  );
}

export async function applyConsoleEvent(event: { type: string; data?: unknown }): Promise<void> {
  const t = normalizeConsolePushType(event.type);
  if (
    t === SIDE_EVENT_PUSH.MESSAGE_RECEIVE
    || t === SIDE_EVENT_PUSH.REQUEST_RECEIVE
    || t === SIDE_EVENT_PUSH.NOTICE_RECEIVE
  ) {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data) return;
    const adapter = String(data.$adapter ?? data.adapter ?? "");
    const endpoint_id = String(data.$endpoint ?? data.endpoint_id ?? data.endpointId ?? data.bot ?? "");
    const id = `${adapter}:${endpoint_id}:${t}:${Date.now()}`;
    await idbPutInbox({
      id,
      adapter,
      endpoint_id,
      kind: t === SIDE_EVENT_PUSH.MESSAGE_RECEIVE
        ? "message"
        : t === SIDE_EVENT_PUSH.REQUEST_RECEIVE ? "request" : "notice",
      payload: data,
      updatedAt: Date.now(),
    });
  }
}
