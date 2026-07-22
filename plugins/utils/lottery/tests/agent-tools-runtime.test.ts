import { describe, expect, it } from 'vitest';
import type { AgentToolRegistration, AgentToolsHost } from '@zhin.js/plugin-runtime';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import {
  registerLotteryAgentDeps,
  type LotteryAgentDeps,
} from '../src/lottery-agent-deps.js';
import { registerLotteryAgentTools } from '../agent/runtime-tools.js';

function createHost() {
  const tools = new Map<string, AgentToolRegistration>();
  const host: AgentToolsHost = {
    register: (tool) => {
      tools.set(tool.name, tool);
      return () => { tools.delete(tool.name); };
    },
  };
  return { host, tools };
}

function memoryDeps(): LotteryAgentDeps {
  const db = createInMemoryLotteryDb();
  return {
    getDb: () => db,
    getConfig: () => ({ pickCount: 1, historyLimit: 10, kl8: {} }),
    enabledGames: () => [],
    scheduleCron: () => '0 0 18 * * *',
    scheduleEnabled: () => false,
    pipelinePush: false,
  };
}

describe('lottery runtime agent tools (agentToolsHostToken)', () => {
  it('registers every agent/tools slot with the lottery_ prefix', () => {
    const { host, tools } = createHost();
    const dispose = registerLotteryAgentTools(host);

    expect([...tools.keys()].sort()).toEqual([
      'lottery_compute_recommend',
      'lottery_get_model_state',
      'lottery_history',
      'lottery_list_pending',
      'lottery_save_prediction',
      'lottery_stats_snapshot',
      'lottery_sync',
    ]);

    dispose();
    expect(tools.size).toBe(0);
  });

  it('shares one lottery-agent-deps module instance with plugin setup', async () => {
    const { host, tools } = createHost();
    const disposeTools = registerLotteryAgentTools(host);
    const history = tools.get('lottery_history');
    expect(history).toBeDefined();

    // 复现线上错误：setup() 尚未注册 deps 时工具报错。
    await expect(history!.execute({ game: 'ssq' }))
      .rejects.toThrow('lottery agent deps not initialized');

    // 与 plugin.ts setup() 相同的注册路径：同一模块实例 → 工具立即可用。
    const disposeDeps = registerLotteryAgentDeps(memoryDeps());
    await expect(history!.execute({ game: 'ssq' })).resolves.toBe('[]');

    // generation 销毁后回到未初始化状态（新 generation 会重新注册）。
    disposeDeps();
    await expect(history!.execute({ game: 'ssq' }))
      .rejects.toThrow('lottery agent deps not initialized');
    disposeTools();
  });
});
