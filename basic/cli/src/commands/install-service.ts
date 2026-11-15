/**
 * `zhin service install | uninstall | start | stop | restart | status` (ADR 0062 §2): the one way to
 * run the bot as a system service. The service file is generated here for the current system
 * (systemd / launchd / Windows Task Scheduler) with this machine's absolute node and CLI paths; the
 * scaffold no longer writes any.
 */
import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import {
  launchdLabel,
  readServiceProjectName,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTask,
  resolveServiceCommand,
  type ServiceCommand,
} from '../utils/service-definition.js';

async function getProjectName(): Promise<string> {
  const name = await readServiceProjectName(process.cwd());
  if (!name) {
    logger.error('当前目录未找到 package.json，请在项目根目录执行');
    process.exit(1);
  }
  return name;
}

/** Runs a service manager command; returns false (after printing it) when it fails. */
function run(command: string, args: readonly string[], options: { quiet?: boolean } = {}): boolean {
  try {
    execFileSync(command, [...args], { stdio: options.quiet ? 'ignore' : 'inherit' });
    return true;
  } catch {
    if (!options.quiet) logger.warn(`执行失败：${command} ${args.join(' ')}`);
    return false;
  }
}

function describeCommand(command: ServiceCommand): void {
  output.line(`  启动命令：${[command.node, command.cli, ...command.args].join(' ')}`);
  if (!command.projectCli) {
    logger.warn('项目里没有安装 @zhin.js/cli，服务使用当前 CLI 的路径；建议先 pnpm add -D @zhin.js/cli 再重新安装服务');
  }
  output.line('  更换 Node 版本或移动项目目录后，请重新运行 zhin service install。');
}

/** Scaffold files written before ADR 0062 §2: no longer read. */
async function mentionLegacyFiles(cwd: string, projectName: string): Promise<void> {
  const legacy = [
    `${projectName}.service`, `${launchdLabel(projectName)}.plist`, 'install-service.ps1', `${projectName}-task.xml`,
  ].filter((name) => fs.existsSync(path.join(cwd, name)));
  if (legacy.length) {
    output.line(`  项目根目录的旧服务模板不再使用，可以删除：${legacy.join('、')}`);
  }
}

// --- Linux systemd ---
async function installSystemd(cwd: string, projectName: string, userMode: boolean): Promise<void> {
  const command = resolveServiceCommand(cwd);
  const unit = renderSystemdUnit(projectName, command, { user: userMode, username: os.userInfo().username });
  if (userMode) {
    const userDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    await fs.ensureDir(userDir);
    const targetPath = path.join(userDir, `${projectName}.service`);
    await fs.writeFile(targetPath, unit);
    logger.success(`已安装用户服务：${targetPath}`);
    describeCommand(command);
    if (run('systemctl', ['--user', 'daemon-reload'])) {
      if (run('systemctl', ['--user', 'enable', `${projectName}.service`])) logger.success('已设为开机自启');
    }
    output.line();
    output.line(`  启动：zhin service start --user（或 systemctl --user start ${projectName}.service）`);
    output.line(`  日志：journalctl --user -u ${projectName}.service -f`);
    output.line(`  退出登录后继续运行：loginctl enable-linger ${os.userInfo().username}`);
  } else {
    const generated = path.join(cwd, '.zhin', 'service', `${projectName}.service`);
    await fs.ensureDir(path.dirname(generated));
    await fs.writeFile(generated, unit);
    const targetPath = `/etc/systemd/system/${projectName}.service`;
    logger.success(`已生成系统服务文件：${generated}`);
    describeCommand(command);
    output.line();
    output.line('  系统级安装需要 root，请执行：');
    output.line(`  sudo cp ${generated} ${targetPath}`);
    output.line('  sudo systemctl daemon-reload');
    output.line(`  sudo systemctl enable --now ${projectName}.service`);
    output.line();
    output.line('  不需要 root 时可改用用户服务：zhin service install --user');
  }
  await mentionLegacyFiles(cwd, projectName);
}

function systemctl(userMode: boolean, args: readonly string[]): boolean {
  return userMode ? run('systemctl', ['--user', ...args]) : run('sudo', ['systemctl', ...args]);
}

async function uninstallSystemd(projectName: string, userMode: boolean): Promise<void> {
  if (userMode) {
    const targetPath = path.join(os.homedir(), '.config', 'systemd', 'user', `${projectName}.service`);
    if (!(await fs.pathExists(targetPath))) {
      logger.warn(`未安装用户服务：${targetPath}`);
      return;
    }
    run('systemctl', ['--user', 'stop', `${projectName}.service`], { quiet: true });
    run('systemctl', ['--user', 'disable', `${projectName}.service`], { quiet: true });
    await fs.remove(targetPath);
    run('systemctl', ['--user', 'daemon-reload'], { quiet: true });
    logger.success('已卸载用户服务');
  } else {
    logger.info('卸载系统服务需要 root，请执行：');
    output.line(`  sudo systemctl disable --now ${projectName}.service`);
    output.line(`  sudo rm /etc/systemd/system/${projectName}.service`);
    output.line('  sudo systemctl daemon-reload');
  }
}

// --- macOS launchd ---
function launchdDomain(): string {
  return `gui/${os.userInfo().uid}`;
}

function launchdPlistPath(projectName: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchdLabel(projectName)}.plist`);
}

function launchdLoaded(projectName: string): boolean {
  return run('launchctl', ['print', `${launchdDomain()}/${launchdLabel(projectName)}`], { quiet: true });
}

async function installLaunchd(cwd: string, projectName: string): Promise<void> {
  const command = resolveServiceCommand(cwd);
  const targetPath = launchdPlistPath(projectName);
  await fs.ensureDir(path.dirname(targetPath));
  await fs.ensureDir(path.join(cwd, '.zhin', 'logs'));
  // Re-installing replaces the loaded definition.
  if (launchdLoaded(projectName)) run('launchctl', ['bootout', `${launchdDomain()}/${launchdLabel(projectName)}`], { quiet: true });
  await fs.writeFile(targetPath, renderLaunchdPlist(projectName, command));
  logger.success(`已安装服务：${targetPath}`);
  describeCommand(command);
  if (run('launchctl', ['bootstrap', launchdDomain(), targetPath])) logger.success('服务已加载并启动（登录后自动启动）');
  output.line();
  output.line('  状态：zhin service status；停止：zhin service stop；重启：zhin service restart');
  output.line(`  日志：zhin logs -f（launchd 输出：${path.join(cwd, '.zhin', 'logs', 'launchd-stderr.log')}）`);
  await mentionLegacyFiles(cwd, projectName);
}

async function uninstallLaunchd(projectName: string): Promise<void> {
  const targetPath = launchdPlistPath(projectName);
  if (!(await fs.pathExists(targetPath))) {
    logger.warn(`未安装服务：${targetPath}`);
    return;
  }
  run('launchctl', ['bootout', `${launchdDomain()}/${launchdLabel(projectName)}`], { quiet: true });
  await fs.remove(targetPath);
  logger.success('已卸载服务');
}

// --- Windows ---
async function installWindows(cwd: string, projectName: string): Promise<void> {
  const command = resolveServiceCommand(cwd);
  const taskXml = path.join(cwd, '.zhin', 'service', `${projectName}-task.xml`);
  await fs.ensureDir(path.dirname(taskXml));
  await fs.writeFile(taskXml, renderWindowsTask(projectName, command));
  logger.success(`已生成计划任务定义：${taskXml}`);
  describeCommand(command);
  output.line();
  output.line('  方式一：计划任务（开机启动，失败后重试）');
  output.line(`    schtasks /Create /TN "${projectName}" /XML "${taskXml}"`);
  output.line();
  output.line('  方式二：NSSM（Windows 服务，需先 choco install nssm 或 scoop install nssm，以管理员运行）');
  output.line(`    nssm install ${projectName} "${command.node}" "${command.cli}" ${command.args.join(' ')}`);
  output.line(`    nssm set ${projectName} AppDirectory "${cwd}"`);
  output.line(`    nssm set ${projectName} AppEnvironmentExtra NODE_ENV=production`);
  output.line(`    nssm set ${projectName} AppExit 0 Exit`);
  output.line(`    nssm start ${projectName}`);
  await mentionLegacyFiles(cwd, projectName);
}

async function uninstallWindows(projectName: string): Promise<void> {
  logger.info('手动卸载，见下方命令');
  output.line(`  计划任务: schtasks /End /TN "${projectName}" && schtasks /Delete /TN "${projectName}" /F`);
  output.line(`  NSSM:    nssm stop ${projectName} && nssm remove ${projectName} confirm`);
}

// --- start / stop / restart / status ---
type ServiceAction = 'start' | 'stop' | 'restart';

function controlSystemd(projectName: string, userMode: boolean, action: ServiceAction): boolean {
  return systemctl(userMode, [action, `${projectName}.service`]);
}

function controlLaunchd(projectName: string, action: ServiceAction): boolean {
  const target = `${launchdDomain()}/${launchdLabel(projectName)}`;
  if (!fs.existsSync(launchdPlistPath(projectName))) {
    logger.error('未安装服务：先运行 zhin service install');
    return false;
  }
  if (action === 'stop') {
    // SIGTERM → the gateway stops the instance and exits 0; KeepAlive.SuccessfulExit=false keeps it down.
    return !launchdLoaded(projectName) || run('launchctl', ['kill', 'SIGTERM', target]);
  }
  if (!launchdLoaded(projectName)) return run('launchctl', ['bootstrap', launchdDomain(), launchdPlistPath(projectName)]);
  return run('launchctl', action === 'restart' ? ['kickstart', '-k', target] : ['kickstart', target]);
}

function controlWindows(projectName: string, action: ServiceAction): boolean {
  if (action !== 'start') run('schtasks', ['/End', '/TN', projectName]);
  return action === 'stop' ? true : run('schtasks', ['/Run', '/TN', projectName]);
}

const ACTION_LABELS: Record<ServiceAction, string> = { start: '已启动', stop: '已停止', restart: '已重启' };

function controlCommand(action: ServiceAction, description: string): Command {
  return new Command(action)
    .description(description)
    .option('--user', 'Linux 下使用用户级 systemd', false)
    .action(async (opts: { user?: boolean }) => {
      const projectName = await getProjectName();
      const platform = os.platform();
      const ok = platform === 'linux'
        ? controlSystemd(projectName, opts.user ?? false, action)
        : platform === 'darwin'
          ? controlLaunchd(projectName, action)
          : platform === 'win32'
            ? controlWindows(projectName, action)
            : (logger.error(`当前系统暂不支持：${platform}`), false);
      if (ok) logger.success(`服务${ACTION_LABELS[action]}`);
      else process.exitCode = 1;
    });
}

async function statusSystemd(projectName: string, userMode: boolean): Promise<void> {
  try {
    const args = userMode
      ? ['--user', 'status', `${projectName}.service`]
      : ['status', `${projectName}.service`];
    execFileSync('systemctl', args, { stdio: 'inherit' });
  } catch (e: unknown) {
    const err = e as { status?: number | null };
    if (err.status !== 0) logger.warn('服务未在运行');
  }
}

async function statusLaunchd(projectName: string): Promise<void> {
  try {
    const out = execFileSync('launchctl', ['print', `${launchdDomain()}/${launchdLabel(projectName)}`], { encoding: 'utf-8' });
    const state = /^\s*state = (.+)$/mu.exec(out)?.[1] ?? '未知';
    const pid = /^\s*pid = (\d+)$/mu.exec(out)?.[1];
    output.line(`服务 ${launchdLabel(projectName)}：${state}${pid ? `（pid ${pid}）` : ''}`);
  } catch {
    output.line(fs.existsSync(launchdPlistPath(projectName)) ? '服务已安装但未加载（zhin service start 启动）' : '未安装服务（zhin service install）');
  }
}

// --- 子命令 ---
const installCmd = new Command('install')
  .description('按当前系统生成并安装系统服务（开机自启）')
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
  .description('查看服务运行状态')
  .option('--user', 'Linux 下查看用户级服务', false)
  .action(async (opts: { user?: boolean }) => {
    const projectName = await getProjectName();
    const platform = os.platform();

    if (platform === 'linux') {
      await statusSystemd(projectName, opts.user ?? false);
    } else if (platform === 'darwin') {
      await statusLaunchd(projectName);
    } else {
      output.line(`  schtasks /Query /TN "${projectName}"`);
    }
  });

export const serviceCommand = new Command('service')
  .description('管理系统服务（开机自启 / 守护）')
  .addCommand(installCmd)
  .addCommand(uninstallCmd)
  .addCommand(controlCommand('start', '启动系统服务'))
  .addCommand(controlCommand('stop', '停止系统服务（不会被立即重新拉起）'))
  .addCommand(controlCommand('restart', '重启系统服务（网关与实例）'))
  .addCommand(statusCmd);
