/**
 * 控制台机器人请求/通知持久化
 * 优先使用 zhin 内置数据库（console_bot_requests / console_bot_notices 表），
 * 无数据库时回退到 JSON 文件存储。
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseFeature } from "@zhin.js/core";
import { TABLE_REQUESTS, TABLE_NOTICES } from "./bot-db-models.js";

export interface StoredRequestRow {
  id: number;
  adapter: string;
  bot_id: string;
  platform_request_id: string;
  type: string;
  sender_id: string;
  sender_name: string;
  comment: string;
  channel_id: string;
  channel_type: string;
  created_at: number;
  consumed: 0 | 1;
  consumed_at?: number;
}

export interface StoredNoticeRow {
  id: number;
  adapter: string;
  bot_id: string;
  notice_type: string;
  channel_type: string;
  channel_id: string;
  payload: string;
  created_at: number;
  consumed: 0 | 1;
  consumed_at?: number;
}

interface StoreFile<T> {
  nextId: number;
  rows: T[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const REQ_FILE = path.join(DATA_DIR, "console_bot_requests.json");
const NOTICE_FILE = path.join(DATA_DIR, "console_bot_notices.json");

let dbRef: DatabaseFeature | null = null;

export function initBotPersistence(root: { inject: (key: string) => unknown }) {
  try {
    dbRef = root.inject("database") as DatabaseFeature | null;
  } catch {
    dbRef = null;
  }
}

function getReqModel() {
  return dbRef?.db?.models?.get(TABLE_REQUESTS) as
    | {
        create: (row: Record<string, unknown>) => Promise<{ id: number }>;
        select: () => { where: (q: Record<string, unknown>) => Promise<StoredRequestRow[]> };
        update: (row: Record<string, unknown>) => { where: (q: Record<string, unknown>) => Promise<unknown> };
      }
    | undefined;
}

function getNoticeModel() {
  return dbRef?.db?.models?.get(TABLE_NOTICES) as
    | {
        create: (row: Record<string, unknown>) => Promise<{ id: number }>;
        select: () => { where: (q: Record<string, unknown>) => Promise<StoredNoticeRow[]> };
        update: (row: Record<string, unknown>) => { where: (q: Record<string, unknown>) => Promise<unknown> };
      }
    | undefined;
}

// --------------- 文件回退 ---------------
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFile<T>(file: string, empty: StoreFile<T>): StoreFile<T> {
  try {
    if (!fs.existsSync(file)) return { ...empty };
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as StoreFile<T>;
    if (!j || !Array.isArray(j.rows)) return { ...empty };
    return {
      nextId: typeof j.nextId === "number" ? j.nextId : 1,
      rows: j.rows,
    };
  } catch {
    return { ...empty };
  }
}

function saveFile<T>(file: string, store: StoreFile<T>) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(store, null, 0), "utf-8");
}

function normalizeReqRow(r: StoredRequestRow & { consumed?: number }): StoredRequestRow {
  return {
    ...r,
    id: r.id!,
    consumed: (r.consumed === 1 ? 1 : 0) as 0 | 1,
  };
}

function normalizeNoticeRow(r: StoredNoticeRow & { consumed?: number }): StoredNoticeRow {
  return {
    ...r,
    id: r.id!,
    consumed: (r.consumed === 1 ? 1 : 0) as 0 | 1,
  };
}

// --------------- 请求 ---------------
export async function insertRequest(
  row: Omit<StoredRequestRow, "id" | "consumed" | "consumed_at">
): Promise<StoredRequestRow> {
  const model = getReqModel();
  if (model) {
    const created = await model.create({
      ...row,
      consumed: 0,
    });
    const id = typeof created?.id === "number" ? created.id : (created as unknown as { id: number }).id;
    return { ...row, id, consumed: 0 };
  }
  const store = loadFile<StoredRequestRow>(REQ_FILE, { nextId: 1, rows: [] });
  const id = store.nextId++;
  const full: StoredRequestRow = { ...row, id, consumed: 0 };
  store.rows.push(full);
  saveFile(REQ_FILE, store);
  return full;
}

export async function insertNotice(
  row: Omit<StoredNoticeRow, "id" | "consumed" | "consumed_at">
): Promise<StoredNoticeRow> {
  const model = getNoticeModel();
  if (model) {
    const created = await model.create({
      ...row,
      consumed: 0,
    });
    const id = typeof created?.id === "number" ? created.id : (created as unknown as { id: number }).id;
    return { ...row, id, consumed: 0 };
  }
  const store = loadFile<StoredNoticeRow>(NOTICE_FILE, { nextId: 1, rows: [] });
  const id = store.nextId++;
  const full: StoredNoticeRow = { ...row, id, consumed: 0 };
  store.rows.push(full);
  saveFile(NOTICE_FILE, store);
  return full;
}

export async function listUnconsumedRequests(): Promise<StoredRequestRow[]> {
  const model = getReqModel();
  if (model) {
    const rows = await model.select().where({ consumed: 0 });
    return (rows || []).map(normalizeReqRow).sort((a, b) => a.created_at - b.created_at);
  }
  const store = loadFile<StoredRequestRow>(REQ_FILE, { nextId: 1, rows: [] });
  return store.rows
    .filter((r) => r.consumed === 0)
    .sort((a, b) => a.created_at - b.created_at);
}

export async function listUnconsumedNotices(): Promise<StoredNoticeRow[]> {
  const model = getNoticeModel();
  if (model) {
    const rows = await model.select().where({ consumed: 0 });
    return (rows || []).map(normalizeNoticeRow).sort((a, b) => a.created_at - b.created_at);
  }
  const store = loadFile<StoredNoticeRow>(NOTICE_FILE, { nextId: 1, rows: [] });
  return store.rows
    .filter((r) => r.consumed === 0)
    .sort((a, b) => a.created_at - b.created_at);
}

export async function listRequestsForBot(
  adapter: string,
  botId: string
): Promise<StoredRequestRow[]> {
  const all = await listUnconsumedRequests();
  return all.filter((r) => r.adapter === adapter && r.bot_id === botId);
}

export async function markRequestsConsumed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const model = getReqModel();
  const now = Date.now();
  if (model) {
    for (const id of ids) {
      await model.update({ consumed: 1, consumed_at: now }).where({ id });
    }
    return;
  }
  const store = loadFile<StoredRequestRow>(REQ_FILE, { nextId: 1, rows: [] });
  const set = new Set(ids);
  for (const r of store.rows) {
    if (set.has(r.id) && r.consumed === 0) {
      r.consumed = 1;
      r.consumed_at = now;
    }
  }
  saveFile(REQ_FILE, store);
}

export async function markNoticesConsumed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const model = getNoticeModel();
  const now = Date.now();
  if (model) {
    for (const id of ids) {
      await model.update({ consumed: 1, consumed_at: now }).where({ id });
    }
    return;
  }
  const store = loadFile<StoredNoticeRow>(NOTICE_FILE, { nextId: 1, rows: [] });
  const set = new Set(ids);
  for (const r of store.rows) {
    if (set.has(r.id) && r.consumed === 0) {
      r.consumed = 1;
      r.consumed_at = now;
    }
  }
  saveFile(NOTICE_FILE, store);
}

export async function findRequestRow(
  adapter: string,
  botId: string,
  platformRequestId: string
): Promise<StoredRequestRow | undefined> {
  const model = getReqModel();
  if (model) {
    const rows = await model.select().where({
      adapter,
      bot_id: botId,
      platform_request_id: platformRequestId,
      consumed: 0,
    });
    return rows?.[0] ? normalizeReqRow(rows[0]) : undefined;
  }
  const store = loadFile<StoredRequestRow>(REQ_FILE, { nextId: 1, rows: [] });
  const r = store.rows.find(
    (x) =>
      x.adapter === adapter &&
      x.bot_id === botId &&
      x.platform_request_id === platformRequestId &&
      x.consumed === 0
  );
  return r;
}

export async function getRequestRowById(id: number): Promise<StoredRequestRow | undefined> {
  const model = getReqModel();
  if (model) {
    const rows = await model.select().where({ id });
    return rows?.[0] ? normalizeReqRow(rows[0]) : undefined;
  }
  const store = loadFile<StoredRequestRow>(REQ_FILE, { nextId: 1, rows: [] });
  const r = store.rows.find((x) => x.id === id);
  return r;
}
