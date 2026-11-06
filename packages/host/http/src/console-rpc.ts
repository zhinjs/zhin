import type { AuthScope } from './token-registry.js';
import type { DatabaseHostConsole } from '@zhin.js/plugin-runtime';
import {
  CONFIG_PATCH_LIMITS,
  CONFIG_RPC,
  type ConsoleConfigPatchRequest,
  type ConsoleConfigPatchResult,
  type ConsoleConfigProjectPatchResult,
  type ConsoleConfigSource,
  type ConsoleConfigExplanation,
  type ConsoleEndpointSummary,
  assertDemoConsoleRpcAllowed,
} from '@zhin.js/console-protocol';
import { dispatchExtendedConsoleRpc, type ConsoleRpcExtendedCtx } from './console-rpc-extended/index.js';
import { dispatchPluginConsoleRpc } from './console-plugin-rpc.js';
import {
  configurationSaveMessage,
  dispatchHostResourceConsoleRpc,
  invalidProjectPatchOperations,
} from './console-rpc-handlers.js';

export { isDemoHttpAllowed } from './console-rpc-handlers.js';

/**
 * Console RPC 请求结构：未锚定 endpoint 的会话地址（结构对齐
 * `Omit<ConversationRef,'endpoint'>`；host/http 架构分层不允许依赖
 * `@zhin.js/im-contract`，故本地结构化声明，endpoint 由 ImRuntime 锚定）。
 */
export interface ConversationAddress {
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{
    readonly kind: 'group' | 'channel';
    readonly id: string;
  }>;
  readonly threadId?: string;
}

export type RuntimeConsoleRpcMessage = {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly [key: string]: unknown;
};

export type RuntimeConsoleRpcReply = Record<string, unknown>;

export interface PluginInstallPlan {
  readonly projectRevision?: string;
  readonly configurationRevision?: string | null;
  readonly packageName: string;
  readonly instanceKey: string;
  readonly alreadyDeclared: boolean;
  readonly alreadyInstalled: boolean;
  readonly restartRequired: boolean;
  readonly changes: Readonly<{
    readonly packageManifest: 'unchanged' | 'add-plugin';
    readonly config: 'unchanged' | 'create-entry' | 'schema-required';
  }>;
  readonly warnings: readonly string[];
}

export interface PluginUninstallPlan {
  readonly projectRevision?: string;
  readonly configurationRevision?: string | null;
  readonly packageName: string;
  readonly instanceKey: string;
  readonly installed: boolean;
  readonly declared: boolean;
  readonly hasConfig: boolean;
  readonly restartRequired: boolean;
}

export interface PluginUpdatePlan {
  readonly projectRevision?: string;
  readonly configurationRevision?: string | null;
  readonly packageName: string;
  readonly instanceKey: string;
  readonly currentVersion: string | null;
  readonly targetVersion: string;
  readonly installed: boolean;
  readonly declared: boolean;
  readonly alreadyCurrent: boolean;
  readonly restartRequired: boolean;
}

export interface PluginManagementState {
  readonly packageName: string;
  readonly instanceKey: string;
  readonly installed: boolean;
  readonly plugin: boolean;
  readonly declared: boolean;
  readonly version: string | null;
  readonly revision: string | null;
  readonly projectRevision: string;
  readonly status: 'not-installed' | 'installed' | 'declared' | 'missing-config' | 'pending-restart' | 'enabled' | 'degraded';
  readonly dependencies: 'unchecked' | 'passed' | 'failed';
  readonly validation: PluginConfigValidation | null;
  readonly generation: number | null;
  readonly published: boolean;
  readonly readiness: 'unknown' | 'ready' | 'pending' | 'degraded';
  readonly restartRequired: boolean;
  readonly disabled: boolean;
  readonly issues: readonly string[];
  /** Publication is never proof of a successful business action. */
  readonly verification: 'not-configured' | 'available';
}

export interface PluginVerificationPlan {
  readonly packageName: string;
  readonly instanceKey: string;
  readonly generation: number | null;
  readonly projectRevision: string;
  readonly checkRevision: string;
  readonly checks: readonly import('@zhin.js/plugin-runtime').PluginVerificationCheck[];
}

export interface PluginVerificationResult {
  readonly packageName: string;
  readonly instanceKey: string;
  readonly checkId: string;
  readonly generation: number | null;
  readonly current: boolean;
  readonly status: 'passed' | 'failed' | 'not-configured';
  readonly scope: 'local' | 'platform' | null;
  readonly summary: string;
  readonly summaryI18n?: import('@zhin.js/plugin-runtime').PluginVerificationOutcome['summaryI18n'];
  readonly evidence: readonly string[];
  readonly evidenceI18n?: import('@zhin.js/plugin-runtime').PluginVerificationOutcome['evidenceI18n'];
}

export interface PluginManagementPort {
  explainConfiguration?(instanceKey: string, expectedRevision: string): Promise<ConsoleConfigExplanation>;
  inspect?(packageName: string): Promise<PluginManagementState>;
  apply?(packageName: string, expectedProjectRevision?: string): Promise<{ readonly requested: boolean; readonly state: PluginManagementState }>;
  verificationPlan?(packageName: string): Promise<PluginVerificationPlan>;
  verify?(packageName: string, checkId: string, expectedGeneration: number | null, expectedProjectRevision: string, expectedCheckRevision: string): Promise<PluginVerificationResult>;
  planInstall(packageName: string): Promise<PluginInstallPlan>;
  install?(packageName: string, expectedRevision?: string, expectedProjectRevision?: string): Promise<Readonly<{
    readonly plan: PluginInstallPlan;
    readonly restartRequired: boolean;
  }>>;
  planUninstall?(packageName: string): Promise<PluginUninstallPlan>;
  uninstall?(packageName: string, expectedRevision?: string, expectedProjectRevision?: string): Promise<Readonly<{
    readonly plan: PluginUninstallPlan;
    readonly restartRequired: boolean;
  }>>;
  planUpdate?(packageName: string, targetVersion: string): Promise<PluginUpdatePlan>;
  update?(packageName: string, targetVersion: string, expectedRevision?: string, expectedProjectRevision?: string): Promise<Readonly<{
    readonly plan: PluginUpdatePlan;
    readonly installedVersion: string;
    readonly restartRequired: boolean;
  }>>;
}

export interface PluginConfigValidation {
  /** False means only environment-reference checks ran; Runtime must validate TS-only declarations. */
  readonly schemaAvailable?: boolean;
  readonly valid: boolean;
  readonly errors: readonly { readonly path: string; readonly message: string }[];
  readonly missingEnv: readonly string[];
}

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
  readConfigSource?(): Promise<ConsoleConfigSource>;
  readConfigDocument?(): Promise<Record<string, unknown>>;
  /** Full-scope, revision-checked replacement of the active Root config source. */
  replaceConfigSource?(
    source: string,
    expectedRevision: string,
  ): Promise<{ readonly revision: string; readonly restartRequired: boolean } & import('@zhin.js/console-protocol').ConsoleConfigApplicationStatus>;
  /**
   * Full-scope write: set `document[pluginName] = data` and persist.
   * Returns whether a process restart is required.
   */
  setConfigKey?(pluginName: string, data: unknown): Promise<{ restartRequired: boolean } & import('@zhin.js/console-protocol').ConsoleConfigApplicationStatus>;
  /**
   * Full-scope, path-allowlisted and revision-checked write (`config:patch`).
   * Scope and schema checks belong to the implementation; scope violations throw.
   */
  patchConfig?(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult>;
  /** Full-scope, revision-checked project administration, distinct from page allowlists. */
  patchProjectConfig?(request: Omit<ConsoleConfigPatchRequest, 'instanceKey'>): Promise<ConsoleConfigProjectPatchResult>;
  /** Full-scope project read (`config:get-project`); masked unless `reveal`. */
  readProjectConfig?(request: import('@zhin.js/console-protocol').ConsoleConfigProjectReadRequest): Promise<import('@zhin.js/console-protocol').ConsoleConfigProjectRead>;
  applyConfig?(expectedRevision: string): Promise<import('@zhin.js/console-protocol').ConsoleConfigApplyResult>;
  /** Persist a declared child Plugin lifecycle state. Takes effect after restart. */
  setPluginEnabled?(
    instanceKey: string,
    enabled: boolean,
  ): Promise<Readonly<{ disabled: readonly string[] }>>;
  /** Read-only install planning shared by Console Web and CLI surfaces. */
  pluginManagement?: PluginManagementPort;
  validatePluginConfig?(pluginName: string, data: unknown): Promise<PluginConfigValidation>;
  diagnosePlugin?(pluginName: string): Promise<unknown>;
  /** Atomic, revision-checked runtime Workroom Catalog read/write. */
  readWorkroomCatalog?(): Promise<Readonly<{
    agents: Readonly<Record<string, unknown>>;
    workrooms: Readonly<Record<string, unknown>>;
    revision: string;
    /** Principal bound to the authenticated Console token, never caller supplied. */
    principalId?: string;
  }>>;
  setWorkroomCatalog?(
    workrooms: unknown,
    expectedRevision: string,
  ): Promise<Readonly<{ revision: string; restartRequired: boolean }>>;
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
  listEndpoints?(): Promise<readonly ConsoleEndpointSummary[]>;
  getEndpoint?(adapter: string, endpointKey: string): Promise<ConsoleEndpointSummary | null>;
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

export type RuntimeDatabaseInfo = {
  readonly dialect: string | null;
  readonly connected: boolean;
  readonly tables: number;
};

export type RuntimeEndpointSendInput = {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: ConversationAddress;
  readonly content: unknown;
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

  const pluginReply = await dispatchPluginConsoleRpc(type, message, ctx);
  if (pluginReply !== undefined) {
    emit(pluginReply);
    return payloads;
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
    case CONFIG_RPC.EXPLAIN: {
      if (ctx.authScope !== 'full') { emit({ requestId, error: 'Full scope required' }); return payloads; }
      const { instanceKey, expectedRevision } = message;
      if (typeof instanceKey !== 'string' || instanceKey.length > 128 || !/^[a-z0-9][a-z0-9-]*$/u.test(instanceKey)
        || typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision)) {
        emit({ requestId, error: '精确 instanceKey 与已读取的 expectedRevision 必填' }); return payloads;
      }
      if (!ctx.pluginManagement?.explainConfiguration) { emit({ requestId, error: '配置解释尚未配置' }); return payloads; }
      try { emit({ requestId, data: await ctx.pluginManagement.explainConfiguration(instanceKey, expectedRevision) }); }
      catch { emit({ requestId, error: '配置解释未确认，请重新读取文件版本与当前运行状态；原配置未改动。' }); }
      return payloads;
    }
    case CONFIG_RPC.GET_SOURCE: {
      try {
        const config: ConsoleConfigSource = ctx.readConfigSource
          ? await ctx.readConfigSource()
          : { source: '', format: 'yaml', revision: '', configKeys: [] };
        emit({ requestId, data: config });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case CONFIG_RPC.GET_ALL: {
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
    case CONFIG_RPC.GET: {
      try {
        const key = String(message.pluginName ?? '');
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
    case 'workrooms:get': {
      try {
        if (!ctx.readWorkroomCatalog) {
          emit({ requestId, error: 'Workroom Catalog read is not configured' });
          return payloads;
        }
        emit({ requestId, data: await ctx.readWorkroomCatalog() });
      } catch (error) {
        emit({ requestId, error: error instanceof Error ? error.message : String(error) });
      }
      return payloads;
    }
    case 'workrooms:set': {
      try {
        if (!ctx.setWorkroomCatalog) {
          emit({ requestId, error: 'Workroom Catalog write is not configured' });
          return payloads;
        }
        const expectedRevision = typeof message.expectedRevision === 'string'
          ? message.expectedRevision
          : '';
        if (!/^[a-f0-9]{64}$/u.test(expectedRevision)) {
          emit({ requestId, error: 'expectedRevision is required' });
          return payloads;
        }
        const result = await ctx.setWorkroomCatalog(message.data, expectedRevision);
        ctx.publishEvent?.('workrooms:updated', { revision: result.revision });
        emit({ requestId, data: { success: true, ...result } });
      } catch (error) {
        emit({ requestId, error: error instanceof Error ? error.message : String(error) });
      }
      return payloads;
    }
    case CONFIG_RPC.APPLY: {
      if (ctx.authScope !== 'full') { emit({ requestId, error: 'Full Console scope is required' }); return payloads; }
      if (typeof message.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(message.expectedRevision)) {
        emit({ requestId, error: 'expectedRevision is required' }); return payloads;
      }
      if (!ctx.applyConfig) { emit({ requestId, error: 'Config application is not configured' }); return payloads; }
      try {
        const result = await ctx.applyConfig(message.expectedRevision);
        emit({ requestId, data: result });
      } catch {
        // Source reads can fail before an operation is admitted. Do not echo a
        // YAML parser's source excerpt or turn unavailable evidence into success.
        emit({ requestId, error: 'Configuration application is unavailable; read the source and runtime status before retrying' });
      }
      return payloads;
    }
    case CONFIG_RPC.REPLACE_SOURCE: {
      try {
        const source = message.source;
        const expectedRevision = message.expectedRevision;
        if (typeof source !== 'string') {
          emit({ requestId, error: 'source field is required' });
          return payloads;
        }
        if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision)) {
          emit({ requestId, error: 'expectedRevision is required' });
          return payloads;
        }
        if (!ctx.replaceConfigSource) {
          emit({ requestId, error: 'Config write is not configured' });
          return payloads;
        }
        const result = await ctx.replaceConfigSource(source, expectedRevision);
        ctx.publishEvent?.('config:updated', { pluginName: null, keys: [] });
        emit({
          requestId,
          data: {
            success: true,
            ...result,
            message: configurationSaveMessage(result),
          },
        });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to save config: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return payloads;
    }
    case CONFIG_RPC.GET_PROJECT: {
      if (ctx.authScope !== 'full') { emit({ requestId, error: 'Full scope required' }); return payloads; }
      const { path, reveal } = message;
      if (path !== undefined && (!Array.isArray(path) || path.length > CONFIG_PATCH_LIMITS.maxPathDepth
        || path.some(segment => typeof segment !== 'string' || !segment || segment.length > CONFIG_PATCH_LIMITS.maxSegmentLength))) {
        emit({ requestId, error: 'path 必须是非空字符串数组' });
        return payloads;
      }
      if (reveal !== undefined && typeof reveal !== 'boolean') { emit({ requestId, error: 'reveal 必须是布尔值' }); return payloads; }
      if (!ctx.readProjectConfig) { emit({ requestId, error: 'Config project read is not configured' }); return payloads; }
      try {
        emit({ requestId, data: await ctx.readProjectConfig({ path: (path ?? []) as string[], reveal: reveal === true }) });
      } catch {
        // Parser/IO messages can quote document source (and therefore secrets): never echo them.
        emit({ requestId, error: 'Configuration read is unavailable; read the project file locally to diagnose it' });
      }
      return payloads;
    }
    case CONFIG_RPC.PATCH_PROJECT:
    case CONFIG_RPC.PATCH: {
      if (ctx.authScope !== 'full') { emit({ requestId, error: 'Full scope required' }); return payloads; }
      const projectPatch = message.type === CONFIG_RPC.PATCH_PROJECT;
      const { instanceKey, expectedRevision, patches } = message;
      if (projectPatch && instanceKey !== undefined) {
        emit({ requestId, error: 'Project patches must not specify instanceKey' });
        return payloads;
      }
      if (instanceKey !== undefined && (typeof instanceKey !== 'string' || !instanceKey || instanceKey.length > 128)) {
        emit({ requestId, error: 'instanceKey 必须是插件实例名，或省略以使用 Host 白名单' });
        return payloads;
      }
      if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision)) {
        emit({ requestId, error: 'expectedRevision is required' });
        return payloads;
      }
      if (!Array.isArray(patches)) {
        emit({ requestId, error: 'patches 必须是数组' });
        return payloads;
      }
      if (projectPatch) {
        const invalid = invalidProjectPatchOperations(patches);
        if (invalid) { emit({ requestId, error: invalid }); return payloads; }
      }
      const patch = projectPatch ? ctx.patchProjectConfig : ctx.patchConfig;
      if (!patch) {
        emit({ requestId, error: 'Config patch is not configured' });
        return payloads;
      }
      let result: Awaited<ReturnType<typeof patch>>;
      try {
        result = await patch.call(ctx, {
          ...(instanceKey === undefined ? {} : { instanceKey }),
          expectedRevision,
          patches,
        });
      } catch (error) {
        emit({
          requestId,
          error: `Failed to patch config: ${error instanceof Error ? error.message : String(error)}`,
        });
        return payloads;
      }
      if (result.status === 'saved') {
        // The write has committed: a notification failure must not turn the receipt into a rejection.
        try {
          ctx.publishEvent?.('config:updated', {
            pluginName: instanceKey ?? null,
            keys: [...new Set(result.paths.map(path => path[0]))],
            paths: result.paths,
            revision: result.revision,
          });
        } catch { /* subscribers resynchronise from the next read */ }
      }
      emit({ requestId, data: result });
      return payloads;
    }
    case CONFIG_RPC.SET: {
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
        if (ctx.validatePluginConfig) {
          const validation = await ctx.validatePluginConfig(pluginName, message.data);
          if (!validation.valid) {
            emit({
              requestId,
              error: '配置校验失败',
              data: validation,
            });
            return payloads;
          }
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
            ...result,
            reloaded: false,
            message: configurationSaveMessage(result),
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
    default: {
      if (await dispatchHostResourceConsoleRpc(type, message, ctx, requestId, payloads)) {
        return payloads;
      }
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
}
