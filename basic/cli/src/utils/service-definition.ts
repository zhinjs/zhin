/**
 * Service files for `zhin service install` (ADR 0062 §2, #1250). The scaffold no longer writes
 * any: they are generated here, for the current system, with this machine's absolute node and CLI
 * paths, so a node installed by nvm / fnm / volta works at boot and no `npx` lookup runs on start.
 *
 * Every definition restarts the gateway only after a failure: `zhin stop` exits 0 and the bot
 * stays stopped (systemd `Restart=on-failure`, launchd `KeepAlive.SuccessfulExit=false`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `zhin start` arguments the service runs (the service manager owns the foreground process). */
export const SERVICE_START_ARGS: readonly string[] = Object.freeze(['start', '--foreground', '--mode', 'production']);

export interface ServiceCommand {
  /** Project root (working directory). */
  readonly root: string;
  /** Absolute node executable. */
  readonly node: string;
  /** Absolute `zhin` CLI script (`bin/zhin.js`). */
  readonly cli: string;
  /** False when the project has no `@zhin.js/cli` and the running CLI's own script is used. */
  readonly projectCli: boolean;
  readonly args: readonly string[];
  /** PATH for the service: node's directory first, then the installing shell's absolute entries. */
  readonly path: string;
}

export interface ResolveServiceCommandOptions {
  readonly execPath?: string;
  readonly envPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (file: string) => boolean;
  /** The CLI script of this process (default: this package's `bin/zhin.js`). */
  readonly fallbackCli?: string;
}

function ownCliScript(): string {
  // src/utils or lib/utils → ../../bin/zhin.js
  return fileURLToPath(new URL('../../bin/zhin.js', import.meta.url));
}

/**
 * The project's own `node_modules/@zhin.js/cli/bin/zhin.js` — a path that survives CLI upgrades
 * (pnpm links it to the current version) — or the running CLI's script when the project lacks one.
 */
export function resolveServiceCommand(root: string, options: ResolveServiceCommandOptions = {}): ServiceCommand {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const exists = options.exists ?? fs.existsSync;
  const node = options.execPath ?? process.execPath;
  const projectScript = pathApi.join(root, 'node_modules', '@zhin.js', 'cli', 'bin', 'zhin.js');
  const projectCli = exists(projectScript);
  const delimiter = platform === 'win32' ? ';' : ':';
  const entries = [
    pathApi.dirname(node),
    ...(options.envPath ?? process.env.PATH ?? '').split(delimiter),
    ...(platform === 'win32' ? [] : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']),
  ].filter((entry) => entry && pathApi.isAbsolute(entry));
  return Object.freeze({
    root,
    node,
    cli: projectCli ? projectScript : (options.fallbackCli ?? ownCliScript()),
    projectCli,
    args: SERVICE_START_ARGS,
    path: [...new Set(entries)].join(delimiter),
  });
}

/**
 * Validate a project name for safe use in shell commands.
 * Only allows alphanumeric characters, hyphens, underscores, and dots.
 * Throws if the name contains any other characters.
 */
export function validateProjectName(name: string): string {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`项目名称 "${name}" 包含不安全字符，仅允许字母、数字、连字符、下划线和点`);
  }
  return name;
}

/** The validated `package.json#name` of the project in `cwd` (scope stripped); undefined without one. */
export async function readServiceProjectName(cwd: string): Promise<string | undefined> {
  const pkgPath = path.join(cwd, 'package.json');
  let packageJson: { name?: unknown };
  try {
    packageJson = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8')) as { name?: unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const name = typeof packageJson.name === 'string' && packageJson.name ? packageJson.name : 'zhin-bot';
  return validateProjectName(name.replace(/^@[^/]+\//u, ''));
}

export function launchdLabel(projectName: string): string {
  return `com.zhinjs.${projectName}`;
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

export interface SystemdUnitOptions {
  /** User unit (`~/.config/systemd/user`) or system unit (`User=` set). */
  readonly user: boolean;
  /** Account a system unit runs as. */
  readonly username?: string;
}

export function renderSystemdUnit(projectName: string, command: ServiceCommand, options: SystemdUnitOptions): string {
  const exec = [command.node, command.cli, ...command.args].map(systemdQuote).join(' ');
  return [
    '[Unit]',
    `Description=${projectName} - Zhin.js`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    ...(options.user || !options.username ? [] : [`User=${options.username}`]),
    `WorkingDirectory=${command.root}`,
    `ExecStart=${exec}`,
    '# zhin stop exits 0: only a failure is restarted, so the bot stays stopped (zhin service stop / start).',
    'Restart=on-failure',
    'RestartSec=10s',
    // The gateway gives the instance up to 60 s to stop.
    'TimeoutStopSec=75s',
    'Environment=NODE_ENV=production',
    `Environment=${systemdQuote(`PATH=${command.path}`)}`,
    'StandardOutput=journal',
    'StandardError=journal',
    `SyslogIdentifier=${projectName}`,
    'LimitNOFILE=65536',
    '',
    '[Install]',
    `WantedBy=${options.user ? 'default.target' : 'multi-user.target'}`,
    '',
  ].join('\n');
}

function xml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

export function renderLaunchdPlist(projectName: string, command: ServiceCommand): string {
  const argument = (value: string) => `        <string>${xml(value)}</string>`;
  const logs = path.posix.join(command.root, '.zhin', 'logs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xml(launchdLabel(projectName))}</string>

    <key>ProgramArguments</key>
    <array>
${[command.node, command.cli, ...command.args].map(argument).join('\n')}
    </array>

    <key>WorkingDirectory</key>
    <string>${xml(command.root)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>${xml(command.path)}</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <!-- zhin stop exits 0: launchd restarts the gateway only after a failure. -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>${xml(path.posix.join(logs, 'launchd-stdout.log'))}</string>

    <key>StandardErrorPath</key>
    <string>${xml(path.posix.join(logs, 'launchd-stderr.log'))}</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
`;
}

/** Task Scheduler definition (boot trigger, restart on failure only). */
export function renderWindowsTask(projectName: string, command: ServiceCommand): string {
  const args = [command.cli, ...command.args].map((value) => (/\s/u.test(value) ? `"${value}"` : value)).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Zhin.js - ${xml(projectName)}</Description>
    <URI>\\${xml(projectName)}</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(command.node)}</Command>
      <Arguments>${xml(args)}</Arguments>
      <WorkingDirectory>${xml(command.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export type InstalledServiceKind = 'systemd' | 'launchd';

export interface InstalledService {
  readonly kind: InstalledServiceKind;
  readonly file: string;
  /** systemd user unit (`systemctl --user`). */
  readonly user: boolean;
  /** Unit file name (`bot.service`) or launchd label. */
  readonly name: string;
  /**
   * The definition restarts the gateway after a clean exit too (scaffold files before #1250:
   * `Restart=always`, `KeepAlive <true/>`): `zhin stop` cannot stop such a service.
   */
  readonly restartsOnCleanExit: boolean;
}

/** Whether a unit / plist restarts the process after it exits with code 0. */
export function restartsOnCleanExit(kind: InstalledServiceKind, content: string): boolean {
  if (kind === 'systemd') {
    const restart = /^\s*Restart\s*=\s*(\S+)/mu.exec(content)?.[1];
    return restart === 'always' || restart === 'on-success';
  }
  return /<key>KeepAlive<\/key>\s*<true\s*\/>/u.test(content);
}

function workingDirectory(kind: InstalledServiceKind, content: string): string | undefined {
  if (kind === 'systemd') return /^\s*WorkingDirectory\s*=\s*(.+?)\s*$/mu.exec(content)?.[1];
  const raw = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/u.exec(content)?.[1];
  return raw?.replace(/&quot;/gu, '"').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
}

export interface FindInstalledServiceOptions {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly read?: (file: string) => string | undefined;
}

function readText(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; }
}

/** The service `zhin service install` installed for this project, if any (it names the project's root). */
export function findInstalledService(root: string, projectName: string, options: FindInstalledServiceOptions = {}): InstalledService | undefined {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const read = options.read ?? readText;
  const candidates: { kind: InstalledServiceKind; file: string; user: boolean; name: string }[] = platform === 'darwin'
    ? [{ kind: 'launchd', file: path.join(home, 'Library', 'LaunchAgents', `${launchdLabel(projectName)}.plist`), user: true, name: launchdLabel(projectName) }]
    : platform === 'linux'
      ? [
        { kind: 'systemd', file: path.join(home, '.config', 'systemd', 'user', `${projectName}.service`), user: true, name: `${projectName}.service` },
        { kind: 'systemd', file: `/etc/systemd/system/${projectName}.service`, user: false, name: `${projectName}.service` },
      ]
      : [];
  for (const candidate of candidates) {
    const content = read(candidate.file);
    if (content === undefined) continue;
    const directory = workingDirectory(candidate.kind, content);
    if (directory !== undefined && path.resolve(directory) !== path.resolve(root)) continue;
    return Object.freeze({ ...candidate, restartsOnCleanExit: restartsOnCleanExit(candidate.kind, content) });
  }
  return undefined;
}

/**
 * What `zhin stop` says about a foreground gateway run by a service (ADR 0062 §2). `refuse`: the
 * service would start the gateway again at once, so stopping it through the socket is pointless.
 */
export function serviceStopAdvice(service: InstalledService | undefined): { readonly refuse: boolean; readonly lines: readonly string[] } {
  if (!service) return { refuse: false, lines: [] };
  const label = service.kind === 'launchd' ? `launchd 服务 ${service.name}` : `systemd ${service.user ? '用户' : '系统'}服务 ${service.name}`;
  if (service.restartsOnCleanExit) {
    return {
      refuse: true,
      lines: [
        `网关由 ${label} 托管，服务文件配置为退出后总是重启（${service.file}）：zhin stop 停下后会被立刻重新拉起，已取消。`,
        '请改用 zhin service stop；或先运行 zhin service install 更新服务文件（只在异常退出时重启），之后 zhin stop 也能停下。',
      ],
    };
  }
  return {
    refuse: false,
    lines: [
      `提示：网关由 ${label} 托管。本次已停止，下次${service.kind === 'launchd' ? '登录' : '开机'}或 zhin service start 时会再次启动；不再需要托管时运行 zhin service uninstall。`,
    ],
  };
}

export interface RunningGatewayLike {
  readonly gateway: { readonly mode: 'foreground' | 'daemon' };
}

/** {@link serviceStopAdvice} for this project's running gateway (only a foreground one can be a service). */
export async function serviceStopAdviceFor(
  root: string,
  running: RunningGatewayLike,
  options: FindInstalledServiceOptions = {},
): Promise<{ readonly refuse: boolean; readonly lines: readonly string[] }> {
  if (running.gateway.mode !== 'foreground') return { refuse: false, lines: [] };
  let projectName: string | undefined;
  try { projectName = await readServiceProjectName(root); } catch { projectName = undefined; }
  return serviceStopAdvice(projectName ? findInstalledService(root, projectName, options) : undefined);
}
