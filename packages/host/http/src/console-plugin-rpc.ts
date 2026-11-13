import { PLUGIN_RPC } from '@zhin.js/console-protocol';
import type {
  RuntimeConsoleRpcContext,
  RuntimeConsoleRpcMessage,
  RuntimeConsoleRpcReply,
} from './console-rpc.js';

/**
 * Refusal of the global plugin switch (`plugin:set-enabled`, `feature.set-enabled` at `global`)
 * by an instance: the switch is a gateway transaction (stop → write `disable_plugins` → start,
 * rollback on failure) and is never written by the instance itself (ADR 0054 §4).
 */
export const PLUGIN_SWITCH_REQUIRES_GATEWAY = '插件全局启停由管理网关执行（停止实例 → 写入 disable_plugins → 启动，失败回滚）：请在 zhin start 启动的 Console 中操作，或运行 zhin enable / zhin disable <插件>';

/**
 * Dispatches the plugin-management slice; undefined means the type belongs elsewhere. Package
 * installs / updates / uninstalls are not handled in the instance: they are gateway dependency
 * transactions (`gateway.packages.*`, ADR 0054 §4) that stop the instance first, and so is the
 * global plugin switch (`plugin:set-enabled`, refused here).
 */
export async function dispatchPluginConsoleRpc(
  type: string,
  message: RuntimeConsoleRpcMessage,
  ctx: RuntimeConsoleRpcContext,
): Promise<RuntimeConsoleRpcReply | undefined> {
  const requestId = message.requestId as number | string | undefined;
  try {
    switch (type) {
      case PLUGIN_RPC.SET_ENABLED:
        // Global plugin on / off is a management gateway transaction (ADR 0054 §4): the gateway
        // answers it before forwarding. Reaching the instance means no gateway is in front.
        return { requestId, error: PLUGIN_SWITCH_REQUIRES_GATEWAY };
      case PLUGIN_RPC.INSPECT:
      case PLUGIN_RPC.APPLY:
      case PLUGIN_RPC.PLAN_VERIFICATION:
      case PLUGIN_RPC.VERIFY: {
        const name = stringField(message, 'instanceKey') || stringField(message, 'packageName');
        if (!name) return { requestId, error: 'instanceKey or packageName is required' };
        const port = ctx.pluginManagement;
        if (!port) return { requestId, error: 'Plugin management is not configured' };
        if (type === PLUGIN_RPC.APPLY || type === PLUGIN_RPC.PLAN_VERIFICATION || type === PLUGIN_RPC.VERIFY) {
          if (ctx.authScope !== 'full') return { requestId, error: 'Full scope required' };
        }
        if (type === PLUGIN_RPC.INSPECT && port.inspect) return { requestId, data: await port.inspect(name) };
        if (type === PLUGIN_RPC.APPLY && port.apply) return { requestId, data: await port.apply(name, optionalString(message.expectedProjectRevision)) };
        if (type === PLUGIN_RPC.PLAN_VERIFICATION && port.verificationPlan) return { requestId, data: await port.verificationPlan(name) };
        if (type === PLUGIN_RPC.VERIFY && port.verify) {
          const checkId = stringField(message, 'checkId');
          if (!checkId) return { requestId, error: 'checkId is required' };
          const expectedGeneration = message.expectedGeneration;
          const projectRevision = stringField(message, 'expectedProjectRevision');
          const checkRevision = stringField(message, 'expectedCheckRevision');
          if (!(expectedGeneration === null || typeof expectedGeneration === 'number' && Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0) || !projectRevision || !checkRevision) return { requestId, error: 'expectedGeneration, expectedProjectRevision and expectedCheckRevision are required' };
          return { requestId, data: await port.verify(name, checkId, expectedGeneration, projectRevision, checkRevision) };
        }
        return { requestId, error: 'Plugin workflow operation is not configured' };
      }
      case PLUGIN_RPC.PLAN_INSTALL: {
        const packageName = stringField(message, 'packageName');
        if (!packageName) return { requestId, error: 'packageName is required' };
        if (!ctx.pluginManagement) return { requestId, error: 'Plugin management is not configured' };
        return { requestId, data: await ctx.pluginManagement.planInstall(packageName) };
      }
      case PLUGIN_RPC.PLAN_UNINSTALL: {
        const packageName = stringField(message, 'packageName');
        if (!packageName) return { requestId, error: 'packageName is required' };
        if (!ctx.pluginManagement?.planUninstall) {
          return { requestId, error: 'Plugin uninstall planning is not configured' };
        }
        return { requestId, data: await ctx.pluginManagement.planUninstall(packageName) };
      }
      case PLUGIN_RPC.PLAN_UPDATE: {
        const packageName = stringField(message, 'packageName');
        const targetVersion = stringField(message, 'targetVersion');
        if (!packageName || !targetVersion) {
          return { requestId, error: 'packageName and targetVersion are required' };
        }
        if (!ctx.pluginManagement?.planUpdate) {
          return { requestId, error: 'Plugin update planning is not configured' };
        }
        return { requestId, data: await ctx.pluginManagement.planUpdate(packageName, targetVersion) };
      }
      case PLUGIN_RPC.VALIDATE_CONFIG: {
        const pluginName = stringField(message, 'pluginName');
        if (!pluginName) return { requestId, error: 'pluginName is required' };
        if (!ctx.validatePluginConfig) return { requestId, error: 'Config validation is not configured' };
        return { requestId, data: await ctx.validatePluginConfig(pluginName, message.data) };
      }
      case PLUGIN_RPC.DIAGNOSE: {
        const pluginName = stringField(message, 'pluginName');
        if (!pluginName) return { requestId, error: 'pluginName is required' };
        if (!ctx.diagnosePlugin) return { requestId, error: 'Plugin diagnostics are not configured' };
        return { requestId, data: await ctx.diagnosePlugin(pluginName) };
      }
      default:
        return undefined;
    }
  } catch (error) {
    return { requestId, error: error instanceof Error ? error.message : String(error), ...(error instanceof Error && 'completedStages' in error ? { data: { completedStages: error.completedStages, ...('state' in error ? { state: error.state } : {}) } } : {}) };
  }
}

function stringField(message: RuntimeConsoleRpcMessage, key: string): string {
  const value = message[key];
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
