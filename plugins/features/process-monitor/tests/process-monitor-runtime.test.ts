import { describe, expect, it, beforeEach } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import statusCommand from '../commands/process-status.ts';
import statusTool from '../tools/process-status.ts';
import {
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
