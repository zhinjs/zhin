import { describe, expect, it } from 'vitest';
import { Plugin, ToolFeature } from '@zhin.js/core';
import { AgentOrchestrator } from '../src/orchestrator/index.js';
import {
  collectIntrospectionAgentTools,
  collectIntrospectionSkills,
  collectIntrospectionMcpLabels,
} from '../src/init/introspection-collectors.js';

describe('collectIntrospection agent resources', () => {
  it('collects tool names from ToolFeature and orchestrator', () => {
    const root = new Plugin('/test/root.ts');
    const toolFeature = new ToolFeature();
    toolFeature.addTool({
      name: 'slack_send',
      description: 'send',
      parameters: { type: 'object' },
      execute: async () => 'ok',
    }, 'demo');
    root.provide(toolFeature);

    const orchestrator = new AgentOrchestrator();
    orchestrator.addTool({
      name: 'ping',
      description: 'ping',
      parameters: { type: 'object' },
      execute: async () => 'pong',
    });
    root.provide({ name: 'agent', description: 'test', value: orchestrator });

    expect(collectIntrospectionAgentTools(root)).toEqual(['ping', 'slack_send']);
  });

  it('collects orchestrator skill names', () => {
    const root = new Plugin('/test/root.ts');
    const orchestrator = new AgentOrchestrator();
    orchestrator.addSkill({
      name: 'search',
      description: 'search',
      tools: [],
      pluginName: 'demo',
      keywords: [],
      tags: [],
    });
    root.provide({ name: 'agent', description: 'test', value: orchestrator });

    expect(collectIntrospectionSkills(root)).toEqual(['search']);
  });

  it('formats MCP server labels with connection state', () => {
    const root = new Plugin('/test/root.ts');
    const orchestrator = new AgentOrchestrator();
    orchestrator.addMcp({
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });
    root.provide({ name: 'agent', description: 'test', value: orchestrator });

    expect(collectIntrospectionMcpLabels(root)).toEqual(['filesystem (idle)']);
  });
});
