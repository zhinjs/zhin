import { describe, expect, it } from 'vitest';
import { composeZhinAgentRuntime } from '../../src/init/compose-zhin-agent-runtime.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';

describe('composeZhinAgentRuntime', () => {
  it('wires 8 ideal modules and returns deliverOutbound sender', () => {
    const provider = { name: 'mock', models: ['m1'] } as any;
    const agent = new ZhinAgent(provider);
    const { deliverOutbound, agentCore, toolSystem, sessionSystem, eventSystem, skillSystem, memorySystem, subagentSystem, contextSystem } =
      composeZhinAgentRuntime(agent, provider, {
        send: async () => {},
      });

    expect(agent).toBeDefined();
    expect(agentCore).toBeDefined();
    expect(toolSystem).toBeDefined();
    expect(sessionSystem).toBeDefined();
    expect(eventSystem).toBeDefined();
    expect(skillSystem).toBeDefined();
    expect(memorySystem).toBeDefined();
    expect(subagentSystem).toBeDefined();
    expect(contextSystem).toBeDefined();
    expect(typeof deliverOutbound).toBe('function');
  });

  it('injects composed runtime modules onto agent via configure', () => {
    const provider = { name: 'mock', models: ['m1'] } as any;
    const agent = new ZhinAgent(provider);
    const composed = composeZhinAgentRuntime(agent, provider, { send: async () => {} });
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
    const provider = { name: 'mock', models: ['m1'] } as any;
    const a = composeZhinAgentRuntime(new ZhinAgent(provider), provider, { send: async () => {} });
    const b = composeZhinAgentRuntime(new ZhinAgent(provider), provider, { send: async () => {} });
    expect(a.contextSystem).not.toBe(b.contextSystem);
  });

  it('wires AgentCore eventBus to composed EventSystem', () => {
    const provider = { name: 'mock', models: ['m1'] } as any;
    const { agentCore, eventSystem } = composeZhinAgentRuntime(
      new ZhinAgent(provider),
      provider,
      { send: async () => {} },
    );
    expect(agentCore.deps.eventBus).toBe(eventSystem);
    expect(agentCore.deps.provider).toBe(provider);
  });
});
