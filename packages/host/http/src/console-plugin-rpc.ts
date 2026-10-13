import { PLUGIN_RPC } from '@zhin.js/console-protocol';
import type {
  RuntimeConsoleRpcContext,
  RuntimeConsoleRpcMessage,
  RuntimeConsoleRpcReply,
} from './console-rpc.js';

/** Dispatches the plugin-management slice; undefined means the type belongs elsewhere. */
export async function dispatchPluginConsoleRpc(
  type: string,
  message: RuntimeConsoleRpcMessage,
  ctx: RuntimeConsoleRpcContext,
): Promise<RuntimeConsoleRpcReply | undefined> {
  const requestId = message.requestId as number | string | undefined;
  try {
    switch (type) {
      case PLUGIN_RPC.SET_ENABLED: {
        const instanceKey = stringField(message, 'instanceKey');
        const enabled = message.enabled;
        if (!instanceKey || typeof enabled !== 'boolean') {
          return { requestId, error: 'instanceKey and boolean enabled are required' };
        }
        if (!ctx.setPluginEnabled) {
          return { requestId, error: 'Plugin lifecycle management is not configured' };
        }
        const lifecycle = await ctx.setPluginEnabled(instanceKey, enabled);
        ctx.publishEvent?.('plugin:lifecycle-updated', { instanceKey, enabled });
        if (ctx.requestRestart) {
          setTimeout(() => void Promise.resolve(ctx.requestRestart?.()).catch(() => undefined), 500);
        }
        return {
          requestId,
          data: {
            success: true,
            instanceKey,
            enabled,
            disabled: lifecycle.disabled,
            restartRequired: true,
            message: `${instanceKey} 已${enabled ? '启用' : '停用'}，Host 正在重启`,
          },
        };
      }
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
      case PLUGIN_RPC.INSTALL: {
        const packageName = stringField(message, 'packageName');
        if (!packageName) return { requestId, error: 'packageName is required' };
        if (!ctx.pluginManagement?.install) {
          return { requestId, error: 'Plugin installation is not configured' };
        }
        const result = await ctx.pluginManagement.install(
          packageName,
          optionalString(message.expectedRevision),
          optionalString(message.expectedProjectRevision),
        );
        ctx.publishEvent?.('plugin:installed', { packageName, restartRequired: result.restartRequired });
        return { requestId, data: { success: true, ...result } };
      }
      case PLUGIN_RPC.PLAN_UNINSTALL: {
        const packageName = stringField(message, 'packageName');
        if (!packageName) return { requestId, error: 'packageName is required' };
        if (!ctx.pluginManagement?.planUninstall) {
          return { requestId, error: 'Plugin uninstall planning is not configured' };
        }
        return { requestId, data: await ctx.pluginManagement.planUninstall(packageName) };
      }
      case PLUGIN_RPC.UNINSTALL: {
        const packageName = stringField(message, 'packageName');
        if (!packageName || stringField(message, 'confirmation') !== packageName) {
          return { requestId, error: 'confirmation must exactly match packageName' };
        }
        if (!ctx.pluginManagement?.uninstall) {
          return { requestId, error: 'Plugin uninstall is not configured' };
        }
        const result = await ctx.pluginManagement.uninstall(
          packageName,
          optionalString(message.expectedRevision),
          optionalString(message.expectedProjectRevision),
        );
        ctx.publishEvent?.('plugin:uninstalled', { packageName, restartRequired: result.restartRequired });
        return { requestId, data: { success: true, ...result } };
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
      case PLUGIN_RPC.UPDATE: {
        const packageName = stringField(message, 'packageName');
        const targetVersion = stringField(message, 'targetVersion');
        if (!packageName || !targetVersion) {
          return { requestId, error: 'packageName and targetVersion are required' };
        }
        if (!ctx.pluginManagement?.update) return { requestId, error: 'Plugin update is not configured' };
        const result = await ctx.pluginManagement.update(
          packageName,
          targetVersion,
          optionalString(message.expectedRevision),
          optionalString(message.expectedProjectRevision),
        );
        ctx.publishEvent?.('plugin:updated', {
          packageName,
          version: result.installedVersion,
          restartRequired: result.restartRequired,
        });
        return { requestId, data: { success: true, ...result } };
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
