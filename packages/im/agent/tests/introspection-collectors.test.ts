import { describe, expect, it } from 'vitest';
import { Plugin, ToolFeature } from '@zhin.js/core';
import { AgentResourceHub } from '../src/resource-hub/index.js';
import {
  collectIntrospectionAgentTools,
  collectIntrospectionSkills,
  collectIntrospectionMcpLabels,
} from '../src/init/introspection-collectors.js';

describe('collectIntrospection agent resources', () => {
  it('collects tool names from ToolFeature and resource hub', () => {
    const root = new Plugin('/test/root.ts');
    const toolFeature = new ToolFeature();
    toolFeature.addTool({
      name: 'slack_send',
      description: 'send',
      parameters: { type: 'object' },
      execute: async () => 'ok',
    }, 'demo');
    root.provide(toolFeature);

    const resourceHub = new AgentResourceHub();
    resourceHub.addTool({
      name: 'ping',
      description: 'ping',
      parameters: { type: 'object' },
      execute: async () => 'pong',
    });
    root.provide({ name: 'agent', description: 'test', value: resourceHub });

    expect(collectIntrospectionAgentTools(root)).toEqual(['ping', 'slack_send']);
  });

  it('collects resource hub skill names', () => {
    const root = new Plugin('/test/root.ts');
    const resourceHub = new AgentResourceHub();
    resourceHub.addSkill({
      name: 'search',
      description: 'search',
      tools: [],
      pluginName: 'demo',
      keywords: [],
      tags: [],
    });
    root.provide({ name: 'agent', description: 'test', value: resourceHub });

    expect(collectIntrospectionSkills(root)).toEqual(['search']);
  });

  it('formats MCP server labels with connection state', () => {
    const root = new Plugin('/test/root.ts');
    const resourceHub = new AgentResourceHub();
    resourceHub.addMcp({
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });
    root.provide({ name: 'agent', description: 'test', value: resourceHub });

    expect(collectIntrospectionMcpLabels(root)).toEqual(['filesystem (idle)']);
  });
});
