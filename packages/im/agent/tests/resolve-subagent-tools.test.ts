import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from '../src/zhin-agent/config.js';
import { AgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';
import { resolveSubagentAgentTools } from '../src/orchestrator/resolve-subagent-tools.js';

function makeTool(name: string, keywords: string[] = []): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    keywords,
    execute: async () => 'ok',
  };
}

describe('resolveSubagentAgentTools', () => {
  const catalog = [
    makeTool('read_file'),
    makeTool('bash'),
    makeTool('generate_image', ['画', 'draw', 'image', 'picture']),
    makeTool('analyze_media', ['vision', 'image', '识图']),
    makeTool('spawn_task'),
    makeTool('tool_search'),
  ];
  const dispatcher = new AgentDispatcher();

  it('排除主编排工具，TF-IDF 可按任务载入 generate_image', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '画一只橘猫',
      role: 'subtask',
      config: { ...DEFAULT_CONFIG, deferredToolMaxResults: 8 },
      agentDispatcher: dispatcher,
    });
    const names = tools.map(t => t.name);
    expect(names).toContain('generate_image');
    expect(names).not.toContain('spawn_task');
    expect(names).not.toContain('tool_search');
  });

  it('researcher 角色不含 bash（角色限制优先于 TF-IDF）', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '执行 bash 脚本列出目录',
      role: 'researcher',
      config: DEFAULT_CONFIG,
      agentDispatcher: dispatcher,
    });
    expect(tools.map(t => t.name)).not.toContain('bash');
  });

  it('任务含 generate_image 时优先载入该工具', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '使用 generate_image 工具生成橘猫，provider_alias zhipu-vl',
      role: 'subtask',
      config: { ...DEFAULT_CONFIG, deferredToolMaxResults: 1 },
      agentDispatcher: dispatcher,
    });
    expect(tools.map(t => t.name)).toContain('generate_image');
  });

  it('使用全池 + 角色 + TF-IDF（无 agents.tools 配置）', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '画一只橘猫',
      role: 'subtask',
      config: DEFAULT_CONFIG,
      agentDispatcher: dispatcher,
    });
    expect(tools.map(t => t.name)).toContain('generate_image');
  });
});
