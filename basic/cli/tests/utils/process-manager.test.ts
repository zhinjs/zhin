// `zhin restart --gateway` on a foreground gateway names the command that restarts it (#1250).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeForegroundGatewayRestart,
  detectProcessManager,
  gatewayRestartCommand,
  launchdLabel,
  managerRestartCommand,
  readLaunchdContext,
  readProcessContext,
} from '../../src/utils/process-manager.js';
import { formatGatewayVersionSkew, gatewayVersionSkew, installedGatewayVersion } from '../../src/utils/gateway-version.js';

describe('detectProcessManager', () => {
  it('detects a systemd system service and its unit from the cgroup', () => {
    const manager = detectProcessManager({ env: { INVOCATION_ID: 'abc' }, cgroup: '0::/system.slice/zhin-bot.service\n' });
    expect(manager).toEqual({ kind: 'systemd', unit: 'zhin-bot.service', user: false });
    expect(managerRestartCommand(manager!)).toBe('sudo systemctl restart zhin-bot.service');
  });

  it('detects a systemd user service', () => {
    const manager = detectProcessManager({
      env: { INVOCATION_ID: 'abc' },
      cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/bot.service\n',
    });
    expect(manager).toEqual({ kind: 'systemd', unit: 'bot.service', user: true });
    expect(managerRestartCommand(manager!)).toBe('systemctl --user restart bot.service');
  });

  it('does not treat a terminal session that inherited INVOCATION_ID as a service', () => {
    expect(detectProcessManager({
      env: { INVOCATION_ID: 'abc' },
      cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-gnome-terminal-vte-spawn-1.scope\n',
    })).toBeUndefined();
  });

  it('detects PM2 from pm_id and name', () => {
    const manager = detectProcessManager({ env: { pm_id: '0', name: 'my bot' } });
    expect(manager).toEqual({ kind: 'pm2', name: 'my bot', id: '0' });
    expect(managerRestartCommand(manager!)).toBe("pm2 restart 'my bot'");
    expect(managerRestartCommand({ kind: 'pm2', id: '3' })).toBe('pm2 restart 3');
  });

  it('returns undefined without a context or manager variables', () => {
    expect(detectProcessManager(undefined)).toBeUndefined();
    expect(detectProcessManager({ env: { PATH: '/usr/bin' } })).toBeUndefined();
  });
});

describe('readProcessContext', () => {
  it('parses environ and cgroup from procfs', () => {
    const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
    try {
      fs.mkdirSync(path.join(procRoot, '42'));
      fs.writeFileSync(path.join(procRoot, '42', 'environ'), 'INVOCATION_ID=x\0A=b=c\0');
      fs.writeFileSync(path.join(procRoot, '42', 'cgroup'), '0::/system.slice/bot.service\n');
      expect(readProcessContext(42, procRoot)).toEqual({
        env: { INVOCATION_ID: 'x', A: 'b=c' },
        cgroup: '0::/system.slice/bot.service\n',
      });
      expect(readProcessContext(43, procRoot)).toBeUndefined();
    } finally {
      fs.rmSync(procRoot, { recursive: true, force: true });
    }
  });
});

describe('describeForegroundGatewayRestart', () => {
  it('names the manager command and the foreground start command with the original options', () => {
    const text = describeForegroundGatewayRestart(4242, ['--mode', 'production', '--no-watch'], { kind: 'systemd', unit: 'bot.service', user: false });
    expect(text).toContain('当前网关以前台方式运行（pid 4242）');
    expect(text).toContain('sudo systemctl restart bot.service');
    expect(text).toContain('zhin start --foreground --mode production --no-watch');
  });

  it('falls back to generic instructions without a detected manager', () => {
    const text = describeForegroundGatewayRestart(7, [], undefined);
    expect(text).toContain('systemd / PM2');
    expect(text).toContain('Ctrl+C');
    expect(text).toContain('  zhin start --foreground');
  });
});

describe('launchd (macOS, #1250 gateway-version-skew-after-update)', () => {
  const list = () => 'PID\tStatus\tLabel\n-\t0\tcom.apple.other\n4242\t0\tcom.zhinjs.my-bot\n';

  it('finds the job running the gateway pid in `launchctl list` and restarts it with kickstart -k', () => {
    expect(launchdLabel('my-bot')).toBe('com.zhinjs.my-bot');
    const context = readLaunchdContext(4242, list);
    expect(context).toEqual({ env: { XPC_SERVICE_NAME: 'com.zhinjs.my-bot' } });
    const manager = detectProcessManager(context, 501);
    expect(manager).toEqual({ kind: 'launchd', label: 'com.zhinjs.my-bot', uid: 501 });
    expect(managerRestartCommand(manager!)).toBe('launchctl kickstart -k gui/501/com.zhinjs.my-bot');
    expect(readLaunchdContext(7, list)).toBeUndefined();
  });

  it('falls back to launchctl only on macOS when procfs is missing', () => {
    expect(readProcessContext(4242, '/nonexistent-proc', { platform: 'darwin', launchctlList: list })).toEqual({ env: { XPC_SERVICE_NAME: 'com.zhinjs.my-bot' } });
    expect(readProcessContext(4242, '/nonexistent-proc', { platform: 'linux', launchctlList: list })).toBeUndefined();
  });

  it('does not treat a terminal (XPC_SERVICE_NAME 0 / application.*) as a launchd job', () => {
    expect(detectProcessManager({ env: { XPC_SERVICE_NAME: '0' } })).toBeUndefined();
    expect(detectProcessManager({ env: { XPC_SERVICE_NAME: 'application.com.apple.Terminal.1234' } })).toBeUndefined();
  });

  it('names launchd in the foreground restart explanation', () => {
    const text = describeForegroundGatewayRestart(4242, [], { kind: 'launchd', label: 'com.zhinjs.my-bot', uid: 501 });
    expect(text).toContain('检测到由 launchd 管理');
    expect(text).toContain('launchctl kickstart -k gui/501/com.zhinjs.my-bot');
  });
});

describe('gateway restart command and version skew', () => {
  it('is zhin restart --gateway for a daemon, the manager command for a managed foreground gateway', () => {
    expect(gatewayRestartCommand({ pid: 1, mode: 'daemon' })).toBe('zhin restart --gateway');
    expect(gatewayRestartCommand({ pid: 1, mode: 'foreground' }, { kind: 'systemd', unit: 'bot.service', user: true })).toBe('systemctl --user restart bot.service');
    expect(gatewayRestartCommand({ pid: 2 ** 30, mode: 'foreground' })).toBeUndefined();
  });

  it('reports a skew only when the installed version differs', () => {
    const gateway = { pid: 1, mode: 'foreground' as const, version: '1.3.0' };
    const manager = { kind: 'launchd' as const, label: 'com.zhinjs.bot', uid: 501 };
    expect(gatewayVersionSkew(gateway, '1.3.0', manager)).toBeUndefined();
    expect(gatewayVersionSkew(gateway, undefined, manager)).toBeUndefined();
    const skew = gatewayVersionSkew(gateway, '1.4.0', manager)!;
    expect(skew).toEqual({ running: '1.3.0', installed: '1.4.0', restart: 'launchctl kickstart -k gui/501/com.zhinjs.bot' });
    expect(formatGatewayVersionSkew(skew).join('\n')).toContain('重启网关：launchctl kickstart -k gui/501/com.zhinjs.bot');
    expect(formatGatewayVersionSkew({ running: '1', installed: '2' }).join('\n')).toContain('Ctrl+C');
  });

  it('reads the gateway next to the project-local CLI first (pnpm layout)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-gwver-'));
    try {
      const store = path.join(root, 'node_modules', '.pnpm', '@zhin.js+cli@1.4.0', 'node_modules', '@zhin.js');
      fs.mkdirSync(path.join(store, 'cli'), { recursive: true });
      fs.mkdirSync(path.join(store, 'gateway'), { recursive: true });
      fs.writeFileSync(path.join(store, 'gateway', 'package.json'), JSON.stringify({ name: '@zhin.js/gateway', version: '1.4.2' }));
      fs.mkdirSync(path.join(root, 'node_modules', '@zhin.js'), { recursive: true });
      fs.symlinkSync(path.join(store, 'cli'), path.join(root, 'node_modules', '@zhin.js', 'cli'), 'dir');
      expect(installedGatewayVersion(root)).toBe('1.4.2');
      expect(installedGatewayVersion(path.join(root, 'missing'), { selfResolve: false })).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
