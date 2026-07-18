/**
 * Provide Capability Features for assembly (ADR 0042).
 * ToolFeature is registered separately via registerToolService.
 */
import { defineContext, getPlugin, SkillFeature } from '@zhin.js/core';
import { AgentFeature } from '../features/agent-feature.js';
import { MCPFeature } from '../features/mcp-feature.js';
import { createFeatureCapabilityIngress } from '../ingress/capability-ingress.js';

export function registerCapabilityFeatures(): void {
  const plugin = getPlugin();
  if (!plugin.inject('skill')) {
    plugin.provide(new SkillFeature());
  }
  if (!plugin.inject('agentFeature')) {
    plugin.provide(new AgentFeature());
  }
  if (!plugin.inject('mcpFeature')) {
    plugin.provide(new MCPFeature());
  }
  if (!plugin.inject('capabilityIngress')) {
    plugin.provide(defineContext({
      name: 'capabilityIngress',
      description: 'Capability Feature → Orchestrator ingress (ADR 0042)',
      value: createFeatureCapabilityIngress(),
    }));
  }
}
