import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SERVICE_START_ARGS,
  findInstalledService,
  readServiceProjectName,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTask,
  resolveServiceCommand,
  restartsOnCleanExit,
  serviceStopAdvice,
  serviceStopAdviceFor,
} from '../../src/utils/service-definition.js';

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

  it('refuses when the installed service restarts on a clean exit', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=ROOT\nRestart=always\n');
    expect(await readServiceProjectName(root)).toBe('bot');
    const service = findInstalledService(root, 'bot', { platform: 'linux', home, read });
    expect(service).toMatchObject({ kind: 'systemd', user: true, name: 'bot.service', restartsOnCleanExit: true });
    const advice = await serviceStopAdviceFor(root, { gateway: { mode: 'foreground' } }, { platform: 'linux', home, read });
    expect(advice.refuse).toBe(true);
    expect(advice.lines.join('\n')).toContain('zhin service stop');
  });

  it('stops and explains when the service restarts only on failure', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=ROOT\nRestart=on-failure\n');
    const advice = await serviceStopAdviceFor(root, { gateway: { mode: 'foreground' } }, { platform: 'linux', home, read });
    expect(advice).toEqual({ refuse: false, lines: [expect.stringContaining('zhin service uninstall')] });
  });

  it('ignores a background gateway, another project\'s unit and a missing unit', async () => {
    const { home, root, read } = await installed('[Service]\nWorkingDirectory=/elsewhere\nRestart=always\n');
    expect(findInstalledService(root, 'bot', { platform: 'linux', home, read })).toBeUndefined();
    expect(await serviceStopAdviceFor(root, { gateway: { mode: 'daemon' } }, { platform: 'linux', home, read })).toEqual({ refuse: false, lines: [] });
    expect(serviceStopAdvice(undefined)).toEqual({ refuse: false, lines: [] });
  });
});
