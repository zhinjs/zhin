import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFeature, SkillFeature, type Message } from '@zhin.js/core';
import { createPermissionHost, type PermissionHost } from '@zhin.js/permission';
import { AgentResourceHub } from '../../src/resource-hub/index.js';
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
  let resourceHub: AgentResourceHub;
  let tools: ToolFeature;
  let skills: SkillFeature;
  let agents: AgentFeature;
  let mcps: MCPFeature;

  beforeEach(() => {
    ingress = new FeatureCapabilityIngress();
    resourceHub = new AgentResourceHub();
    tools = new ToolFeature();
    skills = new SkillFeature();
    agents = new AgentFeature();
    mcps = new MCPFeature();
  });

  const bundle = () => ({ tools, skills, agents, mcps });

  it('ensureCore loads builtin tools and reports net adds', () => {
    tools.addTool(makeTool('bash', { source: 'builtin' }), 'root');
    tools.addTool(makeTool('plugin_echo', { source: 'plugin:x' }), 'x');

    expect(ingress.ensureCore(resourceHub, { tools }).tools).toBe(1);
    expect(resourceHub.tools.get('bash')?.source).toBe('builtin');
    expect(resourceHub.tools.get('plugin_echo')).toBeUndefined();

    // second pass: same builtins → net 0
    expect(ingress.ensureCore(resourceHub, { tools }).tools).toBe(0);

    tools.addTool(makeTool('web_search', { source: 'builtin' }), 'root');
    expect(ingress.ensureCore(resourceHub, { tools }).tools).toBe(1);
    expect(resourceHub.tools.get('web_search')).toBeDefined();
  });

  it('ensureForTurn filters by platforms and caches by key', async () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('any_plat', { source: 'plugin:a' }), 'a');

    const binding = makeBinding();
    const icqqMsg = makeMessage({ adapter: 'icqq', scene: 'group' });

    const first = await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: icqqMsg });
    expect(first.cacheHit).toBe(false);
    expect(resourceHub.tools.get('icqq_only')).toBeDefined();
    expect(resourceHub.tools.get('any_plat')).toBeDefined();

    const second = await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: icqqMsg });
    expect(second.cacheHit).toBe(true);
    expect(second.tools).toBe(0);
  });

  it('ensureForTurn skips tools that fail platforms filter', async () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');

    const result = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(result.tools).toBe(0);
    expect(resourceHub.tools.get('icqq_only')).toBeUndefined();
  });

  it('ensureForTurn skips tools that fail scopes filter', async () => {
    tools.addTool(makeTool('group_only', {
      source: 'plugin:a',
      scopes: ['group'],
    }), 'a');

    const privateResult = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ scene: 'private' }) },
    );
    expect(privateResult.tools).toBe(0);
    expect(resourceHub.tools.get('group_only')).toBeUndefined();

    ingress.invalidate();
    const groupResult = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ scene: 'group' }) },
    );
    expect(groupResult.tools).toBe(1);
    expect(resourceHub.tools.get('group_only')).toBeDefined();
  });

  it('ensureForTurn skips tools that fail permissions filter', async () => {
    tools.addTool(makeTool('master_only', {
      source: 'plugin:a',
      permissions: ['role(master)'],
    }), 'a');

    const host = createPermissionHost();
    const userMsg = makeMessage({});
    const denied = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: userMsg, host },
    );
    expect(denied.tools).toBe(0);

    ingress.invalidate();
    const masterMsg = {
      ...makeMessage({}),
      $sender: { id: 'u1', role: ['master'], isMaster: true, isTrusted: true },
    } as unknown as Message;
    const allowed = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: masterMsg, host },
    );
    expect(allowed.tools).toBe(1);
    expect(resourceHub.tools.get('master_only')).toBeDefined();
  });

  it('switches access projection: purges previous on-demand tools', async () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('process_only', {
      source: 'plugin:a',
      platforms: ['process'],
    }), 'a');

    const first = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(resourceHub.tools.get('icqq_only')).toBeDefined();
    expect(resourceHub.tools.get('process_only')).toBeUndefined();
    first.release();

    await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(resourceHub.tools.get('icqq_only')).toBeUndefined();
    expect(resourceHub.tools.get('process_only')).toBeDefined();
  });

  it('defers purging the previous projection while its turn is in flight', async () => {
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
    const turnA = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(resourceHub.tools.get('icqq_only')).toBeDefined();

    // …when turn B interleaves on a different projection: the cache miss
    // must NOT purge the tools turn A is running with.
    const turnB = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(turnB.cacheHit).toBe(false);
    expect(resourceHub.tools.get('icqq_only')).toBeDefined();
    expect(resourceHub.tools.get('process_only')).toBeDefined();
    expect(resourceHub.tools.get('shared')).toBeDefined();

    // Turn A finishes: its retired projection is purged, but names the live
    // projection re-registered (shared) survive.
    turnA.release();
    expect(resourceHub.tools.get('icqq_only')).toBeUndefined();
    expect(resourceHub.tools.get('process_only')).toBeDefined();
    expect(resourceHub.tools.get('shared')).toBeDefined();

    // Turn B finishes: the live projection stays cached for the next turn.
    turnB.release();
    const again = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(again.cacheHit).toBe(true);
    expect(resourceHub.tools.get('process_only')).toBeDefined();
    again.release();
  });

  it('key oscillation A→B→A keeps per-projection lease accounting', async () => {
    tools.addTool(makeTool('icqq_only', {
      source: 'plugin:a',
      platforms: ['icqq'],
    }), 'a');
    tools.addTool(makeTool('process_only', {
      source: 'plugin:a',
      platforms: ['process'],
    }), 'a');
    tools.addTool(makeTool('shared', { source: 'plugin:a' }), 'a');

    const icqqCtx = { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) };
    const processCtx = { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) };

    // K1 (icqq) live → K2 (process) retires K1 → K1 again retires K2.
    const turnA = await ingress.ensureForTurn(resourceHub, bundle(), icqqCtx);
    const turnB = await ingress.ensureForTurn(resourceHub, bundle(), processCtx);
    const turnC = await ingress.ensureForTurn(resourceHub, bundle(), icqqCtx);
    expect(turnC.cacheHit).toBe(false);

    // Turn A belongs to the *retired* K1 projection, not the live one:
    // its release must not decrement the live projection's in-flight count.
    turnA.release();

    // Next miss must still defer the purge — turn C is executing with K1.
    const turnD = await ingress.ensureForTurn(resourceHub, bundle(), processCtx);
    expect(turnD.cacheHit).toBe(false);
    expect(resourceHub.tools.get('icqq_only')).toBeDefined();

    // Turn C drains the second K1 projection: its unique entries purge,
    // names re-registered by the live projection survive.
    turnC.release();
    expect(resourceHub.tools.get('icqq_only')).toBeUndefined();
    expect(resourceHub.tools.get('process_only')).toBeDefined();
    expect(resourceHub.tools.get('shared')).toBeDefined();

    // Retired K2 (turn B) drains; live K2' keeps its names.
    turnB.release();
    expect(resourceHub.tools.get('process_only')).toBeDefined();

    // Live projection stays cached once every lease is released.
    turnD.release();
    const again = await ingress.ensureForTurn(resourceHub, bundle(), processCtx);
    expect(again.cacheHit).toBe(true);
    again.release();
  });

  it('fingerprint change (tool meta) invalidates prior cache key', async () => {
    tools.addTool(makeTool('a1', { source: 'plugin:a' }), 'a');
    const binding = makeBinding();
    const msg = makeMessage({ adapter: 'process' });

    await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: msg });
    tools.addTool(makeTool('a2', { source: 'plugin:a' }), 'a');

    const again = await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: msg });
    expect(again.cacheHit).toBe(false);
    expect(resourceHub.tools.get('a2')).toBeDefined();
  });

  it('AgentFeature epoch change invalidates cache', async () => {
    const binding = makeBinding();
    const msg = makeMessage({});
    await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: msg });
    expect(
      (await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: msg })).cacheHit,
    ).toBe(true);

    agents.add({
      name: 'helper',
      description: 'h',
      systemPrompt: 'hi',
      pluginName: 'p',
    }, 'p');

    const after = await ingress.ensureForTurn(resourceHub, bundle(), { binding, message: msg });
    expect(after.cacheHit).toBe(false);
    expect(after.agents).toBe(1);
    expect(resourceHub.subagents.getPreset('helper')).toBeDefined();
  });

  it('loads only MCP servers listed on binding.mcpServers', async () => {
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

    const empty = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding('zhin', []), message: makeMessage() },
    );
    expect(empty.mcps).toBe(0);
    expect(resourceHub.mcps.has('allowed')).toBe(false);

    ingress.invalidate();
    const filtered = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding('zhin', ['allowed']), message: makeMessage() },
    );
    expect(filtered.mcps).toBe(1);
    expect(resourceHub.mcps.has('allowed')).toBe(true);
    expect(resourceHub.mcps.has('other')).toBe(false);
  });

  it('loads skills and agent presets from Features', async () => {
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

    const result = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(result.skills).toBe(1);
    expect(result.agents).toBe(1);
    expect(resourceHub.skills.getByName('demo')).toBeDefined();
    expect(resourceHub.subagents.getPreset('helper')).toBeDefined();
  });

  it('skill platforms filter uses canAccessTool vocabulary', async () => {
    skills.add({
      name: 'icqq_skill',
      description: 'x',
      tools: [],
      pluginName: 'p',
      platforms: ['icqq'],
    }, 'p');

    const miss = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'process' }) },
    );
    expect(miss.skills).toBe(0);

    ingress.invalidate();
    const hit = await ingress.ensureForTurn(
      resourceHub,
      bundle(),
      { binding: makeBinding(), message: makeMessage({ adapter: 'icqq' }) },
    );
    expect(hit.skills).toBe(1);
  });

  it('invalidate drops the live cache key; ensureCore net stays 0 for same builtins', () => {
    tools.addTool(makeTool('bash', { source: 'builtin' }), 'root');
    expect(ingress.ensureCore(resourceHub, { tools }).tools).toBe(1);
    ingress.invalidate();
    expect(ingress.ensureCore(resourceHub, { tools }).tools).toBe(0);
  });
});
