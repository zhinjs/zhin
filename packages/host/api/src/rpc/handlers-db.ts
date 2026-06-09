import type { DatabaseFeature, Plugin } from "@zhin.js/core";
import type { ConsoleRpcContext } from "./context.js";
import type { KeyValueModel,DocumentModel,RelatedModel } from "@zhin.js/database";

type DbType = "related" | "document" | "keyvalue";

function reply(ctx: ConsoleRpcContext, payload: Record<string, unknown>) {
  ctx.emit(payload);
}

function getDb(root: Plugin): DatabaseFeature | null {
  const db = root.inject("database");
  return db ?? null;
}

function requireDb(root: Plugin): DatabaseFeature {
  const db = getDb(root);
  if (!db) throw new Error("数据库服务不可用");
  return db;
}

function getDbType(dbFeature: DatabaseFeature): DbType {
  const dialectName = dbFeature.db.dialect.name;
  if (["mongodb"].includes(dialectName)) return "document";
  if (["redis"].includes(dialectName)) return "keyvalue";
  return "related";
}

function getModel(dbFeature: DatabaseFeature, table: string): KeyValueModel | DocumentModel | RelatedModel | undefined {
  const model = dbFeature.db.models.get(table) as KeyValueModel | DocumentModel | RelatedModel | undefined;
  if (!model) throw new Error(`Table '${table}' not found`);
  return model as KeyValueModel | DocumentModel | RelatedModel;
}
export function getDatabaseInfo(root: Plugin) {
  const dbFeature = getDb(root);
  if (!dbFeature) {
    return {
      dialect: "none",
      type: "related" as const,
      tables: [] as string[],
      available: false,
    };
  }
  const db = dbFeature.db;
  return {
    dialect: db.dialectName,
    type: getDbType(dbFeature),
    tables: Array.from(db.models.keys()),
    available: true,
  };
}

export function getDatabaseTables(root: Plugin) {
  const dbFeature = getDb(root);
  if (!dbFeature) return [];
  const db = dbFeature.db;
  const tables: Array<{ name: string; columns?: Record<string, unknown> }> = [];
  for (const [name] of db.models) {
    const def = db.definitions.get(name);
    tables.push({
      name: name as string,
      columns: def
        ? Object.fromEntries(
            Object.entries(def).map(([col, colDef]) => [col, colDef]),
          )
        : undefined,
    });
  }
  return tables;
}

async function dbSelect(
  root: Plugin,
  table: string,
  page: number,
  pageSize: number,
  where?: Record<string, unknown>,
) {
  const dbFeature = requireDb(root);
  const db = dbFeature.db;
  const dbType = getDbType(dbFeature);
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === "keyvalue") {
    const kvModel = model as unknown as KeyValueModel;
    const allEntries = await kvModel.entries();
    const total = allEntries.length;
    const start = (page - 1) * pageSize;
    const rows = allEntries.slice(start, start + pageSize).map(([k, v]) => ({
      key: k,
      value: v,
    }));
    return { rows, total, page, pageSize };
  }

  let selection = model.select();
  if (where && Object.keys(where).length > 0) {
    selection = selection.where(where);
  }
  let total: number;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countResult = await (db as any).aggregate(table).count("*", "total").where(where || {});
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
  const rows = (await query.limit(pageSize).offset(offset)) as unknown[];
  return { rows, total, page, pageSize };
}

async function dbInsert(root: Plugin, table: string, row: Record<string, unknown>) {
  const dbFeature = requireDb(root);
  const dbType = getDbType(dbFeature);
  const model = dbFeature.db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === "keyvalue") {
    const kvModel = model as unknown as KeyValueModel;
    if (!row.key) throw new Error("key is required for KV insert");
    await kvModel.set(String(row.key), row.value);
    return;
  }
  if (dbType === "document") {
    await (model as unknown as DocumentModel).create(row);
    return;
  }
  await model.insert(row);
}

async function dbUpdate(
  root: Plugin,
  table: string,
  row: Record<string, unknown>,
  where: Record<string, unknown>,
) {
  const dbFeature = requireDb(root);
  const dbType = getDbType(dbFeature);
  const model = dbFeature.db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === "keyvalue") {
    const kvModel = model as unknown as KeyValueModel;
    if (!where.key) throw new Error("key is required for KV update");
    await kvModel.set(String(where.key), row.value);
    return 1;
  }
  if (dbType === "document" && where._id) {
    return await (model as unknown as DocumentModel).updateById(String(where._id), row);
  }
  return await model.update(row).where(where);
}

async function dbDelete(root: Plugin, table: string, where: Record<string, unknown>) {
  const dbFeature = requireDb(root);
  const dbType = getDbType(dbFeature);
  const model = dbFeature.db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === "keyvalue") {
    const kvModel = model as unknown as KeyValueModel;
    if (!where.key) throw new Error("key is required for KV delete");
    await kvModel.deleteByKey(String(where.key));
    return 1;
  }
  if (dbType === "document" && where._id) {
    return await (model as unknown as DocumentModel).deleteById(String(where._id));
  }
  return await model.delete(where);
}

async function dbDropTable(root: Plugin, table: string) {
  const dbFeature = requireDb(root);
  const db = dbFeature.db;
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);
  const sql = db.dialect.formatDropTable(table, true);
  await db.query(sql);
  db.models.delete(table);
  db.definitions.delete(table);
}

async function kvGet(root: Plugin, table: string, key: string) {
  const model = requireDb(root).db.models.get(table) as {
    get: (k: string) => Promise<unknown>;
  } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  return await model.get(key);
}

async function kvSet(
  root: Plugin,
  table: string,
  key: string,
  value: unknown,
  ttl?: number,
) {
  const model = requireDb(root).db.models.get(table) as {
    set: (k: string, v: unknown, ttl?: number) => Promise<void>;
  } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.set(key, value, ttl);
}

async function kvDelete(root: Plugin, table: string, key: string) {
  const model = requireDb(root).db.models.get(table) as {
    deleteByKey: (k: string) => Promise<void>;
  } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.deleteByKey(key);
}

async function kvGetEntries(root: Plugin, table: string) {
  const model = requireDb(root).db.models.get(table) as {
    entries: () => Promise<Array<[string, unknown]>>;
  } | undefined;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  const entries = await model.entries();
  return entries.map(([k, v]) => ({ key: k, value: v }));
}

/** db:* RPC（无 database 时读接口返回空、写接口报错） */
export async function handleDbRpc(
  message: Record<string, unknown>,
  ctx: ConsoleRpcContext,
): Promise<boolean> {
  const type = String(message.type ?? "");
  if (!type.startsWith("db:")) return false;

  const requestId = message.requestId as number | undefined;
  const { root } = ctx;

  switch (type) {
    case "db:info":
      try {
        reply(ctx, { requestId, data: getDatabaseInfo(root) });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to get db info: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:tables":
      try {
        reply(ctx, { requestId, data: { tables: getDatabaseTables(root) } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to list tables: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:select":
      try {
        const table = message.table as string;
        const page = Number(message.page ?? 1);
        const pageSize = Number(message.pageSize ?? 50);
        const where = message.where as Record<string, unknown> | undefined;
        if (!table) {
          reply(ctx, { requestId, error: "table is required" });
          return true;
        }
        if (!getDb(root)) {
          reply(ctx, {
            requestId,
            data: { rows: [], total: 0, page, pageSize },
          });
          return true;
        }
        const selectResult = await dbSelect(root, table, page, pageSize, where);
        reply(ctx, { requestId, data: selectResult });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to select: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:insert":
      try {
        const table = message.table as string;
        const row = message.row as Record<string, unknown>;
        if (!table || !row) {
          reply(ctx, { requestId, error: "table and row are required" });
          return true;
        }
        await dbInsert(root, table, row);
        reply(ctx, { requestId, data: { success: true } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to insert: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:update":
      try {
        const table = message.table as string;
        const row = message.row as Record<string, unknown>;
        const updateWhere = message.where as Record<string, unknown>;
        if (!table || !row || !updateWhere) {
          reply(ctx, { requestId, error: "table, row, and where are required" });
          return true;
        }
        const affected = await dbUpdate(root, table, row, updateWhere);
        reply(ctx, { requestId, data: { success: true, affected } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to update: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:delete":
      try {
        const table = message.table as string;
        const deleteWhere = message.where as Record<string, unknown>;
        if (!table || !deleteWhere) {
          reply(ctx, { requestId, error: "table and where are required" });
          return true;
        }
        const deleted = await dbDelete(root, table, deleteWhere);
        reply(ctx, { requestId, data: { success: true, deleted } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to delete: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:drop-table":
      try {
        const dropTableName = message.table as string;
        if (!dropTableName) {
          reply(ctx, { requestId, error: "table is required" });
          return true;
        }
        await dbDropTable(root, dropTableName);
        reply(ctx, { requestId, data: { success: true } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to drop table: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:kv:get":
      try {
        const table = message.table as string;
        const key = message.key as string;
        if (!table || !key) {
          reply(ctx, { requestId, error: "table and key are required" });
          return true;
        }
        if (!getDb(root)) {
          reply(ctx, { requestId, data: { key, value: null } });
          return true;
        }
        const kvValue = await kvGet(root, table, key);
        reply(ctx, { requestId, data: { key, value: kvValue } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to get kv: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:kv:set":
      try {
        const table = message.table as string;
        const key = message.key as string;
        const value = message.value;
        const ttl = message.ttl as number | undefined;
        if (!table || !key) {
          reply(ctx, { requestId, error: "table and key are required" });
          return true;
        }
        await kvSet(root, table, key, value, ttl);
        reply(ctx, { requestId, data: { success: true } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to set kv: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:kv:delete":
      try {
        const table = message.table as string;
        const key = message.key as string;
        if (!table || !key) {
          reply(ctx, { requestId, error: "table and key are required" });
          return true;
        }
        await kvDelete(root, table, key);
        reply(ctx, { requestId, data: { success: true } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to delete kv: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    case "db:kv:entries":
      try {
        const table = message.table as string;
        if (!table) {
          reply(ctx, { requestId, error: "table is required" });
          return true;
        }
        if (!getDb(root)) {
          reply(ctx, { requestId, data: { entries: [] } });
          return true;
        }
        const kvEntries = await kvGetEntries(root, table);
        reply(ctx, { requestId, data: { entries: kvEntries } });
      } catch (error: unknown) {
        reply(ctx, { requestId, error: `Failed to get entries: ${error instanceof Error ? error.message : String(error)}` });
      }
      return true;

    default:
      return false;
  }
}
