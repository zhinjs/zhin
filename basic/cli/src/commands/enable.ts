import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { describeGatewayError, probeGateway, processOutput, runPluginEnablementViaGateway, type Output } from '../utils/gateway.js';

export interface PluginEnablementLog {
  success(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

export interface PluginEnablementOptions {
  readonly cwd?: string;
  readonly log?: PluginEnablementLog;
  /** Progress and result lines of a gateway transaction. */
  readonly output?: Output;
}

/**
 * `zhin enable` / `zhin disable`: edits `disable_plugins` for one declared instance. With a running
 * gateway the change is a configuration-only transaction (instance stopped, file written, instance
 * started again, rolled back if it does not come up, ADR 0054 §6); without one the file is written
 * directly and the change applies at the next `zhin start`. Returns the process exit code.
 */
export async function runPluginEnablement(plugin: string, enabled: boolean, options: PluginEnablementOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? logger;
  const verb = enabled ? '启用' : '停用';
  if (!existsSync(path.join(cwd, 'package.json'))) {
    log.error('当前目录不是有效的项目（缺少 package.json）');
    return 1;
  }
  try {
    if (await probeGateway({ root: cwd })) {
      const result = await runPluginEnablementViaGateway({ root: cwd }, { plugin, enabled }, options.output ?? processOutput);
      return result.ok ? 0 : 1;
    }
    const { PluginManagementWorkflow } = await import('@zhin.js/gateway/plugin-management');
    const workflow = new PluginManagementWorkflow(cwd);
    const plan = await workflow.planSetEnabled(plugin, enabled);
    const label = `${plan.instanceKey}（${plan.packageName}）`;
    if (!plan.changed) {
      log.info(`插件实例 ${label} 已是${verb}状态，未修改配置`);
      return 0;
    }
    await workflow.setEnabled(plan.instanceKey, enabled, plan.configurationRevision, plan.projectRevision);
    log.success(`已${verb}插件实例 ${label}，已更新 disable_plugins`);
    log.info('网关未运行：下次 zhin start 时生效（独立运行的实例需手动重启）');
    return 0;
  } catch (error) {
    log.error(`${verb}插件失败：${describeGatewayError(error)}`);
    return 1;
  }
}

function toggleCommand(name: 'enable' | 'disable'): Command {
  const enabled = name === 'enable';
  const verb = enabled ? '启用' : '停用';
  return new Command(name)
    .description(`${verb}已安装并声明的插件实例（${enabled ? '从 disable_plugins 移除' : '加入 disable_plugins'}）`)
    .argument('<plugin>', '插件实例键（instanceKey），或只声明了一个实例的包名')
    .addHelpText('after', [
      '',
      '网关运行中：经网关事务写入配置并重启实例，启动失败时自动回滚；网关未运行：只写入配置，下次 zhin start 生效。',
      `已是${verb}状态时不修改配置也不重启实例。`,
      enabled ? '启用前会校验插件已安装、依赖可解析且实例配置通过插件 Schema。' : '停用不删除依赖和实例配置；彻底移除请用 zhin uninstall plugin。',
      '',
      '示例：',
      `  zhin ${name} sandbox`,
      `  zhin ${name} @zhin.js/plugin-rss`,
    ].join('\n'))
    .action(async (plugin: string) => {
      process.exitCode = await runPluginEnablement(plugin, enabled);
    });
}

export const enableCommand = toggleCommand('enable');
export const disableCommand = toggleCommand('disable');
