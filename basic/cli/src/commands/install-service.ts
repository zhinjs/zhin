import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const installServiceCommand = new Command('install-service')
  .description('安装系统服务（systemd/launchd），实现开机自启和守护进程监督')
  .option('--user', '以用户模式安装（systemd user service）', false)
  .action(async (options: { user: boolean }) => {
    try {
      const cwd = process.cwd();
      const platform = os.platform();
      const packageJson = await fs.readJson(path.join(cwd, 'package.json'));
      const projectName = packageJson.name || 'zhin-bot';

      if (platform === 'linux') {
        await installSystemdService(cwd, projectName, options.user);
      } else if (platform === 'darwin') {
        await installLaunchdService(cwd, projectName);
      } else if (platform === 'win32') {
        await installWindowsService(cwd, projectName);
      } else {
        logger.error(`不支持的操作系统: ${platform}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`安装服务失败: ${error}`);
      process.exit(1);
    }
  });

async function installSystemdService(cwd: string, projectName: string, userMode: boolean): Promise<void> {
  const serviceFile = path.join(cwd, `${projectName}.service`);
  
  if (!fs.existsSync(serviceFile)) {
    logger.error(`未找到 systemd 配置文件: ${serviceFile}`);
    logger.info('请确保项目是通过 create-zhin-app 创建的');
    process.exit(1);
  }

  const serviceContent = await fs.readFile(serviceFile, 'utf-8');
  const finalContent = serviceContent.replace(/%i/g, os.userInfo().username);

  if (userMode) {
    // 用户模式：安装到 ~/.config/systemd/user/
    const userServiceDir = path.join(os.homedir(), '.config/systemd/user');
    await fs.ensureDir(userServiceDir);
    const targetPath = path.join(userServiceDir, `${projectName}.service`);
    
    await fs.writeFile(targetPath, finalContent);
    logger.success(`✅ 服务文件已复制到: ${targetPath}`);
    
    logger.info('');
    logger.info('📝 执行以下命令启用服务：');
    logger.info('');
    console.log(`  systemctl --user daemon-reload`);
    console.log(`  systemctl --user enable ${projectName}.service`);
    console.log(`  systemctl --user start ${projectName}.service`);
    logger.info('');
    logger.info('📊 查看服务状态：');
    console.log(`  systemctl --user status ${projectName}.service`);
    logger.info('');
    logger.info('📋 查看日志：');
    console.log(`  journalctl --user -u ${projectName}.service -f`);
    
  } else {
    // 系统模式：需要 sudo 安装到 /etc/systemd/system/
    const targetPath = `/etc/systemd/system/${projectName}.service`;
    
    logger.info('🔐 需要 sudo 权限安装系统服务');
    logger.info('');
    logger.info('📝 执行以下命令：');
    logger.info('');
    console.log(`  sudo cp ${serviceFile} ${targetPath}`);
    console.log(`  sudo systemctl daemon-reload`);
    console.log(`  sudo systemctl enable ${projectName}.service`);
    console.log(`  sudo systemctl start ${projectName}.service`);
    logger.info('');
    logger.info('📊 查看服务状态：');
    console.log(`  sudo systemctl status ${projectName}.service`);
    logger.info('');
    logger.info('📋 查看日志：');
    console.log(`  sudo journalctl -u ${projectName}.service -f`);
  }
}

async function installLaunchdService(cwd: string, projectName: string): Promise<void> {
  const plistFile = path.join(cwd, `com.zhinjs.${projectName}.plist`);
  
  if (!fs.existsSync(plistFile)) {
    logger.error(`未找到 launchd 配置文件: ${plistFile}`);
    logger.info('请确保项目是通过 create-zhin-app 创建的');
    process.exit(1);
  }

  const targetDir = path.join(os.homedir(), 'Library/LaunchAgents');
  await fs.ensureDir(targetDir);
  const targetPath = path.join(targetDir, `com.zhinjs.${projectName}.plist`);
  
  await fs.copy(plistFile, targetPath);
  logger.success(`✅ 服务文件已复制到: ${targetPath}`);
  
  logger.info('');
  logger.info('📝 执行以下命令启用服务：');
  logger.info('');
  console.log(`  launchctl load ${targetPath}`);
  console.log(`  launchctl start com.zhinjs.${projectName}`);
  logger.info('');
  logger.info('📊 查看服务状态：');
  console.log(`  launchctl list | grep ${projectName}`);
  logger.info('');
  logger.info('🛑 停止服务：');
  console.log(`  launchctl stop com.zhinjs.${projectName}`);
  console.log(`  launchctl unload ${targetPath}`);
  logger.info('');
  logger.info('📋 查看日志：');
  console.log(`  tail -f ${path.join(cwd, 'logs/launchd-stdout.log')}`);
}

async function installWindowsService(cwd: string, projectName: string): Promise<void> {
  const psScript = path.join(cwd, 'install-service.ps1');
  const taskXml = path.join(cwd, `${projectName}-task.xml`);
  
  if (!fs.existsSync(psScript)) {
    logger.error(`未找到 PowerShell 脚本: ${psScript}`);
    logger.info('请确保项目是通过 create-zhin-app 创建的');
    process.exit(1);
  }

  logger.info('');
  logger.info('🪟 Windows 系统服务安装');
  logger.info('');
  logger.info('📝 方式一：使用 NSSM（推荐）');
  logger.info('');
  logger.info('1. 安装 NSSM：');
  console.log('   choco install nssm        # 使用 Chocolatey');
  console.log('   scoop install nssm        # 使用 Scoop');
  console.log('   # 或从 https://nssm.cc/download 下载');
  logger.info('');
  logger.info('2. 以管理员身份运行 PowerShell，执行：');
  console.log(`   cd "${cwd}"`);
  console.log(`   .\\install-service.ps1`);
  logger.info('');
  logger.info('3. 启动服务：');
  console.log(`   nssm start ${projectName}`);
  logger.info('');
  logger.info('📝 方式二：使用任务计划程序');
  logger.info('');
  logger.info('1. 以管理员身份运行 PowerShell，执行：');
  console.log(`   schtasks /Create /TN "${projectName}" /XML "${taskXml}"`);
  logger.info('');
  logger.info('2. 启动任务：');
  console.log(`   schtasks /Run /TN "${projectName}"`);
  logger.info('');
  logger.info('3. 查看状态：');
  console.log(`   schtasks /Query /TN "${projectName}"`);
  logger.info('');
  logger.info('📝 方式三：使用 PM2');
  logger.info('');
  console.log('   pnpm pm2:start');
  console.log('   pm2 startup');
  console.log('   pm2 save');
}

export const uninstallServiceCommand = new Command('uninstall-service')
  .description('卸载系统服务')
  .option('--user', '卸载用户模式服务（systemd user service）', false)
  .action(async (options: { user: boolean }) => {
    try {
      const cwd = process.cwd();
      const platform = os.platform();
      const packageJson = await fs.readJson(path.join(cwd, 'package.json'));
      const projectName = packageJson.name || 'zhin-bot';

      if (platform === 'linux') {
        if (options.user) {
          logger.info('📝 执行以下命令卸载用户服务：');
          console.log(`  systemctl --user stop ${projectName}.service`);
          console.log(`  systemctl --user disable ${projectName}.service`);
          console.log(`  rm ~/.config/systemd/user/${projectName}.service`);
          console.log(`  systemctl --user daemon-reload`);
        } else {
          logger.info('📝 执行以下命令卸载系统服务：');
          console.log(`  sudo systemctl stop ${projectName}.service`);
          console.log(`  sudo systemctl disable ${projectName}.service`);
          console.log(`  sudo rm /etc/systemd/system/${projectName}.service`);
          console.log(`  sudo systemctl daemon-reload`);
        }
      } else if (platform === 'darwin') {
        const plistPath = path.join(os.homedir(), `Library/LaunchAgents/com.zhinjs.${projectName}.plist`);
        logger.info('📝 执行以下命令卸载服务：');
        console.log(`  launchctl stop com.zhinjs.${projectName}`);
        console.log(`  launchctl unload ${plistPath}`);
        console.log(`  rm ${plistPath}`);
      } else if (platform === 'win32') {
        logger.info('📝 方式一：卸载 NSSM 服务');
        console.log(`  nssm stop ${projectName}`);
        console.log(`  nssm remove ${projectName} confirm`);
        logger.info('');
        logger.info('📝 方式二：删除任务计划');
        console.log(`  schtasks /End /TN "${projectName}"`);
        console.log(`  schtasks /Delete /TN "${projectName}" /F`);
      } else {
        logger.error(`不支持的操作系统: ${platform}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`卸载服务失败: ${error}`);
      process.exit(1);
    }
  });
