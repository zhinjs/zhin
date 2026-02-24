import { Command } from 'commander';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';

async function getProjectName(): Promise<string> {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');
  if (!(await fs.pathExists(pkgPath))) {
    logger.error('当前目录未找到 package.json，请在项目根目录执行');
    process.exit(1);
  }
  const packageJson = await fs.readJson(pkgPath);
  return packageJson.name || 'zhin-bot';
}

// --- Linux systemd ---
async function installSystemd(cwd: string, projectName: string, userMode: boolean): Promise<void> {
  const serviceFile = path.join(cwd, `${projectName}.service`);
  if (!(await fs.pathExists(serviceFile))) {
    logger.error(`未找到服务文件: ${serviceFile}`);
    logger.log('请使用 create-zhin 创建的项目或手动创建 .service 文件');
    process.exit(1);
  }

  let content = await fs.readFile(serviceFile, 'utf-8');
  content = content.replace(/%i/g, os.userInfo().username);

  if (userMode) {
    const userDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    await fs.ensureDir(userDir);
    const targetPath = path.join(userDir, `${projectName}.service`);
    await fs.writeFile(targetPath, content);
    logger.success(`已安装用户服务: ${targetPath}`);

    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
      logger.success('已执行 daemon-reload');
    } catch (e) {
      logger.warn('daemon-reload 执行失败，请手动执行');
    }

    logger.log('');
    logger.info('启用并启动服务：');
    logger.log('  systemctl --user enable ' + projectName + '.service');
    logger.log('  systemctl --user start ' + projectName + '.service');
    logger.info('查看状态：systemctl --user status ' + projectName + '.service');
    logger.info('查看日志：journalctl --user -u ' + projectName + '.service -f');
  } else {
    const targetPath = `/etc/systemd/system/${projectName}.service`;
    logger.info('系统级安装需要 root 权限，请执行：');
    logger.log('');
    logger.log(`  sudo cp ${serviceFile} ${targetPath}`);
    logger.log('  sudo systemctl daemon-reload');
    logger.log('  sudo systemctl enable ' + projectName + '.service');
    logger.log('  sudo systemctl start ' + projectName + '.service');
    logger.log('');
    logger.info('查看状态：sudo systemctl status ' + projectName + '.service');
  }
}

async function uninstallSystemd(projectName: string, userMode: boolean): Promise<void> {
  if (userMode) {
    const targetPath = path.join(os.homedir(), '.config', 'systemd', 'user', `${projectName}.service`);
    if (!(await fs.pathExists(targetPath))) {
      logger.warn('用户服务未安装或已删除');
      return;
    }
    try {
      execSync(`systemctl --user stop ${projectName}.service`, { stdio: 'inherit' });
    } catch {}
    try {
      execSync(`systemctl --user disable ${projectName}.service`, { stdio: 'inherit' });
    } catch {}
    await fs.remove(targetPath);
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    } catch {}
    logger.success('已卸载用户服务');
  } else {
    logger.info('请手动执行以下命令卸载系统服务：');
    logger.log('  sudo systemctl stop ' + projectName + '.service');
    logger.log('  sudo systemctl disable ' + projectName + '.service');
    logger.log('  sudo rm /etc/systemd/system/' + projectName + '.service');
    logger.log('  sudo systemctl daemon-reload');
  }
}

// --- macOS launchd ---
async function installLaunchd(cwd: string, projectName: string): Promise<void> {
  const plistFile = path.join(cwd, `com.zhinjs.${projectName}.plist`);
  if (!(await fs.pathExists(plistFile))) {
    logger.error(`未找到 launchd 配置: ${plistFile}`);
    logger.log('请使用 create-zhin 创建的项目或手动创建 .plist 文件');
    process.exit(1);
  }

  const targetDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  await fs.ensureDir(targetDir);
  const targetPath = path.join(targetDir, `com.zhinjs.${projectName}.plist`);
  await fs.copy(plistFile, targetPath);
  logger.success(`已安装服务: ${targetPath}`);

  try {
    execSync(`launchctl load ${targetPath}`, { stdio: 'inherit' });
    logger.success('服务已加载并启动');
  } catch (e) {
    logger.warn('launchctl load 失败，请手动执行: launchctl load ' + targetPath);
  }

  logger.log('');
  logger.info('查看状态：launchctl list | grep ' + projectName);
  logger.info('停止服务：launchctl unload ' + targetPath);
}

async function uninstallLaunchd(projectName: string): Promise<void> {
  const targetPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.zhinjs.${projectName}.plist`);
  if (!(await fs.pathExists(targetPath))) {
    logger.warn('服务未安装或已删除');
    return;
  }
  try {
    execSync(`launchctl unload ${targetPath}`, { stdio: 'inherit' });
  } catch {}
  await fs.remove(targetPath);
  logger.success('已卸载服务');
}

// --- Windows ---
async function installWindows(cwd: string, projectName: string): Promise<void> {
  const psScript = path.join(cwd, 'install-service.ps1');
  const taskXml = path.join(cwd, `${projectName}-task.xml`);

  logger.info('Windows 请任选一种方式安装服务：');
  logger.log('');
  logger.info('方式一：NSSM（推荐）');
  logger.log('  1. 安装 NSSM: choco install nssm 或 scoop install nssm');
  logger.log('  2. 以管理员打开 PowerShell:');
  logger.log(`     cd "${cwd}"`);
  logger.log('     .\\install-service.ps1');
  logger.log('');
  logger.info('方式二：任务计划程序');
  logger.log(`  schtasks /Create /TN "${projectName}" /XML "${taskXml}"`);
  logger.log('');
  logger.info('方式三：PM2');
  logger.log('  pnpm pm2:start && pm2 startup && pm2 save');
}

async function uninstallWindows(projectName: string): Promise<void> {
  logger.info('请手动执行以下之一卸载：');
  logger.log('  NSSM:    nssm stop ' + projectName + ' && nssm remove ' + projectName + ' confirm');
  logger.log('  计划任务: schtasks /End /TN "' + projectName + '" && schtasks /Delete /TN "' + projectName + '" /F');
}

// --- status ---
async function statusSystemd(projectName: string, userMode: boolean): Promise<void> {
  try {
    const opt = userMode ? '--user' : '';
    execSync(`systemctl ${opt} status ${projectName}.service`, { stdio: 'inherit' });
  } catch (e: any) {
    if (e.status !== 0) logger.warn('服务未运行或未安装');
  }
}

async function statusLaunchd(projectName: string): Promise<void> {
  try {
    const out = execSync(`launchctl list | grep com.zhinjs.${projectName}`, { encoding: 'utf-8' });
    logger.log(out || '未找到');
  } catch {
    logger.log('服务未加载');
  }
}

// --- 子命令 ---
const installCmd = new Command('install')
  .description('安装系统服务（开机自启）')
  .option('--user', 'Linux 下使用用户级 systemd', false)
  .action(async (opts: { user?: boolean }) => {
    const cwd = process.cwd();
    const projectName = await getProjectName();
    const platform = os.platform();

    if (platform === 'linux') {
      await installSystemd(cwd, projectName, opts.user ?? false);
    } else if (platform === 'darwin') {
      await installLaunchd(cwd, projectName);
    } else if (platform === 'win32') {
      await installWindows(cwd, projectName);
    } else {
      logger.error('当前系统暂不支持: ' + platform);
      process.exit(1);
    }
  });

const uninstallCmd = new Command('uninstall')
  .description('卸载系统服务')
  .option('--user', 'Linux 下卸载用户级 systemd', false)
  .action(async (opts: { user?: boolean }) => {
    const projectName = await getProjectName();
    const platform = os.platform();

    if (platform === 'linux') {
      await uninstallSystemd(projectName, opts.user ?? false);
    } else if (platform === 'darwin') {
      await uninstallLaunchd(projectName);
    } else if (platform === 'win32') {
      await uninstallWindows(projectName);
    } else {
      logger.error('当前系统暂不支持: ' + platform);
      process.exit(1);
    }
  });

const statusCmd = new Command('status')
  .description('查看服务运行状态（仅 Linux/macOS）')
  .option('--user', 'Linux 下查看用户级服务', false)
  .action(async (opts: { user?: boolean }) => {
    const projectName = await getProjectName();
    const platform = os.platform();

    if (platform === 'linux') {
      await statusSystemd(projectName, opts.user ?? false);
    } else if (platform === 'darwin') {
      await statusLaunchd(projectName);
    } else {
      logger.info('Windows 请使用: schtasks /Query /TN "' + projectName + '"');
    }
  });

export const serviceCommand = new Command('service')
  .description('管理系统服务（开机自启 / 守护）')
  .addCommand(installCmd)
  .addCommand(uninstallCmd)
  .addCommand(statusCmd);
