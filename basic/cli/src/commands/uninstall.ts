import { Command } from 'commander';
import inquirer from 'inquirer';
import { stdinIsInteractive } from '../utils/interactive.js';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import { probeGateway, runPackageOperationViaGateway } from '../utils/gateway.js';

/** ADR 0054 §6: with a running gateway, uninstall through it; false when no gateway runs. */
async function uninstallViaGateway(cwd: string, name: string, removeDependency: boolean): Promise<boolean> {
  if (!await probeGateway({ root: cwd })) return false;
  const result = await runPackageOperationViaGateway({ root: cwd }, { operation: 'uninstall', packages: [name], removeDependency });
  if (!result.ok) process.exit(1);
  return true;
}

/**
 * The local plugin directory (`./plugins/<name>`) after its instance is removed: `--remove-dir`
 * deletes it without asking; otherwise a terminal is asked (default: keep) and without one it is
 * kept (#1250).
 */
/**
 * Why `./plugins/<name>` must be kept, or `undefined` when it may be deleted: the name must be a single
 * path segment inside `./plugins`, and the project must no longer depend on the package that lives there
 * (a kept dependency or another instance would point at a deleted directory and break the next install).
 */
export function localPluginDirKeepReason(cwd: string, name: string): string | undefined {
  const pluginsRoot = path.resolve(cwd, 'plugins');
  const pluginDir = path.resolve(pluginsRoot, name);
  if (!name || name.includes('/') || name.includes('\\') || path.dirname(pluginDir) !== pluginsRoot) {
    return `"${name}" 不是 ./plugins 下的单个目录名`;
  }
  let packageName: string | undefined;
  try {
    const local = fs.readJsonSync(path.join(pluginDir, 'package.json'), { throws: false }) as { name?: unknown } | null;
    if (typeof local?.name === 'string') packageName = local.name;
  } catch { /* no package.json: nothing can depend on it by name */ }
  if (!packageName) return undefined;
  const root = fs.readJsonSync(path.join(cwd, 'package.json'), { throws: false }) as Record<string, unknown> | null;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = root?.[field];
    if (deps && typeof deps === 'object' && packageName in (deps as Record<string, unknown>)) {
      return `package.json 仍依赖 ${packageName}（保留了依赖，或还有其他实例在用）`;
    }
  }
  return undefined;
}

async function removeLocalPluginDir(cwd: string, name: string, removeDir: boolean): Promise<void> {
  const pluginDir = path.join(cwd, 'plugins', name);
  const keepReason = localPluginDirKeepReason(cwd, name);
  if (keepReason) {
    if (removeDir) logger.warn(`未删除本地插件目录：${keepReason}`);
    return;
  }
  if (!fs.existsSync(pluginDir)) return;
  let remove = removeDir;
  if (!remove && !stdinIsInteractive()) {
    // No terminal to confirm on (#1250): keep the directory (the prompt's default) instead of waiting.
    logger.info(`已保留本地插件目录 "${pluginDir}"（非交互环境不询问；要删除请加 --remove-dir）`);
    return;
  }
  if (!remove) {
    const { confirmDelete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDelete',
        message: `是否删除本地插件目录 "${pluginDir}"?`,
        default: false
      }
    ]);
    remove = confirmDelete === true;
  }
  if (remove) {
    await fs.remove(pluginDir);
    logger.success(`已删除插件目录 "${name}"`);
  }
}

const pluginCommand = new Command('plugin')
  .description('卸载插件')
  .argument('<name>', '插件名称（npm 包名或 instanceKey）')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .option('--remove-dir', '同时删除本地插件目录 ./plugins/<name>，不再询问')
  .action(async (name: string, options: { removePkg?: boolean; removeDir?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    if (await uninstallViaGateway(cwd, name, options.removePkg === true)) {
      await removeLocalPluginDir(cwd, name, options.removeDir === true);
      return;
    }
    const { PluginManagementWorkflow } = await import('@zhin.js/gateway/plugin-management');
    await new PluginManagementWorkflow(cwd).uninstall(name, undefined, undefined, {removeDependency: options.removePkg === true});
    logger.success(`已移除插件实例 "${name}"${options.removePkg ? '（无其他引用时移除依赖）' : '（保留依赖）'}`);

    // 本地插件目录（./plugins/<name>）：--remove-dir 直接删除；否则默认不删，确认后删除
    await removeLocalPluginDir(cwd, name, options.removeDir === true);
  });

const adapterCommand = new Command('adapter')
  .description('卸载适配器')
  .argument('<name>', '适配器名称')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .action(async (name: string, options: { removePkg?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    const { PluginManagementWorkflow } = await import('@zhin.js/gateway/plugin-management');
    const workflow = new PluginManagementWorkflow(cwd);
    const direct = await workflow.inspect(name);
    const target = direct.declared ? name : name.startsWith('@') ? name : `@zhin.js/adapter-${name.replace(/^adapter-/, '')}`;
    if (await uninstallViaGateway(cwd, target, options.removePkg === true)) return;
    await workflow.uninstall(target, undefined, undefined, {removeDependency: options.removePkg === true});
    logger.success(`已移除适配器实例 "${name}"${options.removePkg ? '（无其他引用时移除依赖）' : '（保留依赖）'}`);

  });

export const uninstallCommand = new Command('uninstall')
  .description('卸载插件或适配器（系统服务请用 zhin service uninstall）')
  .addCommand(pluginCommand)
  .addCommand(adapterCommand);
