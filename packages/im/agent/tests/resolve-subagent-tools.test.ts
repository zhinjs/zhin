import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from '../src/config/index.js';
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
    makeTool('write_file'),
    makeTool('bash'),
    makeTool('generate_image', ['画', 'draw', 'image', 'picture']),
    makeTool('analyze_media', ['vision', 'image', '识图']),
    makeTool('spawn_task'),
    makeTool('tool_search'),
    makeTool('unlisted_sensitive_tool'),
  ];

  it('排除主编排工具，TF-IDF 可按任务载入 generate_image', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '画一只橘猫',
      role: 'subtask',
      config: { ...DEFAULT_CONFIG, deferredToolMaxResults: 8 },
    });
    const names = tools.map(t => t.name);
    expect(names).toContain('generate_image');
    expect(names).not.toContain('spawn_task');
    expect(names).not.toContain('tool_search');
    expect(names).not.toContain('unlisted_sensitive_tool');
  });

  it('display role does not silently invent a capability policy', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '审查 packages/im/agent/src/subagent.ts 并写回修复',
      role: 'reviewer',
      config: DEFAULT_CONFIG,
    });
    const names = tools.map(t => t.name);
    expect(names).toContain('write_file');
    expect(names).toContain('bash');
    expect(names).not.toContain('spawn_task');
  });

  it('Agent Definition deny rules are the explicit restriction seam', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '执行 bash 脚本列出目录',
      role: 'researcher',
      config: DEFAULT_CONFIG,
      agentMeta: { name: 'researcher', description: 'research', filePath: '/agent.md', disallowedTools: ['bash'] },
    });
    expect(tools.map(t => t.name)).not.toContain('bash');
  });

  it('Agent Definition toolNames narrows the configured subagent capability set', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: 'read only',
      role: 'researcher',
      config: DEFAULT_CONFIG,
      agentMeta: {
        name: 'reader',
        description: 'reader',
        filePath: '/agent.md',
        toolNames: ['read_file'],
      },
    });
    expect(tools.map(tool => tool.name)).toEqual(['read_file']);
  });

  it('任务含 generate_image 时优先载入该工具', () => {
    const tools = resolveSubagentAgentTools({
      allTools: catalog,
      task: '使用 generate_image 工具生成橘猫，provider_alias zhipu-vl',
      role: 'subtask',
      config: { ...DEFAULT_CONFIG, deferredToolMaxResults: 1 },
    });
    expect(tools.map(t => t.name)).toContain('generate_image');
  });

  it('spawn_task 声明工具时仅暴露父会话已 load 的项 + load_tool/load_skill', () => {
    const tools = resolveSubagentAgentTools({
      allTools: [
        ...catalog,
        makeTool('load_tool'),
        makeTool('load_skill'),
        makeTool('web_search'),
      ],
      task: '搜索资料',
      role: 'subtask',
      config: DEFAULT_CONFIG,
      requestedTools: ['web_search', 'bash'],
      parentSessionLoaded: ['web_search'],
    });
    const names = tools.map(t => t.name);
    expect(names).toContain('load_tool');
    expect(names).toContain('load_skill');
    expect(names).toContain('web_search');
    expect(names).not.toContain('bash');
    expect(names).not.toContain('spawn_task');
  });

  it('requestedTools cannot reintroduce meta-tools omitted by Agent Definition', () => {
    const tools = resolveSubagentAgentTools({
      allTools: [...catalog, makeTool('load_tool'), makeTool('load_skill'), makeTool('web_search')],
      task: 'search',
      role: 'subtask',
      config: DEFAULT_CONFIG,
      agentMeta: {
        name: 'restricted',
        description: 'restricted',
        filePath: '/agent.md',
        toolNames: ['web_search'],
      },
      requestedTools: ['web_search'],
      parentSessionLoaded: ['web_search'],
    });
    expect(tools.map(tool => tool.name)).toEqual(['web_search']);
  });

  it('requestedTools cannot reintroduce explicitly denied meta-tools', () => {
    const tools = resolveSubagentAgentTools({
      allTools: [...catalog, makeTool('load_tool'), makeTool('load_skill'), makeTool('web_search')],
      task: 'search',
      role: 'subtask',
      config: DEFAULT_CONFIG,
      agentMeta: {
        name: 'restricted',
        description: 'restricted',
        filePath: '/agent.md',
        disallowedTools: ['load_tool', 'load_skill'],
      },
      requestedTools: ['web_search'],
      parentSessionLoaded: ['web_search'],
    });
    const names = tools.map(tool => tool.name);
    expect(names).toContain('web_search');
    expect(names).not.toContain('load_tool');
    expect(names).not.toContain('load_skill');
  });
});
