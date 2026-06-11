/**
 * WebSocket 数据库操作模块
 * 从 websocket.ts 提取的数据库 CRUD 和 KV 操作
 */

import type { DatabaseFeature } from "@zhin.js/core";

type DbType = 'related' | 'document' | 'keyvalue';

export function getDb(getRoot: () => { inject(name: string): unknown }): DatabaseFeature {
  return getRoot().inject('database') as DatabaseFeature;
}

export function getDbType(getRoot: () => { inject(name: string): unknown }): DbType {
  const dbFeature = getDb(getRoot);
  const dialectName = dbFeature.db.dialect.name;
  if (['mongodb'].includes(dialectName)) return 'document';
  if (['redis'].includes(dialectName)) return 'keyvalue';
  return 'related';
}

export function getDatabaseInfo(getRoot: () => { inject(name: string): unknown }) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  return {
    dialect: db.dialectName,
    type: getDbType(getRoot),
    tables: Array.from(db.models.keys()),
  };
}

export function getDatabaseTables(getRoot: () => { inject(name: string): unknown }) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const tables: Array<{ name: string; columns?: Record<string, unknown> }> = [];
  for (const [name] of db.models) {
    const def = db.definitions.get(name);
    tables.push({ name: name as string, columns: def ? Object.fromEntries(Object.entries(def).map(([col, colDef]) => [col, colDef])) : undefined });
  }
  return tables;
}

export async function dbSelect(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  page: number,
  pageSize: number,
  where?: Record<string, unknown>,
) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const dbType = getDbType(getRoot);
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as { entries: () => Promise<Array<[string, unknown]>> };
    const allEntries = await kvModel.entries();
    const total = allEntries.length;
    const start = (page - 1) * pageSize;
    const rows = allEntries.slice(start, start + pageSize).map(([k, v]) => ({ key: k, value: v }));
    return { rows, total, page, pageSize };
  }

  let selection = model.select();
  if (where && Object.keys(where).length > 0) {
    selection = selection.where(where);
  }
  let total: number;
  try {
    const countResult = await (db as { aggregate: (t: string) => { count: (c: string, a: string) => { where: (w: unknown) => Promise<Array<{ total: number }>> } } }).aggregate(table).count('*', 'total').where(where || {});
    total = countResult?.[0]?.total ?? 0;
  } catch {
    const all = await model.select();
    total = (all as unknown[]).length;
  }
  const offset = (page - 1) * pageSize;
  let query = model.select();
  if (where && Object.keys(where).length > 0) {
    query = query.where(where);
  }
  const rows = await query.limit(pageSize).offset(offset) as unknown[];
  return { rows, total, page, pageSize };
}

export async function dbInsert(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  row: Record<string, unknown>,
) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const dbType = getDbType(getRoot);
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as { set: (k: string, v: unknown) => Promise<void> };
    if (!row.key) throw new Error('key is required for KV insert');
    await kvModel.set(String(row.key), row.value);
    return;
  }

  if (dbType === 'document') {
    await (model as { create: (r: Record<string, unknown>) => Promise<void> }).create(row);
    return;
  }

  await model.insert(row);
}

export async function dbUpdate(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  row: Record<string, unknown>,
  where: Record<string, unknown>,
) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const dbType = getDbType(getRoot);
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as { set: (k: string, v: unknown) => Promise<void> };
    if (!where.key) throw new Error('key is required for KV update');
    await kvModel.set(String(where.key), row.value);
    return 1;
  }

  if (dbType === 'document') {
    if (where._id) {
      return await (model as { updateById: (id: unknown, r: Record<string, unknown>) => Promise<number> }).updateById(where._id, row);
    }
  }

  return await model.update(row).where(where);
}

export async function dbDelete(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  where: Record<string, unknown>,
) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const dbType = getDbType(getRoot);
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as { deleteByKey: (k: string) => Promise<void> };
    if (!where.key) throw new Error('key is required for KV delete');
    await kvModel.deleteByKey(String(where.key));
    return 1;
  }

  if (dbType === 'document') {
    if (where._id) {
      return await (model as { deleteById: (id: unknown) => Promise<number> }).deleteById(where._id);
    }
  }

  return await model.delete(where);
}

export async function dbDropTable(
  getRoot: () => { inject(name: string): unknown },
  table: string,
) {
  const dbFeature = getDb(getRoot);
  const db = dbFeature.db;
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);
  const sql = db.dialect.formatDropTable(table, true);
  await db.query(sql);
  db.models.delete(table);
  db.definitions.delete(table);
}

export async function kvGet(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  key: string,
) {
  const dbFeature = getDb(getRoot);
  const model = dbFeature.db.models.get(table) as { get: (k: string) => Promise<unknown> } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  return await model.get(key);
}

export async function kvSet(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  key: string,
  value: unknown,
  ttl?: number,
) {
  const dbFeature = getDb(getRoot);
  const model = dbFeature.db.models.get(table) as { set: (k: string, v: unknown, ttl?: number) => Promise<void> } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.set(key, value, ttl);
}

export async function kvDelete(
  getRoot: () => { inject(name: string): unknown },
  table: string,
  key: string,
) {
  const dbFeature = getDb(getRoot);
  const model = dbFeature.db.models.get(table) as { deleteByKey: (k: string) => Promise<void> } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.deleteByKey(key);
}

export async function kvGetEntries(
  getRoot: () => { inject(name: string): unknown },
  table: string,
) {
  const dbFeature = getDb(getRoot);
  const model = dbFeature.db.models.get(table) as { entries: () => Promise<Array<[string, unknown]>> } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  const entries = await model.entries();
  return entries.map(([k, v]) => ({ key: k, value: v }));
}
