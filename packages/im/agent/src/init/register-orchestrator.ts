/**
 * Register AgentOrchestrator as provide('agent').
 */
import { getPlugin, defineContext } from '@zhin.js/core';
import { AgentOrchestrator } from '../orchestrator/index.js';

export function registerOrchestrator(): void {
  const plugin = getPlugin();
  plugin.provide(defineContext({
    name: 'agent',
    description: 'AI resource orchestrator',
    value: new AgentOrchestrator(),
    dispose: (orchestrator) => orchestrator.dispose(),
  }));
}
