/**
 * `zhin restart --gateway` against a foreground gateway (#1250): the CLI cannot restart a process
 * attached to a terminal or a service manager in place, so it names the command that can. The
 * manager is read from the gateway process itself (Linux `/proc/<pid>/environ` and `cgroup`), not
 * from the shell that runs `zhin restart`.
 */
import fs from 'node:fs';
import path from 'node:path';

export type ProcessManager =
  | { readonly kind: 'systemd'; readonly unit?: string; readonly user: boolean }
  | { readonly kind: 'pm2'; readonly name?: string; readonly id?: string };

export interface ProcessContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Contents of `/proc/<pid>/cgroup`. */
  readonly cgroup?: string;
}

/** Reads a process's environment and cgroup from procfs; undefined where unavailable (macOS, Windows, other user). */
export function readProcessContext(pid: number, procRoot = '/proc'): ProcessContext | undefined {
  let environ: string;
  try {
    environ = fs.readFileSync(path.join(procRoot, String(pid), 'environ'), 'utf8');
  } catch {
    return undefined;
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
 * path); PM2 sets `pm_id` and `name` for the processes it runs.
 */
export function detectProcessManager(context: ProcessContext | undefined): ProcessManager | undefined {
  if (!context) return undefined;
  const { env } = context;
  if (env.pm_id !== undefined && env.pm_id !== '') {
    return { kind: 'pm2', ...(env.name ? { name: env.name } : {}), id: env.pm_id };
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
  const unit = manager.unit ?? '<服务名>.service';
  return manager.user ? `systemctl --user restart ${shellQuote(unit)}` : `sudo systemctl restart ${shellQuote(unit)}`;
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
    const label = manager.kind === 'pm2' ? 'PM2' : 'systemd';
    lines.push(`检测到由 ${label} 管理，请通过它重启 / managed by ${label}, restart it with:`);
    lines.push(`  ${managerRestartCommand(manager)}`);
    lines.push(`或在其终端按 Ctrl+C 后重新执行 / or press Ctrl+C in its terminal and run again:`);
  } else {
    lines.push('请通过 systemd / PM2 等服务管理器重启该服务（如 sudo systemctl restart <服务名>、pm2 restart <应用名>），');
    lines.push('或在其终端按 Ctrl+C 后重新执行 / or restart it with your service manager, or press Ctrl+C in its terminal and run again:');
  }
  lines.push(`  ${startCommand}`);
  lines.push('只重启实例（网关保持运行）/ restart only the instance: zhin restart');
  return lines.join('\n');
}
