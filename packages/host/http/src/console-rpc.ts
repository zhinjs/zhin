import type { AuthScope } from './token-registry.js';
import type { DatabaseHostConsole } from '@zhin.js/plugin-runtime';
import {
  type ConsoleEndpointSummary,
  assertDemoConsoleRpcAllowed,
  endpointSendResult,
  normalizeConsoleRpcMessage,
} from '@zhin.js/console-protocol';
import { dispatchExtendedConsoleRpc, type ConsoleRpcExtendedCtx } from './console-rpc-extended.js';

export type RuntimeConsoleRpcMessage = {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly [key: string]: unknown;
};

export type RuntimeConsoleRpcReply = Record<string, unknown>;

export type RuntimeConsolePage = {
  readonly id: string;
  readonly localName: string;
  readonly title: string;
  readonly route: string;
  readonly module: string;
  readonly order: number;
  readonly hash: string;
};

export type RuntimeConsoleRpcContext = {
  readonly authScope: AuthScope;
  listPages(): Promise<readonly RuntimeConsolePage[]>;
  /** Optional project config accessors for read-only config RPCs. */
  readConfigYaml?(): Promise<string>;
  listPluginKeys?(): Promise<readonly string[]>;
  readConfigDocument?(): Promise<Record<string, unknown>>;
  /**
   * Full-scope write: replace project config file contents (YAML or JSON text).
   * Runtime Host does not hot-reload the process — callers should restart.
   */
  writeConfigYaml?(yaml: string): Promise<void>;
  /**
   * Full-scope write: set `document[pluginName] = data` and persist.
   * Returns whether a process restart is required (always true without ConfigFeature).
   */
  setConfigKey?(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }>;
  /** Project file manager (allowlisted paths under project root). */
  listProjectFiles?(): Promise<readonly unknown[]>;
  readProjectFile?(filePath: string): Promise<{ content: string; size: number }>;
  saveProjectFile?(filePath: string, content: string): Promise<void>;
  listEnvFiles?(): Promise<readonly { name: string; exists: boolean }[]>;
  readEnvFile?(filename: string): Promise<string>;
  writeEnvFile?(filename: string, content: string): Promise<void>;
  /** Optional schema accessors (plugin schema.json / Runtime schema registry). */
  getSchema?(pluginName?: string): Promise<unknown>;
  getAllSchemas?(): Promise<Record<string, unknown>>;
  /** Optional Adapter endpoint Console surface (Sandbox / Remote Console). */
  listEndpoints?(): Promise<readonly RuntimeEndpointSummary[]>;
  getEndpoint?(adapter: string, endpointId: string): Promise<RuntimeEndpointSummary | null>;
  sendEndpointMessage?(input: RuntimeEndpointSendInput): Promise<{ messageId: string }>;
  /** Optional Database host surface (CLI wires DatabaseHost from plugin-runtime). */
  dbInfo?(): Promise<RuntimeDatabaseInfo> | RuntimeDatabaseInfo;
  dbTables?(): Promise<readonly string[]> | readonly string[];
  database?: DatabaseHostConsole;
  /** Full-scope: request process restart (CLI daemon watches exit code). */
  requestRestart?(): Promise<void> | void;
  /**
   * Optional console event sink (`/api/events` SSE fan-out). Called after
   * successful mutations: `config:updated` / `system:restarting`.
   */
  publishEvent?(type: string, data: unknown): void;
  /** Extended RPC surface（cron/schedule、endpoint 社交/inbox），fullScope 由 authScope 推导。 */
  extended?: Omit<ConsoleRpcExtendedCtx, 'fullScope'>;
};

export type RuntimeEndpointPhase = NonNullable<ConsoleEndpointSummary['phase']>;

/** @deprecated Prefer `ConsoleEndpointSummary` from `@zhin.js/console-protocol`. */
export type RuntimeEndpointSummary = ConsoleEndpointSummary;

export type RuntimeDatabaseInfo = {
  readonly dialect: string | null;
  readonly connected: boolean;
  readonly tables: number;
};

export type RuntimeEndpointSendInput = {
  readonly adapter: string;
  readonly endpointId: string;
  readonly channelId: string;
  readonly channelType: string;
  readonly content: unknown;
  readonly parent?: { type?: string; id?: string; name?: string };
};

export function pickRpcReply(
  message: RuntimeConsoleRpcMessage,
  payloads: readonly RuntimeConsoleRpcReply[],
): RuntimeConsoleRpcReply | null {
  const requestId = message.requestId;
  return (
    (requestId != null ? payloads.find((payload) => payload.requestId === requestId) : undefined)
    ?? payloads[payloads.length - 1]
    ?? null
  );
}

export async function dispatchRuntimeConsoleRpc(
  message: RuntimeConsoleRpcMessage,
  ctx: RuntimeConsoleRpcContext,
): Promise<RuntimeConsoleRpcReply[]> {
  const payloads: RuntimeConsoleRpcReply[] = [];
  const emit = (payload: RuntimeConsoleRpcReply) => {
    payloads.push(payload);
  };
  message = normalizeConsoleRpcMessage(message);
  const type = String(message.type ?? '');
  const requestId = message.requestId as number | string | undefined;

  if (ctx.authScope === 'demo') {
    const denied = assertDemoConsoleRpcAllowed(type);
    if (denied) {
      emit({ requestId, error: denied });
      return payloads;
    }
  }

  // Extended RPC surface (cron/schedule、endpoint 社交/inbox)
  if (ctx.extended) {
    const extended = await dispatchExtendedConsoleRpc(
      type,
      message as Record<string, unknown>,
      { ...ctx.extended, fullScope: ctx.authScope === 'full' },
    );
    if (extended !== undefined) {
      emit('error' in extended
        ? { requestId, error: extended.error }
        : { requestId, data: extended.data });
      return payloads;
    }
  }

  switch (type) {
    case 'ping':
      emit({ type: 'pong', requestId });
      return payloads;
    case 'entries:get': {
      const pages = await ctx.listPages();
      emit({
        requestId,
        data: pages.map((page) => Object.freeze({
          id: page.localName,
          module: page.module,
          order: page.order,
          enabled: true,
          meta: Object.freeze({ name: page.title }),
          route: page.route,
          hash: page.hash,
        })),
      });
      return payloads;
    }
    case 'pages:list': {
      const pages = await ctx.listPages();
      emit({ requestId, data: pages });
      return payloads;
    }
    case 'config:get-yaml': {
      try {
        const yaml = ctx.readConfigYaml ? await ctx.readConfigYaml() : '';
        const pluginKeys = ctx.listPluginKeys ? await ctx.listPluginKeys() : [];
        emit({ requestId, data: { yaml, pluginKeys } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'config:get-all': {
      try {
        const document = ctx.readConfigDocument ? await ctx.readConfigDocument() : {};
        emit({ requestId, data: document });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'config:get': {
      try {
        // 兼容 console UI 的 data:{plugin} / data:{key} 形状
        const data = (message.data ?? {}) as Record<string, unknown>;
        const key = String(message.key ?? message.pluginName ?? data.pluginName ?? data.plugin ?? data.key ?? '');
        const document = ctx.readConfigDocument ? await ctx.readConfigDocument() : {};
        emit({ requestId, data: key ? document[key] : document });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'config:save-yaml': {
      try {
        const yaml = message.yaml;
        if (typeof yaml !== 'string') {
          emit({ requestId, error: 'yaml field is required' });
          return payloads;
        }
        if (!ctx.writeConfigYaml) {
          emit({ requestId, error: 'Config write is not configured' });
          return payloads;
        }
        await ctx.writeConfigYaml(yaml);
        ctx.publishEvent?.('config:updated', { pluginName: null, keys: [] });
        emit({
          requestId,
          data: { success: true, message: '配置已保存，需重启生效' },
        });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'config:set': {
      try {
        const pluginName = message.pluginName;
        if (typeof pluginName !== 'string' || !pluginName) {
          emit({ requestId, error: 'Plugin name is required' });
          return payloads;
        }
        if (!ctx.setConfigKey) {
          emit({ requestId, error: 'Config write is not configured' });
          return payloads;
        }
        const result = await ctx.setConfigKey(pluginName, message.data);
        ctx.publishEvent?.('config:updated', {
          pluginName,
          keys: message.data && typeof message.data === 'object' && !Array.isArray(message.data)
            ? Object.keys(message.data as Record<string, unknown>)
            : [],
        });
        emit({
          requestId,
          data: {
            success: true,
            reloaded: false,
            message: result.restartRequired
              ? '配置已保存，需重启进程才能生效'
              : '配置已保存',
          },
        });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to set config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
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
      return payloads;
    }
    case 'files:read': {
      try {
        const filePath = String(message.filePath ?? '');
        if (!filePath) {
          emit({ requestId, error: 'filePath is required' });
          return payloads;
        }
        if (!ctx.readProjectFile) {
          emit({ requestId, error: 'File read is not configured' });
          return payloads;
        }
        const file = await ctx.readProjectFile(filePath);
        emit({ requestId, data: file });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'files:save': {
      try {
        const filePath = String(message.filePath ?? '');
        const content = message.content;
        if (!filePath) {
          emit({ requestId, error: 'filePath is required' });
          return payloads;
        }
        if (typeof content !== 'string') {
          emit({ requestId, error: 'content field is required' });
          return payloads;
        }
        if (!ctx.saveProjectFile) {
          emit({ requestId, error: 'File write is not configured' });
          return payloads;
        }
        await ctx.saveProjectFile(filePath, content);
        emit({ requestId, data: { success: true, message: `文件已保存: ${filePath}` } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
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
      return payloads;
    }
    case 'env:get': {
      try {
        const filename = String(message.filename ?? '');
        if (!filename) {
          emit({ requestId, error: 'filename is required' });
          return payloads;
        }
        if (!ctx.readEnvFile) {
          emit({ requestId, error: 'Env read is not configured' });
          return payloads;
        }
        const content = await ctx.readEnvFile(filename);
        emit({ requestId, data: { content } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read env file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'env:save': {
      try {
        const filename = String(message.filename ?? '');
        const content = message.content;
        if (!filename) {
          emit({ requestId, error: 'filename is required' });
          return payloads;
        }
        if (typeof content !== 'string') {
          emit({ requestId, error: 'content field is required' });
          return payloads;
        }
        if (!ctx.writeEnvFile) {
          emit({ requestId, error: 'Env write is not configured' });
          return payloads;
        }
        await ctx.writeEnvFile(filename, content);
        emit({ requestId, data: { success: true, message: `环境文件已保存: ${filename}` } });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save env file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case 'schema:get': {
      try {
        // 兼容 console UI 的 data:{plugin} / data:{pluginName} 形状（SDK 发顶层 pluginName）
        const data = (message.data ?? {}) as Record<string, unknown>;
        const candidate = message.pluginName ?? data.pluginName ?? data.plugin;
        const pluginName = typeof candidate === 'string' ? candidate : undefined;
        const schema = ctx.getSchema ? await ctx.getSchema(pluginName) : null;
        emit({ requestId, data: schema });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to get schema: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
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
      return payloads;
    }
    case 'db:info': {
      if (ctx.database) {
        emit({ requestId, data: ctx.database.info() });
        return payloads;
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
        return payloads;
      }
      emit({
        requestId,
        data: { dialect: null, connected: false, message: 'Database not configured on Plugin Runtime Host' },
      });
      return payloads;
    }
    case 'db:tables': {
      try {
        if (ctx.database) {
          emit({ requestId, data: { tables: ctx.database.tables() } });
          return payloads;
        }
        const tables = ctx.dbTables ? await ctx.dbTables() : [];
        emit({ requestId, data: tables });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return payloads;
    }
    case 'db:select': {
      const table = stringField(message, 'table');
      if (!table) return errorReply(payloads, requestId, 'table is required');
      const page = positiveInteger(message.page, 1);
      const pageSize = Math.min(positiveInteger(message.pageSize, 50), 500);
      const where = recordField(message.where);
      if (!ctx.database) {
        emit({ requestId, data: { rows: [], total: 0, page, pageSize } });
        return payloads;
      }
      try {
        emit({ requestId, data: await ctx.database.select(table, page, pageSize, where) });
      } catch (error) {
        emit({ requestId, error: `Failed to select: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:insert': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      const row = recordField(message.row);
      if (!table || !row) return errorReply(payloads, requestId, 'table and row are required');
      try {
        await ctx.database.insert(table, row);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to insert: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:update': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      const row = recordField(message.row);
      const where = recordField(message.where);
      if (!table || !row || !where) {
        return errorReply(payloads, requestId, 'table, row, and where are required');
      }
      try {
        const affected = await ctx.database.update(table, row, where);
        emit({ requestId, data: { success: true, affected } });
      } catch (error) {
        emit({ requestId, error: `Failed to update: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:delete': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      const where = recordField(message.where);
      if (!table || !where) return errorReply(payloads, requestId, 'table and where are required');
      try {
        const deleted = await ctx.database.delete(table, where);
        emit({ requestId, data: { success: true, deleted } });
      } catch (error) {
        emit({ requestId, error: `Failed to delete: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:drop-table': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      if (!table) return errorReply(payloads, requestId, 'table is required');
      try {
        await ctx.database.dropTable(table);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to drop table: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:kv:get': {
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) return errorReply(payloads, requestId, 'table and key are required');
      if (!ctx.database) {
        emit({ requestId, data: { key, value: null } });
        return payloads;
      }
      try {
        emit({ requestId, data: { key, value: await ctx.database.kvGet(table, key) } });
      } catch (error) {
        emit({ requestId, error: `Failed to get kv: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:kv:set': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) return errorReply(payloads, requestId, 'table and key are required');
      try {
        const ttl = typeof message.ttl === 'number' && Number.isFinite(message.ttl)
          ? message.ttl
          : undefined;
        await ctx.database.kvSet(table, key, message.value, ttl);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to set kv: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:kv:delete': {
      if (!ctx.database) return errorReply(payloads, requestId, 'Database RPC is not available on Plugin Runtime Host');
      const table = stringField(message, 'table');
      const key = stringField(message, 'key');
      if (!table || !key) return errorReply(payloads, requestId, 'table and key are required');
      try {
        await ctx.database.kvDelete(table, key);
        emit({ requestId, data: { success: true } });
      } catch (error) {
        emit({ requestId, error: `Failed to delete kv: ${errorMessage(error)}` });
      }
      return payloads;
    }
    case 'db:kv:entries': {
      const table = stringField(message, 'table');
      if (!table) return errorReply(payloads, requestId, 'table is required');
      if (!ctx.database) {
        emit({ requestId, data: { entries: [] } });
        return payloads;
      }
      try {
        emit({ requestId, data: { entries: await ctx.database.kvEntries(table) } });
      } catch (error) {
        emit({ requestId, error: `Failed to get entries: ${errorMessage(error)}` });
      }
      return payloads;
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
      return payloads;
    }
    case 'endpoint.info': {
      try {
        const data = message as Record<string, unknown>;
        const adapter = String(data.$adapter ?? '');
        const endpointId = String(data.$endpoint ?? '');
        if (!adapter || !endpointId) {
          emit({ requestId, error: '$adapter and $endpoint required' });
          return payloads;
        }
        if (!ctx.getEndpoint) {
          emit({ requestId, error: 'Endpoint registry is not configured' });
          return payloads;
        }
        const endpoint = await ctx.getEndpoint(adapter, endpointId);
        if (!endpoint) {
          emit({ requestId, error: 'endpoint not found' });
          return payloads;
        }
        emit({ requestId, data: endpoint });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return payloads;
    }
    case 'endpoint.send_message': {
      try {
        const data = message as Record<string, unknown>;
        const adapter = String(data.$adapter ?? '');
        const endpointId = String(data.$endpoint ?? '');
        const channelId = String(data.$channel_id ?? '');
        const channelType = String(data.$channel_type ?? '');
        const content = data.$content;
        // channelType is optional: ImRuntime tolerates an empty value and
        // targets the bare channel id (parity with the legacy RPC handler).
        if (!adapter || !endpointId || !channelId || content === undefined) {
          emit({
            requestId,
            error: '$adapter, $endpoint, $channel_id, $content required',
          });
          return payloads;
        }
        if (!ctx.sendEndpointMessage) {
          emit({ requestId, error: 'Endpoint send is not configured' });
          return payloads;
        }
        const result = await ctx.sendEndpointMessage({
          adapter,
          endpointId,
          channelId,
          channelType,
          content,
          parent: data.$parent as
            { type?: string; id?: string; name?: string } | undefined,
        });
        // Legacy contract: { message_id }. Keep messageId for new callers.
        emit({ requestId, data: endpointSendResult(result.messageId) });
      } catch (error) {
        emit({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return payloads;
    }
    case 'system:restart': {
      try {
        if (!ctx.requestRestart) {
          emit({ requestId, error: 'Process restart is not configured' });
          return payloads;
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
      return payloads;
    }
    default:
      if (type.startsWith('db:')) {
        emit({
          requestId,
          error: 'Database RPC is not available on Plugin Runtime Host yet',
        });
        return payloads;
      }
      emit({ requestId, error: `Unknown RPC type: ${type || '<empty>'}` });
      return payloads;
  }
}

function stringField(message: RuntimeConsoleRpcMessage, key: string): string {
  const value = message[key];
  return typeof value === 'string' ? value.trim() : '';
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorReply(
  payloads: RuntimeConsoleRpcReply[],
  requestId: number | string | undefined,
  error: string,
): RuntimeConsoleRpcReply[] {
  payloads.push({ requestId, error });
  return payloads;
}

/** HTTP paths under apiBase that demo scope may call (ADR 0016). */
export function isDemoHttpAllowed(method: string, pathname: string, apiBase: string): boolean {
  const normalizedBase = apiBase.replace(/\/$/u, '') || '/api';
  const m = method.toUpperCase();
  if (m === 'GET' && pathname === `${normalizedBase}/events`) return true;
  if (m === 'POST' && pathname === `${normalizedBase}/console/request`) return true;
  // Read-only dashboard / plugin inspection routes (legacy host-api parity).
  if (m === 'GET' && pathname === `${normalizedBase}/system/status`) return true;
  if (m === 'GET' && pathname === `${normalizedBase}/stats`) return true;
  if (m === 'GET' && (pathname === `${normalizedBase}/plugins`
    || pathname.startsWith(`${normalizedBase}/plugins/`))) return true;
  return false;
}
