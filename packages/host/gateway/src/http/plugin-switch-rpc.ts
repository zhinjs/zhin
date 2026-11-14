/**
 * The Console's global plugin switch, answered by the gateway (ADR 0054 §4, ADR 0050 §4):
 * `plugin:set-enabled` and `feature.set-enabled` with `level: 'global'` both write
 * `disable_plugins`, which is plugin lifecycle rather than a feature switch. The gateway
 * intercepts them on `POST {base}/console/request` before anything is forwarded, authorizes them
 * with `plugin.manage` (the shared permission map refines `feature.set-enabled` by level), and
 * runs the enable / disable transaction of {@link GatewayPackageService.setEnabled}: stop the
 * instance → write `disable_plugins` → start it, restoring the file and the old instance on
 * failure. `feature.set-enabled` below the global level is forwarded to the instance untouched.
 *
 * Replies keep the shapes the instance used to send, so a published Console keeps working:
 * - `plugin:set-enabled`: `{ success, instanceKey, enabled, disabled, restartRequired, message }`;
 * - `feature.set-enabled`: `ConsoleFeatureWriteResult` (`saved` / `unchanged`) with the
 *   configuration revision after the write and the override warnings of the new state.
 * Both add `transaction` (the gateway transaction result). A failed or rolled-back transaction
 * answers the RPC's error envelope (`success: false`, `code`, `error`) with `transaction`.
 */
import { join } from 'node:path';
import {
  auditActor,
  authorizeConsoleRpc,
  jsonResponse,
  rpcAuditDetail,
  rpcAuditTarget,
  type ConsolePrincipal,
  type ConsoleRpcDecision,
  type RouteContext,
  type TokenRegistry,
} from '@zhin.js/host-http';
import {
  CONSOLE_DENIAL_REASONS,
  FEATURE_RPC,
  PLUGIN_RPC,
  isGlobalFeatureSwitch,
  type ConsoleDenialReason,
  type ConsoleFeatureWarning,
  type GatewayPackageTransactionResult,
} from '@zhin.js/console-protocol';
import { DEFAULT_ROOT_CONFIG_FILE_NAME, FEATURE_OVERRIDES_KEY, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { collectFeatureOverrideWarnings, createConfigDocument } from '@zhin.js/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { GatewayError } from '../packages/errors.js';
import type { GatewayPackageService } from '../packages/service.js';
import { findConfigFile } from '../project/config-file.js';
import type { GatewayRpcHandler } from './console-rpc.js';

const logger = getLogger('gateway');

/** Top-level plugin instance alias (the global switch only applies to top-level instances). */
const INSTANCE_KEY = /^[a-z0-9][a-z0-9-]*$/u;

/** What the switch needs from the package service. */
export type GatewayPluginSwitchPackages = Pick<GatewayPackageService, 'setEnabled'>;

/** The root configuration as written after the transaction. */
export interface GatewayPluginSwitchConfigRead {
  readonly revision: string;
  readonly document: Readonly<Record<string, unknown>>;
}

export interface GatewayPluginSwitchRpcOptions {
  readonly projectRoot: string;
  /** Undefined when the gateway manages no packages: the switch then answers 503 (never forwarded). */
  readonly packages: GatewayPluginSwitchPackages | undefined;
  /** Reads the root configuration (revision and document). Defaults to the project's config file. */
  readonly readConfig?: () => Promise<GatewayPluginSwitchConfigRead>;
}

type Reply = { readonly status: number; readonly body: Record<string, unknown> };

/** Whether the gateway answers this Console RPC message itself (the global plugin switch). */
export function isGatewayPluginSwitch(message: Readonly<Record<string, unknown>>): boolean {
  return message.type === PLUGIN_RPC.SET_ENABLED || isGlobalFeatureSwitch(message);
}

export function createGatewayPluginSwitchRpc(options: GatewayPluginSwitchRpcOptions): GatewayRpcHandler {
  const readConfig = options.readConfig ?? (async (): Promise<GatewayPluginSwitchConfigRead> => {
    const file = join(options.projectRoot, findConfigFile(options.projectRoot) ?? DEFAULT_ROOT_CONFIG_FILE_NAME);
    const { revision, document } = await createConfigDocument(file).read();
    return { revision, document: document as Readonly<Record<string, unknown>> };
  });
  return Object.freeze({
    owns: (type: string) => type === PLUGIN_RPC.SET_ENABLED || type === FEATURE_RPC.SET_ENABLED,
    claims: isGatewayPluginSwitch,
    types: () => [PLUGIN_RPC.SET_ENABLED, FEATURE_RPC.SET_ENABLED],
    async handle(message: Readonly<Record<string, unknown>>, context: RouteContext, registry: TokenRegistry): Promise<Response> {
      const noStore = { 'cache-control': 'no-store' };
      const type = String(message.type ?? '');
      const requestId = message.requestId;
      const principal: ConsolePrincipal | undefined = context.principal;
      if (!principal) {
        return jsonResponse(401, { success: false, code: 'unauthorized', error: 'Invalid or missing token', requestId }, noStore);
      }
      // plugin.manage: `plugin:set-enabled` is mapped to it, `feature.set-enabled` is refined by level.
      const decision: ConsoleRpcDecision = authorizeConsoleRpc(principal, message);
      const audit = (outcome: 'ok' | 'denied' | 'error', reason?: ConsoleDenialReason): void => {
        try {
          registry.accessProvider?.audit?.({
            actor: auditActor(principal),
            action: `rpc:${type}`.slice(0, 256),
            ...(decision.allowed && rpcAuditTarget(decision.rule) ? { target: rpcAuditTarget(decision.rule)! } : {}),
            outcome,
            detail: reason ? { ...rpcAuditDetail(message), reason } : rpcAuditDetail(message),
            ...(context.remoteAddress ? { ip: context.remoteAddress } : {}),
          });
        } catch { /* audit never breaks a request */ }
      };
      if (!decision.allowed) {
        audit('denied', decision.reason);
        return jsonResponse(403, { success: false, code: decision.code, error: decision.error, requestId }, noStore);
      }
      const reply = type === PLUGIN_RPC.SET_ENABLED
        ? await setPluginEnabled(message, principal, options, readConfig)
        : await setFeatureGlobal(message, principal, options, readConfig);
      audit(
        reply.status < 400 && reply.body.success !== false ? 'ok' : reply.status === 403 ? 'denied' : 'error',
        reply.status === 403 ? CONSOLE_DENIAL_REASONS.HANDLER_DENIED : undefined,
      );
      return jsonResponse(reply.status, { ...reply.body, requestId }, noStore);
    },
  });
}

/** `plugin:set-enabled` `{ instanceKey, enabled }` (top-level fields, as the Console sends them). */
async function setPluginEnabled(
  message: Readonly<Record<string, unknown>>,
  principal: ConsolePrincipal,
  options: GatewayPluginSwitchRpcOptions,
  readConfig: () => Promise<GatewayPluginSwitchConfigRead>,
): Promise<Reply> {
  const type = PLUGIN_RPC.SET_ENABLED;
  const instanceKey = typeof message.instanceKey === 'string' ? message.instanceKey.trim() : '';
  const enabled = message.enabled;
  if (!instanceKey || typeof enabled !== 'boolean') return error(400, 'invalid_input', 'instanceKey and boolean enabled are required', type);
  const outcome = await runSwitch(instanceKey, enabled, principal, options, type);
  if ('reply' in outcome) return outcome.reply;
  const { result } = outcome;
  const config = await readConfig().catch(() => undefined);
  const key = result.plugin?.instanceKey ?? instanceKey;
  const changed = result.plugin?.changed === true;
  return {
    status: 200,
    body: {
      success: true,
      type,
      data: {
        success: true,
        instanceKey: key,
        enabled,
        disabled: disabledPlugins(config?.document),
        // The gateway restarted the instance for a change (it already is back): the Console re-syncs.
        restartRequired: changed,
        message: switchMessage(key, enabled, changed),
        transaction: result,
      },
    },
  };
}

/** `feature.set-enabled` with `level: 'global'`, payload in `data` (or on the message). */
async function setFeatureGlobal(
  message: Readonly<Record<string, unknown>>,
  principal: ConsolePrincipal,
  options: GatewayPluginSwitchRpcOptions,
  readConfig: () => Promise<GatewayPluginSwitchConfigRead>,
): Promise<Reply> {
  const type = FEATURE_RPC.SET_ENABLED;
  const data = message.data;
  const input = (data && typeof data === 'object' && !Array.isArray(data) ? data : message) as Readonly<Record<string, unknown>>;
  const plugin = input.plugin;
  if (typeof plugin !== 'string' || !plugin) return error(400, undefined, '缺少 plugin', type);
  if (input.key !== undefined && input.key !== '') return error(400, undefined, 'global 层不需要 key', type);
  if (!INSTANCE_KEY.test(plugin)) {
    return error(400, undefined, plugin.includes('/') ? '全局开关只适用于顶层插件实例' : 'plugin 必须是插件实例别名', type);
  }
  if (typeof input.enabled !== 'boolean') return error(400, undefined, 'enabled 必须是布尔值', type);
  const enabled = input.enabled;
  const outcome = await runSwitch(plugin, enabled, principal, options, type);
  if ('reply' in outcome) return outcome.reply;
  const { result } = outcome;
  const config = await readConfig().catch((failure: unknown) => {
    logger.warn(formatCompact({ op: 'gateway_plugin_switch_config_read_failed', error: failure instanceof Error ? failure.message : String(failure) }));
    return undefined;
  });
  const revision = config?.revision ?? '';
  const changed = result.plugin?.changed === true;
  if (!changed) {
    return { status: 200, body: { success: true, type, data: Object.freeze({ status: 'unchanged', revision, warnings: Object.freeze([]), transaction: result }) } };
  }
  return {
    status: 200,
    body: {
      success: true,
      type,
      data: Object.freeze({
        status: 'saved',
        revision,
        // The instance was restarted by the gateway transaction (it already is back).
        restartRequired: true,
        warnings: config ? overrideWarnings(config.document, plugin) : Object.freeze([]),
        message: switchMessage(plugin, enabled, true),
        transaction: result,
      }),
    },
  };
}

/** Runs the transaction; a refusal or a failed / rolled-back transaction becomes an error reply. */
async function runSwitch(
  plugin: string,
  enabled: boolean,
  principal: ConsolePrincipal,
  options: GatewayPluginSwitchRpcOptions,
  type: string,
): Promise<{ readonly result: GatewayPackageTransactionResult } | { readonly reply: Reply }> {
  if (!options.packages) return { reply: error(503, 'unavailable', '插件启停不可用：网关未管理依赖', type) };
  let result: GatewayPackageTransactionResult;
  try {
    result = await options.packages.setEnabled({ plugin }, enabled, { principal });
  } catch (failure) {
    if (failure instanceof GatewayError) {
      return {
        reply: error(failure.status, failure.code, failure.message, type, {
          ...(failure.details?.errors ? { errors: failure.details.errors } : {}),
          ...(failure.details?.missingEnv ? { missingEnv: failure.details.missingEnv } : {}),
        }),
      };
    }
    logger.warn(formatCompact({ op: 'gateway_plugin_switch_failed', plugin, error: failure instanceof Error ? failure.message : String(failure) }));
    return { reply: error(500, 'internal', '插件启停失败', type) };
  }
  if (result.ok) return { result };
  const action = enabled ? '启用' : '停用';
  const text = result.status === 'rollbackFailed'
    ? `${action} ${plugin} 失败，且回滚未完成：${result.rollbackError ?? '未知错误'}（原因：${result.error ?? '未知错误'}）`
    : `${action} ${plugin} 失败，已回滚：${result.error ?? '未知错误'}`;
  return {
    reply: error(500, result.status === 'rollbackFailed' ? 'rollback_failed' : 'transaction_failed', text, type, {
      transaction: result,
      ...(result.errors?.length ? { errors: result.errors } : {}),
      ...(result.missingEnv?.length ? { missingEnv: result.missingEnv } : {}),
    }),
  };
}

function error(status: number, code: string | undefined, message: string, type: string, extra: Record<string, unknown> = {}): Reply {
  return { status, body: { success: false, ...(code ? { code } : {}), error: message, type, ...extra } };
}

function switchMessage(plugin: string, enabled: boolean, changed: boolean): string {
  const action = enabled ? '启用' : '停用';
  return changed ? `${plugin} 已${action}，实例已由管理网关重启` : `${plugin} 已处于${action}状态`;
}

function disabledPlugins(document: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const list = document?.disable_plugins;
  return Object.freeze(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
}

/**
 * The global plugin switch's warnings about a legacy `overrides` block still in the file (as the
 * instance computed them). Since ADR 0057 §2 adapter / account overrides live in the instance's
 * database, which the gateway does not read, so this only reports a block waiting for its import.
 */
function overrideWarnings(document: Readonly<Record<string, unknown>>, plugin: string): readonly ConsoleFeatureWarning[] {
  const block = document[plugin];
  const overrides = block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>)[FEATURE_OVERRIDES_KEY] : undefined;
  if (overrides === undefined) return Object.freeze([]);
  try {
    const enabled = !disabledPlugins(document).includes(plugin);
    return Object.freeze(collectFeatureOverrideWarnings(document as RuntimeConfigDocument, plugin, overrides, enabled)
      .map(({ code, path, message }) => Object.freeze({ code, path, message })));
  } catch {
    return Object.freeze([]);
  }
}
