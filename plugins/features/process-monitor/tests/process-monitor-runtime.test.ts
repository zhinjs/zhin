import { describe, expect, it, beforeEach } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import statusCommand from '../commands/process-status.ts';
import statusTool from '../tools/process-status.ts';
import {
  classifyStartup,
  formatProcessStatus,
  formatUptime,
  resetProcessMonitorForTests,
  resolveProcessMonitorConfig,
} from '../src/index.js';

describe('@zhin.js/process-monitor runtime', () => {
  beforeEach(() => {
    resetProcessMonitorForTests();
  });

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
    expect(formatProcessStatus()).toContain('进程监控状态');
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
    const result = await statusCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      args: [],
      params: {},
      input: undefined,
    });
    expect(String(result)).toContain('PID');
  });
});
