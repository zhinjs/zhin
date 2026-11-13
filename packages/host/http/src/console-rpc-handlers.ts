import {
  CONFIG_PATCH_LIMITS,
  ENDPOINT_RPC,
  type ConsoleConfigApplicationStatus,
} from '@zhin.js/console-protocol';
import type {
  ConversationAddress,
  RuntimeConsoleRpcContext,
  RuntimeConsoleRpcMessage,
  RuntimeConsoleRpcReply,
} from './console-rpc.js';

/** Canonical Console wire fields → runtime conversation address. */
export function wireConversation(
  channelType: string,
  channelId: string,
  parent: unknown,
): ConversationAddress {
  const kind: ConversationAddress['kind'] =
    channelType === 'group' || channelType === 'channel' ? channelType : 'private';
  const wire = parent && typeof parent === 'object'
    ? parent as { readonly type?: unknown; readonly id?: unknown }
    : undefined;
  const parentKind = wire?.type === 'group' || wire?.type === 'channel' ? wire.type : undefined;
  const parentId = typeof wire?.id === 'string' && wire.id ? wire.id : undefined;
  return {
    kind,
    id: channelId,
    ...(parentKind && parentId ? { parent: { kind: parentKind, id: parentId } } : {}),
  };
}

const FORBIDDEN_PATCH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Structural check for `config:patch-project` operations at the RPC boundary, so no project
 * port implementation receives a malformed request. The store repeats the full validation.
 */
export function invalidProjectPatchOperations(patches: readonly unknown[]): string | undefined {
  if (patches.length === 0) return 'patches 必须是非空数组';
  if (patches.length > CONFIG_PATCH_LIMITS.maxOperations) return `一次最多 ${CONFIG_PATCH_LIMITS.maxOperations} 个 patch`;
  for (const [index, item] of patches.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return `patches[${index}] 必须是对象`;
    const operation = item as Record<string, unknown>;
    const path = operation.path;
    if (!Array.isArray(path) || path.length === 0 || path.length > CONFIG_PATCH_LIMITS.maxPathDepth
      || path.some(segment => typeof segment !== 'string' || !segment
        || segment.length > CONFIG_PATCH_LIMITS.maxSegmentLength || FORBIDDEN_PATCH_SEGMENTS.has(segment))) {
      return `patches[${index}].path 必须是 1–${CONFIG_PATCH_LIMITS.maxPathDepth} 段的有效字符串数组`;
    }
    if (operation.op === 'set') {
      if (!Object.hasOwn(operation, 'value') || operation.value === undefined) return `patches[${index}] 的 set 需要 value`;
    } else if (operation.op !== 'remove') return `patches[${index}].op 只能是 set 或 remove`;
  }
  return undefined;
}

export async function dispatchHostResourceConsoleRpc(
  type: string,
  message: RuntimeConsoleRpcMessage,
  ctx: RuntimeConsoleRpcContext,
  requestId: number | string | undefined,
  payloads: RuntimeConsoleRpcReply[],
): Promise<boolean> {
  const emit = (payload: RuntimeConsoleRpcReply) => {
    payloads.push(payload);
  };

  switch (type) {
    case 'files:tree': {
      try {
        const tree = ctx.listProjectFiles ? await ctx.listProjectFiles() : [];
        emit({ requestId, data: { tree } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to build file tree: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'files:read': {
      try {
        const filePath = String(message.filePath ?? '');
        if (!filePath) {
          emit({ requestId, error: 'filePath is required' });
          return true;
        }
        if (!ctx.readProjectFile) {
          emit({ requestId, error: 'File read is not configured' });
          return true;
        }
        const file = await ctx.readProjectFile(filePath);
        emit({ requestId, data: file });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'files:save': {
      try {
        const filePath = String(message.filePath ?? '');
        const content = message.content;
        if (!filePath) {
          emit({ requestId, error: 'filePath is required' });
          return true;
        }
        if (typeof content !== 'string') {
          emit({ requestId, error: 'content field is required' });
          return true;
        }
        if (!ctx.saveProjectFile) {
          emit({ requestId, error: 'File write is not configured' });
          return true;
        }
        await ctx.saveProjectFile(filePath, content);
        emit({ requestId, data: { success: true, message: `文件已保存: ${filePath}` } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'env:list': {
      try {
        const files = ctx.listEnvFiles ? await ctx.listEnvFiles() : [];
        emit({ requestId, data: { files } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to list env files: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'env:get': {
      try {
        const filename = String(message.filename ?? '');
        if (!filename) {
          emit({ requestId, error: 'filename is required' });
          return true;
        }
        if (!ctx.readEnvFile) {
          emit({ requestId, error: 'Env read is not configured' });
          return true;
        }
        const content = await ctx.readEnvFile(filename);
        emit({ requestId, data: { content } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read env file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'env:save': {
      try {
        const filename = String(message.filename ?? '');
        const content = message.content;
        if (!filename) {
          emit({ requestId, error: 'filename is required' });
          return true;
        }
        if (typeof content !== 'string') {
          emit({ requestId, error: 'content field is required' });
          return true;
        }
        if (!ctx.writeEnvFile) {
          emit({ requestId, error: 'Env write is not configured' });
          return true;
        }
        await ctx.writeEnvFile(filename, content);
        emit({ requestId, data: { success: true, message: `环境文件已保存: ${filename}` } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save env file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'schema:get': {
      try {
        const pluginName = typeof message.pluginName === 'string'
          ? message.pluginName
          : undefined;
        const schema = ctx.getSchema ? await ctx.getSchema(pluginName) : null;
        emit({ requestId, data: schema });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to get schema: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'schema:get-all': {
      try {
        const schemas = ctx.getAllSchemas ? await ctx.getAllSchemas() : {};
        emit({ requestId, data: schemas });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to get all schemas: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return true;
    }
    case 'db:info': {
      if (ctx.database) {
        emit({ requestId, data: ctx.database.info() });
        return true;
      }
      if (ctx.dbInfo) {
        try {
          emit({ requestId, data: await ctx.dbInfo() });
        } catch (error) {
          emit({
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true;
      }
      emit({
        requestId,
        data: { dialect: null, connected: false, message: 'Database not configured on Plugin Runtime Host' },
      });
      return true;
    }
    case 'db:tables': {
      try {
        if (ctx.database) {
          emit({ requestId, data: { tables: ctx.database.tables() } });
          return true;
        }
        const tables = ctx.dbTables ? await ctx.dbTables() : [];
        // Same `{ tables }` envelope as the database branch above; clients read `.tables`.
        emit({ requestId, data: { tables } });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    case 'db:select': {
      const table = stringField(message, 'table');
      if (!table) { errorReply(payloads, requestId, 'table is required'); return true; }
      const page = positiveInteger(message.page, 1);
      const pageSize = Math.min(positiveInteger(message.pageSize, 50), 500);
      const where = recordField(message.where);
      const order = recordField(message.orderBy);
      if (message.orderBy !== undefined && message.orderBy !== null
        && (!order || typeof order.column !== 'string' || (order.direction !== 'asc' && order.direction !== 'desc'))) {
        errorReply(payloads, requestId, 'orderBy must be { column, direction: "asc" | "desc" }');
        return true;
      }
      if (!ctx.database) {
        emit({ requestId, data: { rows: [], total: 0, page, pageSize } });
        return true;
      }
      try {
        const orderBy = order ? { column: order.column as string, direction: order.direction as 'asc' | 'desc' } : undefined;
        emit({ requestId, data: await ctx.database.select(table, page, pageSize, where, orderBy) });
      } catch (error) {
        emit({ requestId, error: `Failed to select: ${errorMessage(error)}`, ...refusalData(error) });
      }
      return true;
    }
    case 'db:query': {
      const sql = sqlField(message);
      if (!sql) { errorReply(payloads, requestId, `sql is required (at most ${MAX_CONSOLE_SQL_LENGTH} characters)`); return true; }
      if (!ctx.database?.query) { unsupportedDatabaseFeature(payloads, requestId, 'SQL query'); return true; }
      try {
        const maxRows = typeof message.maxRows === 'number' ? message.maxRows : undefined;
        emit({ requestId, data: await ctx.database.query(sql, maxRows ? { maxRows } : undefined) });
      } catch (error) {
        emit({ requestId, error: errorMessage(error), ...refusalData(error) });
      }
      return true;
    }
    case 'db:execute': {
      const sql = sqlField(message);
      if (!sql) { errorReply(payloads, requestId, `sql is required (at most ${MAX_CONSOLE_SQL_LENGTH} characters)`); return true; }
      if (!ctx.database?.execute) { unsupportedDatabaseFeature(payloads, requestId, 'SQL execution'); return true; }
      try {
        emit({ requestId, data: await ctx.database.execute(sql, { dryRun: message.dryRun === true }) });
      } catch (error) {
        emit({ requestId, error: errorMessage(error), ...refusalData(error) });
      }
      return true;
    }
    case 'db:schema:describe': {
      const table = stringField(message, 'table');
      if (!table) { errorReply(payloads, requestId, 'table is required'); return true; }
      if (!ctx.database?.describe) { unsupportedDatabaseFeature(payloads, requestId, 'Schema inspection'); return true; }
      try {
        emit({ requestId, data: await ctx.database.describe(table) });
      } catch (error) {
        emit({ requestId, error: errorMessage(error), ...refusalData(error) });
      }
      return true;
    }
    case 'db:schema:preview':
    case 'db:schema:apply': {
      const change = recordField(message.change);
      if (!change) { errorReply(payloads, requestId, 'change is required'); return true; }
      const database = ctx.database;
      if (!database?.previewSchema || !database.applySchema) { unsupportedDatabaseFeature(payloads, requestId, 'Schema editing'); return true; }
      try {
        const plan = type === 'db:schema:apply'
          ? await database.applySchema(change, typeof message.confirm === 'string' ? message.confirm : undefined)
          : await database.previewSchema(change);
        emit({ requestId, data: plan });
      } catch (error) {
        emit({ requestId, error: errorMessage(error), ...refusalData(error) });
      }
      return true;
    }
    case 'db:insert': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      const row = recordField(message.row);
      if (!table || !row) { errorReply(payloads, requestId, 'table and row are required'); return true; }
      try {
        await ctx.database.insert(table, row);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to insert: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:update': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      const row = recordField(message.row);
      const where = recordField(message.where);
      if (!table || !row || !where) {
        errorReply(payloads, requestId, 'table, row, and where are required');
        return true;
      }
      try {
        const affected = await ctx.database.update(table, row, where);
        emit({ requestId, data: { success: true, affected } });
      } catch (error) {
        emit({ requestId, error: `Failed to update: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:delete': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      const where = recordField(message.where);
      if (!table || !where) { errorReply(payloads, requestId, 'table and where are required'); return true; }
      try {
        const deleted = await ctx.database.delete(table, where);
        emit({ requestId, data: { success: true, deleted } });
      } catch (error) {
        emit({ requestId, error: `Failed to delete: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:drop-table': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      if (!table) { errorReply(payloads, requestId, 'table is required'); return true; }
      try {
        await ctx.database.dropTable(table);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to drop table: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:kv:get': {
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) { errorReply(payloads, requestId, 'table and key are required'); return true; }
      if (!ctx.database) {
        emit({ requestId, data: { key, value: null } });
        return true;
      }
      try {
        emit({ requestId, data: { key, value: await ctx.database.kvGet(table, key) } });
      } catch (error) {
        emit({ requestId, error: `Failed to get kv: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:kv:set': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) { errorReply(payloads, requestId, 'table and key are required'); return true; }
      try {
        const ttl = typeof message.ttl === 'number' && Number.isFinite(message.ttl)
          ? message.ttl
          : undefined;
        await ctx.database.kvSet(table, key, message.value, ttl);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to set kv: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:kv:delete': {
      if (!ctx.database) { errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host'); return true; }
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) { errorReply(payloads, requestId, 'table and key are required'); return true; }
      try {
        await ctx.database.kvDelete(table, key);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to delete kv: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'db:kv:entries': {
      const table = stringField(message, 'table');
      if (!table) { errorReply(payloads, requestId, 'table is required'); return true; }
      if (!ctx.database) {
        emit({ requestId, data: { entries: [] } });
        return true;
      }
      try {
        emit({ requestId, data: { entries: await ctx.database.kvEntries(table) } });
      } catch (error) {
        emit({ requestId, error: `Failed to get entries: ${errorMessage(error)}` });
      }
      return true;
    }
    case 'endpoint.list': {
      try {
        const endpoints = ctx.listEndpoints ? await ctx.listEndpoints() : [];
        emit({ requestId, data: { endpoints } });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    case 'endpoint.info': {
      try {
        const data = recordField(message.data) ?? message;
        const adapter = String(data.adapter ?? '');
        const endpointKey = String(data.endpointKey ?? '');
        if (!adapter || !endpointKey) {
          emit({ requestId, error: 'adapter and endpointKey are required' });
          return true;
        }
        if (!ctx.getEndpoint) {
          emit({ requestId, error: 'Endpoint registry is not configured' });
          return true;
        }
        const endpoint = await ctx.getEndpoint(adapter, endpointKey);
        if (!endpoint) {
          emit({ requestId, error: 'endpoint not found' });
          return true;
        }
        emit({ requestId, data: endpoint });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    case ENDPOINT_RPC.TEST: {
      const data = recordField(message.data) ?? message;
      const adapter = stringField(data, 'adapter');
      const endpointKey = stringField(data, 'endpointKey');
      if (!adapter || !endpointKey) {
        emit({ requestId, error: 'adapter and endpointKey are required' });
        return true;
      }
      if (!ctx.getEndpoint) {
        emit({ requestId, error: 'Endpoint registry is not configured' });
        return true;
      }
      const startedAt = Date.now();
      try {
        const endpoint = await ctx.getEndpoint(adapter, endpointKey);
        if (!endpoint) {
          emit({ requestId, data: {
            reachable: false,
            connected: false,
            phase: 'unconfigured',
            latencyMs: Date.now() - startedAt,
            message: 'Endpoint 未注册到当前 generation',
          } });
          return true;
        }
        emit({ requestId, data: {
          reachable: endpoint.connected && endpoint.status === 'online',
          connected: endpoint.connected,
          status: endpoint.status,
          admitted: endpoint.admitted,
          transportState: endpoint.transportState,
          phase: endpoint.phase ?? (endpoint.connected ? 'online' : 'pending'),
          pendingLogin: endpoint.pendingLogin ?? false,
          latencyMs: Date.now() - startedAt,
          message: endpoint.connected
            ? 'Endpoint 已连接'
            : endpoint.pendingLogin
              ? 'Endpoint 等待登录操作'
              : 'Endpoint 当前离线',
        } });
      } catch (error) {
        emit({ requestId, data: {
          reachable: false,
          connected: false,
          phase: 'failed',
          latencyMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        } });
      }
      return true;
    }
    case 'endpoint.send_message': {
      try {
        const data = recordField(message.data) ?? message;
        const adapter = String(data.adapter ?? '');
        const endpointKey = String(data.endpointKey ?? '');
        const channelId = String(data.channelId ?? data.id ?? '');
        const channelType = String(data.channelType ?? data.type ?? '');
        const content = data.content;
        if (!adapter || !endpointKey || !channelId || !channelType || content === undefined) {
          emit({
            requestId,
            error: 'adapter, endpointKey, channelId, channelType, and content are required',
          });
          return true;
        }
        if (!ctx.sendEndpointMessage) {
          emit({ requestId, error: 'Endpoint send is not configured' });
          return true;
        }
        const result = await ctx.sendEndpointMessage({
          adapter,
          endpointKey,
          conversation: wireConversation(channelType, channelId, data.parent),
          content,
        });
        emit({ requestId, data: { messageId: result.messageId } });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    case 'system:restart': {
      try {
        if (!ctx.requestRestart) {
          emit({ requestId, error: 'Process restart is not configured' });
          return true;
        }
        ctx.publishEvent?.('system:restarting', { timestamp: Date.now() });
        emit({ requestId, data: { success: true, message: '正在重启...' } });
        // Delay so the HTTP response can flush (parity with legacy host-api).
        setTimeout(() => {
          void Promise.resolve(ctx.requestRestart?.()).catch(() => {
            /* restart is best-effort */
          });
        }, 500);
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    default:
      return false;
  }
}

/** Longest statement text the Console SQL editor sends. */
export const MAX_CONSOLE_SQL_LENGTH = 100_000;

function sqlField(message: RuntimeConsoleRpcMessage): string {
  const value = message.sql;
  return typeof value === 'string' && value.trim() && value.length <= MAX_CONSOLE_SQL_LENGTH ? value : '';
}

const REFUSAL_NAMES: ReadonlySet<string> = new Set(['ConsoleSqlRefusal', 'ConsoleSchemaRefusal', 'ConsoleSelectRefusal', 'SqliteQueryTimeoutError']);

/**
 * `data.code` of a refusal by the database port (`read_only`, `protected_table`, …), and the DDL a
 * failed `db:schema:apply` attempted (`data.statements`, for the audit log).
 */
/** SQLSTATE of a driver error (PostgreSQL `code`, mysql2 `sqlState`), e.g. `42501` insufficient privilege. */
function sqlStateOf(error: Error): string | undefined {
  const record = error as { code?: unknown; sqlState?: unknown };
  for (const candidate of [record.sqlState, record.code]) {
    if (typeof candidate === 'string' && /^[0-9A-Z]{5}$/u.test(candidate)) return candidate;
  }
  return undefined;
}

function refusalData(error: unknown): { data?: { code?: string; statements?: readonly string[]; sqlState?: string } } {
  if (!(error instanceof Error)) return {};
  const attempted = (error as { statements?: unknown }).statements;
  const statements = Array.isArray(attempted) && attempted.every(entry => typeof entry === 'string') ? { statements: attempted as string[] } : {};
  if (error.name === 'GatewayOwnedTableError') return { data: { code: 'protected_table', ...statements } };
  const code = (error as { code?: unknown }).code;
  const refused = REFUSAL_NAMES.has(error.name) && typeof code === 'string';
  // The server's SQLSTATE lets the Console explain e.g. 42501 from the restricted account (ADR 0059 §4).
  const sqlState = refused ? undefined : sqlStateOf(error);
  const data = { ...(refused ? { code } : {}), ...(sqlState ? { sqlState } : {}), ...statements };
  return Object.keys(data).length ? { data } : {};
}

function unsupportedDatabaseFeature(payloads: RuntimeConsoleRpcReply[], requestId: number | string | undefined, feature: string): void {
  payloads.push({ requestId, error: `${feature} is not supported by this database Host`, data: { code: 'unsupported' } });
}

export function stringField(message: RuntimeConsoleRpcMessage, key: string): string {
  const value = message[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorReply(
  payloads: RuntimeConsoleRpcReply[],
  requestId: number | string | undefined,
  error: string,
): RuntimeConsoleRpcReply[] {
  payloads.push({ requestId, error });
  return payloads;
}

export function configurationSaveMessage(result: { restartRequired: boolean; revision?: string }
  & ConsoleConfigApplicationStatus): string {
  if (result.applicationError === 'superseded') return '配置已保存，但该次生效申请已被替代';
  if (result.applicationError === 'invalid') return '配置已保存，但配置校验失败，未生效';
  if (result.applicationError) return '配置已保存，生效结果未确认';
  if (result.application) {
    if (result.revision && result.application.sourceRevision !== result.revision) return '配置已保存，但已被较新修订替代';
    if (result.application.groups.some(group => group.status === 'unknown')) return '配置已保存，生效结果未确认';
    if (result.application.groups.some(group => group.status === 'superseded')) return '配置已保存，但该次生效申请已被替代';
    if (result.application.groups.some(group => ['failed', 'blocked'].includes(group.status))) return '配置已保存，部分配置未生效';
    if (result.restartRequired) return '配置已保存，部分配置待重启生效';
    return '配置已保存并已生效';
  }
  return result.restartRequired ? '配置已保存，需重启进程才能生效' : '配置已保存';
}

