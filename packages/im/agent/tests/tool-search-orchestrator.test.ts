import { describe, it, expect } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import {
  compactActivateSkillResultForToolSearch,
  wrapActivateSkillForToolSearch,
  buildOrchestratorAgentTools,
} from '../src/zhin-agent/tool-search-orchestrator.js';
import { DEFAULT_CONFIG, resolveDeferredTaskToolTimeout } from '../src/zhin-agent/config.js';

describe('tool-search-orchestrator', () => {
  it('compactActivateSkillResultForToolSearch 缩短技能回执并指向 run_deferred_task', () => {
    const full = `Skill '60s' activated. 请立即根据以下指导执行工具调用：

## 可用工具
tools:
  - weather
  - 60s_news
  - bing_image

## 执行规则
Use weather for cities.`;

    const out = compactActivateSkillResultForToolSearch(full);
    expect(out).toContain('run_deferred_task');
    expect(out).toContain('weather');
    expect(out).not.toContain('请立即根据以下指导执行工具调用');
    expect(out).not.toContain('## 可用工具');
  });

  it('icqq 技能压缩回执含 tool_query 与 icqq_send_user_like 提示', () => {
    const full = `Skill 'icqq' activated.\n\n## 使用流程\n1. 判断模块`;
    const out = compactActivateSkillResultForToolSearch(full);
    expect(out).toContain('mcp_icqq_icqq_invoke');
    expect(out).toContain('friend_like');
  });

  it('wrapActivateSkillForToolSearch 包装 execute', async () => {
    const base: AgentTool = {
      name: 'activate_skill',
      description: 'act',
      parameters: { type: 'object', properties: {} },
      execute: async () =>
        `Skill '60s' activated.\n\n## 可用工具\ntools:\n  - weather\n\n## 执行规则\nx`,
    };
    const wrapped = wrapActivateSkillForToolSearch(base);
    const out = String(await wrapped.execute!({ name: '60s' }));
    expect(out).toContain('run_deferred_task');
    expect(out).not.toContain('请立即根据以下指导');
  });

  it('run_deferred_task 超时须远高于 Agent 默认 30s', () => {
    expect(resolveDeferredTaskToolTimeout(DEFAULT_CONFIG)).toBeGreaterThanOrEqual(180_000);
    const built = buildOrchestratorAgentTools({
      allTools: [],
      config: DEFAULT_CONFIG,
      context: { platform: 't' } as any,
      getDeferredCatalog: () => [],
      runWorker: async () => '{}',
    });
    const deferred = built.orchestratorTools.find(t => t.name === 'run_deferred_task');
    expect(deferred?.timeout).toBe(resolveDeferredTaskToolTimeout(DEFAULT_CONFIG));
  });
});
