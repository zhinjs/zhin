import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import statusCommand from '../commands/process-status/index.ts';
import statusTool from '../skills/process-monitor/tools/process-status/index.ts';
import {
  classifyStartup,
  formatUptime,
  ProcessMonitor,
  resolveProcessMonitorConfig,
} from '../src/index.js';

describe('@zhin.js/process-monitor runtime', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('process-monitor');
  });

  it('publishes process status through an on-demand Skill', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'));
    expect(pkg.files).toContain('skills');
    expect(pkg.files).not.toContain('tools');
    expect(pkg.zhin.features.map((entry: { package: string }) => entry.package))
      .toContain('@zhin.js/skill');
  });

  it('brands process-status command and tool', () => {
    expect(parseCommandDefinition(statusCommand)).toBe(statusCommand);
    expect(parseAgentToolDefinition(statusTool)).toBe(statusTool);
  });

  it('resolves default config', () => {
    expect(resolveProcessMonitorConfig({}).enabled).toBe(true);
  });

  it('formats uptime and status', () => {
    expect(formatUptime(65_000)).toContain('分钟');
    expect(new ProcessMonitor().formatStatus()).toContain('进程监控状态');
  });

  it('localizes command and tool status while preserving the same counters', async () => {
    let now = 0;
    const monitor = new ProcessMonitor({}, { now: () => now });
    now = 3_665_000;
    const context = { owner: {} as never, generation: 0, locale: 'en' as const, config: {},
      use: () => monitor as never, args: [], params: {}, input: undefined, formatCommand: () => undefined };
    const command = await statusCommand.execute(context);
    const tool = await statusTool.execute({}, context as never);
    for (const result of [command, tool]) {
      expect(result).toContain('Process status');
      expect(result).toContain('Uptime: 1h 1m');
      expect(result).toContain('Total restarts: 0');
      expect(result).not.toMatch(/\p{Script=Han}/u);
    }
    expect(monitor.state).toEqual({ restartCount: 0, crashCount: 0, totalUptime: 0 });
    expect(formatUptime(86_400_000, 'en')).toBe('1d 0h');
  });

  it('classifies hot reload (same pid) as start, not crash', () => {
    const now = Date.now();
    const state = {
      lastPid: process.pid,
      lastStartTime: now - 10_000,
      restartCount: 0,
      crashCount: 0,
      totalUptime: 0,
    };
    expect(classifyStartup(state, process.pid, now)).toEqual({ reason: 'start' });
  });

  it('classifies a quick relaunch without clean exit as crash', () => {
    const now = Date.now();
    const state = {
      lastPid: process.pid + 1,
      lastStartTime: now - 60_000,
      restartCount: 0,
      crashCount: 0,
      totalUptime: 0,
    };
    expect(classifyStartup(state, process.pid, now)).toEqual({ reason: 'crash', uptime: 60_000 });
  });

  it('classifies a quick relaunch after SIGTERM (cleanExit) as restart', () => {
    const now = Date.now();
    const state = {
      lastPid: process.pid + 1,
      lastStartTime: now - 60_000,
      cleanExit: true,
      restartCount: 0,
      crashCount: 0,
      totalUptime: 0,
    };
    expect(classifyStartup(state, process.pid, now)).toEqual({ reason: 'restart', uptime: 60_000 });
  });

  it('classifies a slow relaunch as restart', () => {
    const now = Date.now();
    const state = {
      lastPid: process.pid + 1,
      lastStartTime: now - 10 * 60_000,
      restartCount: 0,
      crashCount: 0,
      totalUptime: 0,
    };
    expect(classifyStartup(state, process.pid, now).reason).toBe('restart');
  });

  it('process-status command returns status text', async () => {
    const monitor = new ProcessMonitor();
    const result = await statusCommand.execute({
      owner: {} as never,
      generation: 0,
      locale: 'zh-CN',
      formatCommand: () => undefined,
      config: {},
      use: () => monitor as never,
      args: [],
      params: {},
      input: undefined,
    });
    expect(String(result)).toContain('PID');
  });

  it('owns state and signal listeners per monitor instance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-process-monitor-'));
    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');
    const left = new ProcessMonitor({}, { stateFile: path.join(dir, 'left.json') });
    const right = new ProcessMonitor({}, { stateFile: path.join(dir, 'right.json') });

    left.start();
    right.start();
    expect(left.started).toBe(true);
    expect(right.started).toBe(true);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 2);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 2);

    left.dispose();
    right.dispose();
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
