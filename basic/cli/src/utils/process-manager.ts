/**
 * `zhin restart --gateway` against a foreground gateway (#1250): the CLI cannot restart a process
 * attached to a terminal or a service manager in place, so it names the command that can. The
 * manager is read from the gateway process itself (Linux `/proc/<pid>/environ` and `cgroup`; on
 * macOS the launchd job list, `launchctl list`), not from the shell that runs `zhin restart`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ProcessManager =
  | { readonly kind: 'systemd'; readonly unit?: string; readonly user: boolean }
  | { readonly kind: 'pm2'; readonly name?: string; readonly id?: string }
  /** `zhin service install` on macOS loads `~/Library/LaunchAgents/com.zhinjs.<name>.plist` (gui domain). */
  | { readonly kind: 'launchd'; readonly label: string; readonly uid?: number };

/** launchd label `zhin service install` uses for a project named `name`. */
export function launchdLabel(projectName: string): string {
  return `com.zhinjs.${projectName}`;
}

export interface ProcessContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Contents of `/proc/<pid>/cgroup`. */
  readonly cgroup?: string;
}

/** Runs `launchctl list` (tests replace it); its output is `PID\tStatus\tLabel` lines. */
export type LaunchctlList = () => string | undefined;

const defaultLaunchctlList: LaunchctlList = () => {
  try {
    return execFileSync('launchctl', ['list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 });
  } catch {
    return undefined;
  }
};

/**
 * macOS: the label of the launchd job whose process is `pid` (from `launchctl list` of this user's
 * gui domain), as the `XPC_SERVICE_NAME` launchd sets for its jobs. Undefined when no job runs it.
 */
export function readLaunchdContext(pid: number, list: LaunchctlList = defaultLaunchctlList): ProcessContext | undefined {
  const output = list();
  if (!output) return undefined;
  for (const line of output.split('\n')) {
    const [jobPid, , label] = line.trim().split(/\s+/u);
    if (jobPid === String(pid) && label) return { env: { XPC_SERVICE_NAME: label } };
  }
  return undefined;
}

/**
 * Reads a process's environment and cgroup from procfs; on macOS (no procfs) the launchd job that
 * runs it. Undefined where unavailable (Windows, another user, not a launchd job).
 */
export function readProcessContext(
  pid: number,
  procRoot = '/proc',
  options: { readonly platform?: NodeJS.Platform; readonly launchctlList?: LaunchctlList } = {},
): ProcessContext | undefined {
  let environ: string;
  try {
    environ = fs.readFileSync(path.join(procRoot, String(pid), 'environ'), 'utf8');
  } catch {
    return (options.platform ?? process.platform) === 'darwin' ? readLaunchdContext(pid, options.launchctlList) : undefined;
  }
  const env: Record<string, string> = {};
  for (const entry of environ.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  let cgroup: string | undefined;
  try {
    cgroup = fs.readFileSync(path.join(procRoot, String(pid), 'cgroup'), 'utf8');
  } catch {
    cgroup = undefined;
  }
  return { env, ...(cgroup !== undefined ? { cgroup } : {}) };
}

/**
 * systemd sets `INVOCATION_ID` for every unit it starts (the unit name comes from the cgroup
 * path); PM2 sets `pm_id` and `name` for the processes it runs; launchd sets `XPC_SERVICE_NAME` to
 * the job label (a terminal shell has `0` or `application.<app id>…`, which is not a job to restart).
 */
export function detectProcessManager(
  context: ProcessContext | undefined,
  uid: number | undefined = process.getuid?.(),
  platform: NodeJS.Platform = process.platform,
): ProcessManager | undefined {
  if (!context) return undefined;
  const { env } = context;
  if (env.pm_id !== undefined && env.pm_id !== '') {
    return { kind: 'pm2', ...(env.name ? { name: env.name } : {}), id: env.pm_id };
  }
  // XPC_SERVICE_NAME means launchd only on macOS; elsewhere it is just an inherited variable.
  const xpc = platform === 'darwin' ? env.XPC_SERVICE_NAME : undefined;
  if (xpc && xpc !== '0' && !xpc.startsWith('application.')) {
    return { kind: 'launchd', label: xpc, ...(uid !== undefined ? { uid } : {}) };
  }
  if (!env.INVOCATION_ID) return undefined;
  if (context.cgroup === undefined) return { kind: 'systemd', user: false };
  // The process sits directly in a service unit (`/system.slice/bot.service`); a terminal session
  // (`.../vte-spawn-….scope`) also inherits INVOCATION_ID but is not a service to restart.
  const unitPath = context.cgroup
    .split('\n')
    .map(line => line.slice(line.lastIndexOf(':') + 1).trim())
    .find(cgroupPath => /\/[^/]+\.service$/u.test(cgroupPath) && !/\/user@\d+\.service$/u.test(cgroupPath));
  if (unitPath === undefined) return undefined;
  const unit = unitPath.slice(unitPath.lastIndexOf('/') + 1);
  return { kind: 'systemd', unit, user: /\/user@\d+\.service\//u.test(unitPath) };
}

function shellQuote(argument: string): string {
  return /^[\w@%+=:,./-]+$/u.test(argument) ? argument : `'${argument.replace(/'/gu, `'\\''`)}'`;
}

/** The command that restarts the gateway under the detected manager. */
export function managerRestartCommand(manager: ProcessManager): string {
  if (manager.kind === 'pm2') return `pm2 restart ${shellQuote(manager.name ?? manager.id ?? '<应用名>')}`;
  if (manager.kind === 'launchd') return `launchctl kickstart -k gui/${manager.uid ?? '$(id -u)'}/${shellQuote(manager.label)}`;
  const unit = manager.unit ?? '<服务名>.service';
  return manager.user ? `systemctl --user restart ${shellQuote(unit)}` : `sudo systemctl restart ${shellQuote(unit)}`;
}

const MANAGER_LABELS: Readonly<Record<ProcessManager['kind'], string>> = { pm2: 'PM2', systemd: 'systemd', launchd: 'launchd' };

/**
 * The exact command that restarts a running gateway: `zhin restart --gateway` for a background
 * gateway, the service manager's command for a managed foreground one; undefined for a foreground
 * gateway in a terminal (stop it with Ctrl+C and start it again).
 */
export function gatewayRestartCommand(
  gateway: Readonly<{ pid: number; mode: 'foreground' | 'daemon' }>,
  manager: ProcessManager | undefined = gateway.mode === 'daemon' ? undefined : detectProcessManager(readProcessContext(gateway.pid)),
): string | undefined {
  if (gateway.mode === 'daemon') return 'zhin restart --gateway';
  return manager ? managerRestartCommand(manager) : undefined;
}

/** Explanation and replacement commands for `zhin restart --gateway` on a foreground gateway. */
export function describeForegroundGatewayRestart(
  pid: number,
  args: readonly string[],
  manager: ProcessManager | undefined,
): string {
  const startCommand = ['zhin', 'start', '--foreground', ...args].map(shellQuote).join(' ');
  const lines = [
    `当前网关以前台方式运行（pid ${pid}），zhin restart --gateway 只能原地重启后台网关（zhin start）。`,
    `The gateway runs in the foreground (pid ${pid}); zhin restart --gateway only restarts a background gateway.`,
  ];
  if (manager) {
    const label = MANAGER_LABELS[manager.kind];
    lines.push(`检测到由 ${label} 管理，请通过它重启 / managed by ${label}, restart it with:`);
    lines.push(`  ${managerRestartCommand(manager)}`);
    lines.push(`或在其终端按 Ctrl+C 后重新执行 / or press Ctrl+C in its terminal and run again:`);
  } else {
    lines.push('请通过 systemd / PM2 / launchd 等服务管理器重启该服务（如 sudo systemctl restart <服务名>、launchctl kickstart -k gui/$(id -u)/com.zhinjs.<项目名>、pm2 restart <应用名>），');
    lines.push('或在其终端按 Ctrl+C 后重新执行 / or restart it with your service manager, or press Ctrl+C in its terminal and run again:');
  }
  lines.push(`  ${startCommand}`);
  lines.push('只重启实例（网关保持运行）/ restart only the instance: zhin restart');
  return lines.join('\n');
}
