import { describe, expect, it, vi } from 'vitest';
import { composeZhinAgentRuntime } from '../../src/init/compose-zhin-agent-runtime.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { wireMockLlmApi } from '../helpers/mock-llm-api.js';

describe('composeZhinAgentRuntime', () => {
  it('wires the ideal modules', () => {
    const provider = wireMockLlmApi({ models: ['m1'] }).provider;
    const agent = new ZhinAgent();
    const { agentCore, toolSystem, sessionSystem, eventSystem, skillSystem, memorySystem, contextSystem } =
      composeZhinAgentRuntime({ agent });

    expect(agent).toBeDefined();
    expect(agentCore).toBeDefined();
    expect(toolSystem).toBeDefined();
    expect(sessionSystem).toBeDefined();
    expect(eventSystem).toBeDefined();
    expect(skillSystem).toBeDefined();
    expect(memorySystem).toBeDefined();
    expect(contextSystem).toBeDefined();
  });

  it('injects composed runtime modules onto agent via configure', () => {
    const provider = wireMockLlmApi({ models: ['m1'] }).provider;
    const agent = new ZhinAgent();
    const composed = composeZhinAgentRuntime({ agent });
    agent.configure({
      agentCore: composed.agentCore,
      toolSystem: composed.toolSystem,
      contextSystem: composed.contextSystem,
      memorySystem: composed.memorySystem,
    });
    const priv = agent as any;
    expect(priv.agentCore).toBe(composed.agentCore);
    expect(priv.toolSystem).toBe(composed.toolSystem);
    expect(priv.contextSystem).toBe(composed.contextSystem);
    expect(priv.memorySystem).toBe(composed.memorySystem);
  });

  it('creates per-agent contextSystem instance (not global singleton)', () => {
    const provider = wireMockLlmApi({ models: ['m1'] }).provider;
    const a = composeZhinAgentRuntime({ agent: new ZhinAgent() });
    const b = composeZhinAgentRuntime({ agent: new ZhinAgent() });
    expect(a.contextSystem).not.toBe(b.contextSystem);
  });

  it('wires AgentCore eventBus to composed EventSystem', () => {
    const provider = wireMockLlmApi({ models: ['m1'] }).provider;
    const { agentCore, eventSystem } = composeZhinAgentRuntime({ agent: new ZhinAgent() });
    expect(agentCore.deps.eventBus).toBe(eventSystem);
    expect(agentCore.deps).not.toHaveProperty('provider');
  });
});
