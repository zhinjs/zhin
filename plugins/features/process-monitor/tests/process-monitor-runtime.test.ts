import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import statusCommand from '../commands/process-status/index.ts';
import statusTool from '../tools/process-status/index.ts';
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
