import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFeature, SkillFeature, type Message } from '@zhin.js/core';
import { AgentOrchestrator } from '../../src/orchestrator/index.js';
import { FeatureCapabilityIngress } from '../../src/ingress/capability-ingress.js';
import { AgentFeature } from '../../src/features/agent-feature.js';
import { MCPFeature } from '../../src/features/mcp-feature.js';
import { DEFAULT_ZHIN_AGENT_NAME, type ResolvedAgentBinding } from '../../src/config/types.js';

function makeMessage(partial: {
  adapter?: string;
  scene?: string;
} = {}): Message {
  return {
    $adapter: partial.adapter ?? 'process',
    $channel: { type: partial.scene ?? 'private', id: '1' },
    $content: [],
    $sender: { id: 'u1', isMaster: false, isTrusted: false },
  } as unknown as Message;
}

function makeBinding(
  name = DEFAULT_ZHIN_AGENT_NAME,
  mcpServers: string[] = [],
): ResolvedAgentBinding {
  return {
    name,
    providerAlias: 'mock',
    model: 'mock-model',
    mcpServers,
  };
}

function makeTool(name: string, opts: {
  source?: string;
  platforms?: string[];
  scopes?: Array<'private' | 'group' | 'channel'>;
  permissions?: string[];
} = {}) {
  return {
    name,
    description: name,
    parameters: { type: 'object' as const, properties: {} },
    execute: async () => name,
    source: opts.source,
    platforms: opts.platforms,
    scopes: opts.scopes,
    permissions: opts.permissions,
  };
}

describe('FeatureCapabilityIngress', () => {
  let ingress: FeatureCapabilityIngress;
  let orch: AgentOrchestrator;
  let tools: ToolFeature;
  let skills: SkillFeature;
  let agents: AgentFeature;
  let mcps: MCPFeature;

  beforeEach(() => {
    ingress = new FeatureCapabilityIngress();
    orch = new AgentOrchestrator();
    tools = new ToolFeature();
    skills = new SkillFeature();
    agents = new AgentFeature();
    mcps = new MCPFeature();
  });

  const bundle = () => ({ tools, skills, agents, mcps });

  it('ensureCore loads builtin tools and reports net adds', () => {
    tools.addTool(makeTool('bash', { source: 'builtin' }), 'root');
    tools.addTool(makeTool('plugin_echo', { source: 'plugin:x' }), 'x');

    expect(ingress.ensureCore(orch, { tools }).tools).toBe(1);
    expect(orch.tools.get('bash')?.source).toBe('builtin');
    expect(orch.tools.get('plugin_echo')).toBeUndefined();

    // second pass: same builtins → net 0
    expect(ingress.ensureCore(orch, { tools }).tools).toBe(0);

    tools.addTool(makeTool('web_search', { source: 'builtin' }), 'root');
    expect(ingress.ensureCore(orch, { tools }).tools).toBe(1);
    expect(orch.tools.get('web_search')).toBeDefined();
  });

  it('ensureForTurn filters by platforms and caches by key', () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('any_plat', { source: 'plugin:a' }), 'a');

    const binding = makeBinding();
    const icqqMsg = makeMessage({ adapter: 'icqq', scene: 'group' });

    const first = ingress.ensureForTurn(orch, bundle(), { binding, message: icqqMsg });
    expect(first.cacheHit).toBe(false);
    expect(orch.tools.get('icqq_only')).toBeDefined();
    expect(orch.tools.get('any_plat')).toBeDefined();

    const second = ingress.ensureForTurn(orch, bundle(), { binding, message: icqqMsg });
    expect(second.cacheHit).toBe(true);
    expect(second.tools).toBe(0);
  });

  it('ensureForTurn skips tools that fail platforms filter', () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');

    const result = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(result.tools).toBe(0);
    expect(orch.tools.get('icqq_only')).toBeUndefined();
  });

  it('ensureForTurn skips tools that fail scopes filter', () => {
    tools.addTool(makeTool('group_only', {
      source: 'plugin:a',
      scopes: ['group'],
    }), 'a');

    const privateResult = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ scene: 'private' }) },
    );
    expect(privateResult.tools).toBe(0);
    expect(orch.tools.get('group_only')).toBeUndefined();

    ingress.invalidate();
    const groupResult = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ scene: 'group' }) },
    );
    expect(groupResult.tools).toBe(1);
    expect(orch.tools.get('group_only')).toBeDefined();
  });

  it('ensureForTurn skips tools that fail permissions filter', () => {
    tools.addTool(makeTool('master_only', {
      source: 'plugin:a',
      permissions: ['role(master)'],
    }), 'a');

    const userMsg = makeMessage({});
    const denied = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: userMsg },
    );
    expect(denied.tools).toBe(0);

    ingress.invalidate();
    const masterMsg = {
      ...makeMessage({}),
      $sender: { id: 'u1', isMaster: true, isTrusted: true },
    } as unknown as Message;
    const allowed = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: masterMsg },
    );
    expect(allowed.tools).toBe(1);
    expect(orch.tools.get('master_only')).toBeDefined();
  });

  it('switches access projection: purges previous on-demand tools', () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('process_only', {
      source: 'plugin:a',
      platforms: ['process'],
    }), 'a');

    const first = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(orch.tools.get('icqq_only')).toBeDefined();
    expect(orch.tools.get('process_only')).toBeUndefined();
    first.release();

    ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(orch.tools.get('icqq_only')).toBeUndefined();
    expect(orch.tools.get('process_only')).toBeDefined();
  });

  it('defers purging the previous projection while its turn is in flight', () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('process_only', {
      source: 'plugin:a',
      platforms: ['process'],
    }), 'a');
    tools.addTool(makeTool('shared', { source: 'plugin:a' }), 'a');

    // Turn A starts on the icqq projection and is still executing…
    const turnA = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(orch.tools.get('icqq_only')).toBeDefined();

    // …when turn B interleaves on a different projection: the cache miss
    // must NOT purge the tools turn A is running with.
    const turnB = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(turnB.cacheHit).toBe(false);
    expect(orch.tools.get('icqq_only')).toBeDefined();
    expect(orch.tools.get('process_only')).toBeDefined();
    expect(orch.tools.get('shared')).toBeDefined();

    // Turn A finishes: its retired projection is purged, but names the live
    // projection re-registered (shared) survive.
    turnA.release();
    expect(orch.tools.get('icqq_only')).toBeUndefined();
    expect(orch.tools.get('process_only')).toBeDefined();
    expect(orch.tools.get('shared')).toBeDefined();

    // Turn B finishes: the live projection stays cached for the next turn.
    turnB.release();
    const again = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(again.cacheHit).toBe(true);
    expect(orch.tools.get('process_only')).toBeDefined();
    again.release();
  });

  it('fingerprint change (tool meta) invalidates prior cache key', () => {
    tools.addTool(makeTool('a1', { source: 'plugin:a' }), 'a');
    const binding = makeBinding();
    const msg = makeMessage({ adapter: 'process' });

    ingress.ensureForTurn(orch, bundle(), { binding, message: msg });
    tools.addTool(makeTool('a2', { source: 'plugin:a' }), 'a');

    const again = ingress.ensureForTurn(orch, bundle(), { binding, message: msg });
    expect(again.cacheHit).toBe(false);
    expect(orch.tools.get('a2')).toBeDefined();
  });

  it('AgentFeature epoch change invalidates cache', () => {
    const binding = makeBinding();
    const msg = makeMessage({});
    ingress.ensureForTurn(orch, bundle(), { binding, message: msg });
    expect(
      ingress.ensureForTurn(orch, bundle(), { binding, message: msg }).cacheHit,
    ).toBe(true);

    agents.add({
      name: 'helper',
      description: 'h',
      systemPrompt: 'hi',
      pluginName: 'p',
    }, 'p');

    const after = ingress.ensureForTurn(orch, bundle(), { binding, message: msg });
    expect(after.cacheHit).toBe(false);
    expect(after.agents).toBe(1);
    expect(orch.subagents.getPreset('helper')).toBeDefined();
  });

  it('loads only MCP servers listed on binding.mcpServers', () => {
    mcps.add({
      name: 'allowed',
      transport: 'stdio',
      command: 'echo',
      pluginName: 'p',
    }, 'p');
    mcps.add({
      name: 'other',
      transport: 'stdio',
      command: 'echo',
      pluginName: 'p',
    }, 'p');

    const empty = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding('zhin', []), message: makeMessage() },
    );
    expect(empty.mcps).toBe(0);
    expect(orch.mcps.has('allowed')).toBe(false);

    ingress.invalidate();
    const filtered = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding('zhin', ['allowed']), message: makeMessage() },
    );
    expect(filtered.mcps).toBe(1);
    expect(orch.mcps.has('allowed')).toBe(true);
    expect(orch.mcps.has('other')).toBe(false);
  });

  it('loads skills and agent presets from Features', () => {
    skills.add({
      name: 'demo',
      description: 'demo skill',
      tools: [],
      pluginName: 'p',
      platforms: ['process'],
    }, 'p');
    agents.add({
      name: 'helper',
      description: 'helper preset',
      systemPrompt: 'hi',
      pluginName: 'p',
    }, 'p');

    const result = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(result.skills).toBe(1);
    expect(result.agents).toBe(1);
    expect(orch.skills.getByName('demo')).toBeDefined();
    expect(orch.subagents.getPreset('helper')).toBeDefined();
  });

  it('skill platforms filter uses canAccessTool vocabulary', () => {
    skills.add({
      name: 'icqq_skill',
      description: 'x',
      tools: [],
      pluginName: 'p',
      platforms: ['icqq'],
    }, 'p');

    const miss = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(miss.skills).toBe(0);

    ingress.invalidate();
    const hit = ingress.ensureForTurn(
      orch,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(hit.skills).toBe(1);
  });

  it('invalidate clears lastCacheKey; ensureCore net stays 0 for same builtins', () => {
    tools.addTool(makeTool('bash', { source: 'builtin' }), 'root');
    expect(ingress.ensureCore(orch, { tools }).tools).toBe(1);
    ingress.invalidate();
    expect(ingress.ensureCore(orch, { tools }).tools).toBe(0);
  });
});
