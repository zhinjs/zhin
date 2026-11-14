// `zhin restart --gateway` on a foreground gateway names the command that restarts it (#1250).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeForegroundGatewayRestart,
  detectProcessManager,
  managerRestartCommand,
  readProcessContext,
} from '../../src/utils/process-manager.js';

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
