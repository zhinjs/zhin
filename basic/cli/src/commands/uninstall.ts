import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { execSync } from 'child_process';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';

async function findConfigFile(cwd: string): Promise<string | null> {
  const candidates = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json'];
  return candidates.find(f => fs.existsSync(path.join(cwd, f))) || null;
}

async function readConfig(filePath: string): Promise<any> {
  const ext = path.extname(filePath);
  const content = await fs.readFile(filePath, 'utf-8');

  if (ext === '.yml' || ext === '.yaml') {
    return yaml.parse(content);
  } else if (ext === '.json') {
    return JSON.parse(content);
  }
  return {};
}

async function saveConfig(filePath: string, config: any): Promise<void> {
  const ext = path.extname(filePath);

  if (ext === '.yml' || ext === '.yaml') {
    await fs.writeFile(filePath, yaml.stringify(config));
  } else if (ext === '.json') {
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  }
}

function getServiceName(): string {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = fs.readJsonSync(pkgPath);
    return pkg.name || 'zhin';
  }
  return 'zhin';
}

async function uninstallLinuxService(serviceName: string): Promise<void> {
  const serviceFile = `/etc/systemd/system/${serviceName}.service`;
  
  if (!fs.existsSync(serviceFile)) {
    logger.warn(formatCompact( { cmd: 'uninstall', op: 'service_not_installed' }));
    return;
  }

  try {
    // 停止服务
    execSync(`sudo systemctl stop ${serviceName}`, { stdio: 'inherit' });
    // 禁用服务
    execSync(`sudo systemctl disable ${serviceName}`, { stdio: 'inherit' });
    // 删除服务文件
    execSync(`sudo rm ${serviceFile}`, { stdio: 'inherit' });
    // 重新加载 systemd
    execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
    
    logger.success('服务已卸载');
  } catch (error: unknown) {
    logger.error(`卸载服务失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function uninstallMacService(serviceName: string): Promise<void> {
  const plistFile = path.join(process.env.HOME!, 'Library', 'LaunchAgents', `${serviceName}.plist`);
  
  if (!fs.existsSync(plistFile)) {
    logger.warn(formatCompact( { cmd: 'uninstall', op: 'service_not_installed' }));
    return;
  }

  try {
    // 卸载服务
    execSync(`launchctl unload ${plistFile}`, { stdio: 'inherit' });
    // 删除 plist 文件
    await fs.remove(plistFile);
    
    logger.success('服务已卸载');
  } catch (error: unknown) {
    logger.error(`卸载服务失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function uninstallWindowsService(serviceName: string): Promise<void> {
  try {
    // 检查服务是否存在
    const services = execSync('sc query', { encoding: 'utf-8' });
    if (!services.includes(serviceName)) {
      logger.warn(formatCompact( { cmd: 'uninstall', op: 'service_not_installed' }));
      return;
    }

    // 停止服务
    execSync(`sc stop ${serviceName}`, { stdio: 'inherit' });
    // 删除服务
    execSync(`sc delete ${serviceName}`, { stdio: 'inherit' });
    
    logger.success('服务已卸载');
  } catch (error: unknown) {
    logger.error(`卸载服务失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const serviceCommand = new Command('service')
  .description('卸载系统服务')
  .action(async () => {
    const serviceName = getServiceName();
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `确认卸载服务 "${serviceName}"?`,
        default: false
      }
    ]);

    if (!confirm) {
      logger.info(formatCompact( { cmd: 'uninstall', op: 'cancelled' }));
      return;
    }

    const platform = process.platform;
    
    if (platform === 'linux') {
      await uninstallLinuxService(serviceName);
    } else if (platform === 'darwin') {
      await uninstallMacService(serviceName);
    } else if (platform === 'win32') {
      await uninstallWindowsService(serviceName);
    } else {
      logger.error(`不支持的平台: ${platform}`);
      process.exit(1);
    }
  });

const pluginCommand = new Command('plugin')
  .description('卸载插件')
  .argument('<name>', '插件名称（npm 包名或 instanceKey）')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .action(async (name: string, options: { removePkg?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    await removePluginFromConfig(cwd, name);

    const pkg = await fs.readJson(pkgPath);
    const removedFromManifest = removeFromZhinManifest(pkg, name);
    let removedDep = false;
    if (options.removePkg) {
      for (const depName of depNamesFor(name)) {
        for (const field of ['dependencies', 'devDependencies'] as const) {
          if (pkg[field]?.[depName]) {
            delete pkg[field][depName];
            removedDep = true;
          }
        }
      }
    }
    if (removedFromManifest || removedDep) {
      await fs.writeJson(pkgPath, pkg, { spaces: 2 });
      if (removedFromManifest) logger.success(`已从 package.json 的 zhin.plugins 清单中移除 "${name}"`);
      if (removedDep) {
        logger.success(`已从 package.json 中移除依赖 "${name}"`);
        console.log(chalk.yellow('\n请运行 "pnpm install" 更新依赖'));
      }
    } else if (!options.removePkg) {
      logger.warn(formatCompact({ cmd: 'uninstall', op: 'manifest_not_found', name }));
    }

    // 本地插件目录（./plugins/<name>）：默认不删，确认后删除
    const pluginDir = path.join(cwd, 'plugins', name);
    if (fs.existsSync(pluginDir)) {
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `是否删除本地插件目录 "${pluginDir}"?`,
          default: false
        }
      ]);

      if (confirmDelete) {
        await fs.remove(pluginDir);
        logger.success(`已删除插件目录 "${name}"`);
      }
    }
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

    const adapterName = name.startsWith('adapter-') ? name : `adapter-${name}`;
    const pkgName = `@zhin.js/${adapterName}`;
    const shortName = name.replace(/^adapter-/, '');

    // 配置：plugins.<instanceKey> 映射（key 通常是短名）；legacy 数组形态按包名过滤
    await removePluginFromConfig(cwd, shortName, [name, adapterName, pkgName]);

    const pkg = await fs.readJson(pkgPath);
    const removedFromManifest = removeFromZhinManifest(pkg, shortName, [name, adapterName, pkgName]);
    let removedDep = false;
    if (options.removePkg) {
      for (const depName of [name, adapterName, pkgName]) {
        for (const field of ['dependencies', 'devDependencies'] as const) {
          if (pkg[field]?.[depName]) {
            delete pkg[field][depName];
            removedDep = true;
          }
        }
      }
    }
    if (removedFromManifest || removedDep) {
      await fs.writeJson(pkgPath, pkg, { spaces: 2 });
      if (removedFromManifest) logger.success(`已从 package.json 的 zhin.plugins 清单中移除适配器 "${shortName}"`);
      if (removedDep) {
        logger.success(`已从 package.json 中移除依赖`);
        console.log(chalk.yellow('\n请运行 "pnpm install" 更新依赖'));
      }
    }
  });

/** 从 zhin.config.* 移除插件配置：新形态删 plugins.<instanceKey> 键；legacy 数组按名过滤。 */
async function removePluginFromConfig(cwd: string, key: string, aliases: string[] = [key]): Promise<void> {
  const configFile = await findConfigFile(cwd);
  if (!configFile) return;
  const configPath = path.join(cwd, configFile);
  const config = await readConfig(configPath);
  let changed = false;

  if (Array.isArray(config.plugins)) {
    const before = config.plugins.length;
    config.plugins = config.plugins.filter((p: string) => !aliases.includes(p));
    changed = config.plugins.length !== before;
  } else if (config.plugins && typeof config.plugins === 'object') {
    const map = config.plugins as Record<string, unknown>;
    for (const candidate of [key, ...aliases]) {
      if (candidate in map) {
        delete map[candidate];
        changed = true;
      }
    }
  }

  if (changed) {
    await saveConfig(configPath, config);
    logger.success(`已从 ${configFile} 中移除 "${key}" 的配置`);
  }
}

/** 从 package.json 的 zhin.plugins 清单移除条目（按 package 或 instanceKey 匹配）。 */
function removeFromZhinManifest(pkg: Record<string, any>, key: string, aliases: string[] = [key]): boolean {
  const zhin = pkg.zhin;
  if (!zhin || typeof zhin !== 'object' || !Array.isArray(zhin.plugins)) return false;
  const candidates = [key, ...aliases];
  const before = zhin.plugins.length;
  zhin.plugins = zhin.plugins.filter((item: { package?: string; instanceKey?: string }) =>
    !candidates.includes(item?.package ?? '') && !candidates.includes(item?.instanceKey ?? ''));
  return zhin.plugins.length !== before;
}

/** 依赖候选名：原名 + @zhin.js/ 前缀包名。 */
function depNamesFor(name: string): string[] {
  const names = [name];
  if (!name.startsWith('@') && !name.startsWith('.')) names.push(`@zhin.js/${name}`);
  return names;
}

export const uninstallCommand = new Command('uninstall')
  .description('卸载服务、插件或适配器')
  .addCommand(serviceCommand)
  .addCommand(pluginCommand)
  .addCommand(adapterCommand);
