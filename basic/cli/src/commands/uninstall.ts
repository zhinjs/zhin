import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { execSync } from 'child_process';
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
    logger.warn('服务未安装');
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
  } catch (error: any) {
    logger.error(`卸载服务失败: ${error.message}`);
    process.exit(1);
  }
}

async function uninstallMacService(serviceName: string): Promise<void> {
  const plistFile = path.join(process.env.HOME!, 'Library', 'LaunchAgents', `${serviceName}.plist`);
  
  if (!fs.existsSync(plistFile)) {
    logger.warn('服务未安装');
    return;
  }

  try {
    // 卸载服务
    execSync(`launchctl unload ${plistFile}`, { stdio: 'inherit' });
    // 删除 plist 文件
    await fs.remove(plistFile);
    
    logger.success('服务已卸载');
  } catch (error: any) {
    logger.error(`卸载服务失败: ${error.message}`);
    process.exit(1);
  }
}

async function uninstallWindowsService(serviceName: string): Promise<void> {
  try {
    // 检查服务是否存在
    const services = execSync('sc query', { encoding: 'utf-8' });
    if (!services.includes(serviceName)) {
      logger.warn('服务未安装');
      return;
    }

    // 停止服务
    execSync(`sc stop ${serviceName}`, { stdio: 'inherit' });
    // 删除服务
    execSync(`sc delete ${serviceName}`, { stdio: 'inherit' });
    
    logger.success('服务已卸载');
  } catch (error: any) {
    logger.error(`卸载服务失败: ${error.message}`);
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
      logger.info('已取消');
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
  .argument('<name>', '插件名称')
  .option('--remove-pkg', '同时从 package.json 中移除依赖')
  .action(async (name: string, options: { removePkg?: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');
    
    if (!fs.existsSync(pkgPath)) {
      logger.error('当前目录不是有效的项目');
      process.exit(1);
    }

    // 从配置文件中移除
    const configFile = await findConfigFile(cwd);
    if (configFile) {
      const configPath = path.join(cwd, configFile);
      const config = await readConfig(configPath);
      
      if (config.plugins && Array.isArray(config.plugins)) {
        const index = config.plugins.indexOf(name);
        if (index !== -1) {
          config.plugins.splice(index, 1);
          await saveConfig(configPath, config);
          logger.success(`已从配置文件中移除插件 "${name}"`);
        } else {
          logger.warn(`配置文件中未找到插件 "${name}"`);
        }
      }
    }

    // 从 package.json 中移除依赖
    if (options.removePkg) {
      const pkg = await fs.readJson(pkgPath);
      let removed = false;
      
      if (pkg.dependencies && pkg.dependencies[name]) {
        delete pkg.dependencies[name];
        removed = true;
      }
      
      if (pkg.devDependencies && pkg.devDependencies[name]) {
        delete pkg.devDependencies[name];
        removed = true;
      }
      
      if (removed) {
        await fs.writeJson(pkgPath, pkg, { spaces: 2 });
        logger.success(`已从 package.json 中移除依赖 "${name}"`);
        
        // 提示用户重新安装依赖
        console.log(chalk.yellow('\n请运行 "pnpm install" 更新依赖'));
      } else {
        logger.warn(`package.json 中未找到依赖 "${name}"`);
      }
    }

    // 删除插件目录（如果在 src/plugins 中）
    const pluginDir = path.join(cwd, 'src', 'plugins', name);
    if (fs.existsSync(pluginDir)) {
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `是否删除插件目录 "${pluginDir}"?`,
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

    // 从配置文件中移除
    const configFile = await findConfigFile(cwd);
    if (configFile) {
      const configPath = path.join(cwd, configFile);
      const config = await readConfig(configPath);
      
      // 移除插件引用
      if (config.plugins && Array.isArray(config.plugins)) {
        const pluginNames = [name, adapterName, pkgName];
        let removed = false;
        
        config.plugins = config.plugins.filter((p: string) => {
          if (pluginNames.includes(p)) {
            removed = true;
            return false;
          }
          return true;
        });
        
        if (removed) {
          await saveConfig(configPath, config);
          logger.success(`已从配置文件中移除适配器 "${name}"`);
        }
      }
      
      // 移除 bot 配置
      if (config.bots && Array.isArray(config.bots)) {
        const context = name.replace(/^adapter-/, '');
        config.bots = config.bots.filter((bot: any) => bot.context !== context);
        await saveConfig(configPath, config);
      }
    }

    // 从 package.json 中移除依赖
    if (options.removePkg) {
      const pkg = await fs.readJson(pkgPath);
      let removed = false;
      
      for (const depName of [name, adapterName, pkgName]) {
        if (pkg.dependencies && pkg.dependencies[depName]) {
          delete pkg.dependencies[depName];
          removed = true;
        }
        
        if (pkg.devDependencies && pkg.devDependencies[depName]) {
          delete pkg.devDependencies[depName];
          removed = true;
        }
      }
      
      if (removed) {
        await fs.writeJson(pkgPath, pkg, { spaces: 2 });
        logger.success(`已从 package.json 中移除依赖`);
        console.log(chalk.yellow('\n请运行 "pnpm install" 更新依赖'));
      }
    }
  });

export const uninstallCommand = new Command('uninstall')
  .description('卸载服务、插件或适配器')
  .addCommand(serviceCommand)
  .addCommand(pluginCommand)
  .addCommand(adapterCommand);
