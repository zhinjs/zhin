import { describe, expect, it } from 'vitest';
import {
  SnapshotStore,
  childPluginId,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type CapabilitySlot,
  type RuntimeSnapshot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  AgentIndex,
  agentFeatureId,
  parseAgentMarkdown,
} from '@zhin.js/agent-feature';
import {
  McpIndex,
  defineMcp,
  mcpFeatureId,
} from '@zhin.js/mcp-feature';
import {
  SkillIndex,
  parseSkillMarkdown,
  skillFeatureId,
} from '@zhin.js/skill';
import {
  ToolIndex,
  defineAgentTool,
  toolFeatureId,
} from '@zhin.js/tool';
import { createPermissionHost, permissionHostToken } from '@zhin.js/permission';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import {
  AgentRuntime,
  CapabilityLeaseRuntime,
  CapabilityIngress,
  type ToolCapability,
} from '../../src/plugin-runtime/index.js';

describe('Agent CapabilityIngress', () => {
  it('builds an owner-visible immutable view across four Feature projections', async () => {
    const fixture = await createFixture();
    const capabilities = await new CapabilityIngress().read(fixture.snapshot, fixture.child);

    expect(capabilities.tools.map((tool) => tool.name)).toEqual(['lookup']);
    expect(capabilities.skills.map((skill) => skill.name)).toEqual(['research']);
    expect(capabilities.agents.map((agent) => agent.name)).toEqual(['planner']);
    expect(capabilities.mcp.map((connection) => connection.name)).toEqual(['memory']);
    await expect(capabilities.tools[0]?.execute({ value: 'x' })).resolves.toBe('old:x');
    await expect(capabilities.mcp[0]?.listTools()).resolves.toEqual([{ name: 'search' }]);
    await expect(capabilities.mcp[0]?.callTool('search', { q: 'x' })).resolves.toEqual({ q: 'x' });
    expect(Object.isFrozen(capabilities)).toBe(true);
    await fixture.mcp.stop();
  });

  it('holds one generation for the complete Agent turn', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new CapabilityLeaseRuntime();
    runtime.attach(store);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let captured: ToolCapability | undefined;

    const turn = runtime.withCapabilities(fixture.child, async (capabilities) => {
      captured = capabilities.tools[0];
      entered();
      await gate;
      return capabilities.tools[0]?.execute({ value: 'leased' });
    });
    await started;
    const current = store.current;
    const replacement = createCapabilitySlot({
      owner: fixture.child,
      feature: toolFeatureId,
      localName: 'lookup',
      source: '/plugins/child/tools/lookup.ts',
      definition: defineAgentTool<{ value: string }>({
        description: 'Replacement lookup',
        execute: (input) => `new:${input.value}`,
      }),
    });
    const capabilities = new Map(current.capabilities);
    capabilities.set(replacement.id, replacement);
    const candidateBase = { ...stateFrom(current), capabilities };
    const candidateView = createSnapshotView(1, candidateBase);
    const projections = new Map(current.projections);
    projections.set(toolFeatureId, new ToolIndex([replacement], candidateView));
    store.commit(0, {
      snapshot: { ...candidateBase, projections },
      dispose: () => undefined,
    });
    release();

    await expect(turn).resolves.toBe('old:leased');
    await expect(runtime.withCapabilities(fixture.child, (next) =>
      next.tools[0]?.execute({ value: 'turn' }))).resolves.toBe('new:turn');
    expect(() => captured?.execute({ value: 'late' })).toThrow('scope has ended');
    await fixture.mcp.stop();
    await store.close();
  });

  it('executes one canonical TurnIngress with snapshot-owned capabilities', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const seen: import('../../src/turn/turn-ingress.js').TurnIngress[] = [];
    const runtime = new AgentRuntime(async function* ({ turn, capabilities }) {
      seen.push(turn);
      expect(capabilities.tools[0]?.name).toBe('lookup');
      yield {
        type: 'turn_end',
        output: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      };
    });
    runtime.attach(store);

    const outcome = await runtime.execute(fixture.child, {
      identity: { traceId: 'trace-1', turnId: 'turn-1' },
      origin: { kind: 'http', sessionId: 'http-1' },
      principal: { subjectId: 'user-1', roles: ['user'] },
      input: { text: 'hello' },
      session: { key: 'http:http-1' },
      policy: { permissions: ['user'], unattended: false },
      signal: new AbortController().signal,
      ports: { journal: { append: () => undefined } },
    });

    expect(outcome).toMatchObject({ status: 'completed' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      identity: { rootId: 'root', generation: 0, traceId: 'trace-1', turnId: 'turn-1' },
      capabilities: { tools: ['lookup'], skills: ['research'] },
    });
    await fixture.mcp.stop();
    await store.close();
  });

  it('filters hidden and context-restricted tools through the canonical permit checker', async () => {
    const restricted = await createFixture({
      platforms: ['qq'],
      scopes: ['group'],
      permissions: ['role(trusted)'],
    });
    const ingress = new CapabilityIngress();
    expect((await ingress.read(restricted.snapshot, restricted.child)).tools).toEqual([]);

    const allowedTurn = accessTurn('qq');
    expect((await ingress.read(
      restricted.snapshot,
      restricted.child,
      () => true,
      allowedTurn,
    )).tools.map((tool) => tool.name)).toEqual(['lookup']);

    const wrongPlatform = accessTurn('telegram');
    expect((await ingress.read(
      restricted.snapshot,
      restricted.child,
      () => true,
      wrongPlatform,
    )).tools).toEqual([]);
    await restricted.mcp.stop();

    const hidden = await createFixture({ hidden: true });
    expect((await ingress.read(hidden.snapshot, hidden.child)).tools).toEqual([]);
    await hidden.mcp.stop();
  });
});

async function createFixture(access: {
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
} = {}) {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  const validation = (owner: typeof root, feature: typeof agentFeatureId, name: string, source: string) => ({
    owner, feature, localName: name, source,
  });
  const tool = createCapabilitySlot({
    owner: child,
    feature: toolFeatureId,
    localName: 'lookup',
    source: '/plugins/child/tools/lookup.ts',
    definition: defineAgentTool<{ value: string }>({
      description: 'Lookup',
      ...access,
      execute(input) { return `old:${input.value}`; },
    }),
  });
  const skill = createCapabilitySlot({
    owner: root,
    feature: skillFeatureId,
    localName: 'research',
    source: '/skills/research/SKILL.md',
    definition: parseSkillMarkdown('# Research', validation(
      root,
      skillFeatureId,
      'research',
      '/skills/research/SKILL.md',
    )),
  });
  const agent = createCapabilitySlot({
    owner: root,
    feature: agentFeatureId,
    localName: 'planner',
    source: '/agents/planner.agent.md',
    definition: parseAgentMarkdown('# Planner', validation(
      root,
      agentFeatureId,
      'planner',
      '/agents/planner.agent.md',
    )),
  });
  const mcpSlot = createCapabilitySlot({
    owner: root,
    feature: mcpFeatureId,
    localName: 'memory',
    source: '/mcp/memory.ts',
    definition: defineMcp({
      create: () => ({
        listTools: () => [{ name: 'search' }],
        callTool: (_name, input) => input,
      }),
    }),
  });
  const slots: readonly CapabilitySlot[] = [tool, skill, agent, mcpSlot];
  const base = baseState(slots);
  const view = createSnapshotView(1, base);
  const mcp = await McpIndex.create([mcpSlot], view);
  await mcp.start();
  const snapshot = createSnapshotView(1, {
    ...base,
    projections: new Map([
      [toolFeatureId, new ToolIndex([tool], view)],
      [skillFeatureId, new SkillIndex([skill], view)],
      [agentFeatureId, new AgentIndex([agent], view)],
      [mcpFeatureId, mcp],
    ]),
  });
  return { snapshot, child, mcp };
}

function accessTurn(platform: string) {
  return createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform, endpoint: 'bot', scope: 'group', sceneId: '100' },
    principal: { subjectId: 'trusted-user', roles: ['trusted'] },
    input: { text: 'lookup' },
    session: { key: `im:${platform}:bot:group:100` },
    policy: { permissions: ['trusted'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined } },
  });
}


function baseState(slots: readonly CapabilitySlot[]): SnapshotState {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  return {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [child] }],
      [child, { id: child, instanceKey: 'child', packageName: '@test/child', packageRoot: '/project/plugins/child', parent: root, children: [] }],
    ]),
    config: new Map([[root, {}], [child, {}]]),
    resources: new Map([[root, new Map([[permissionHostToken.id, createPermissionHost()]])], [child, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

function stateFrom(snapshot: RuntimeSnapshot): SnapshotState {
  return {
    root: snapshot.root,
    tree: snapshot.tree,
    config: snapshot.config,
    resources: snapshot.resources,
    capabilities: snapshot.capabilities,
    projections: snapshot.projections,
  };
}
