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
  AgentTurnCoordinator,
  agentTurnEngineToken,
  ToolIngressRuntime,
  CapabilityIngress,
  capabilityToTool,
  turnJournalStoreToken,
  type ExternalToolCapability,
} from '../../src/plugin-runtime/index.js';
import { turnToolExecutionAuthority } from '../../src/tool/turn-tool-runtime.js';
import { getAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';

describe('Agent CapabilityIngress', () => {
  it('admits supersede in arrival order and aborts the active operation before replacement starts', async () => {
    const coordinator = new AgentTurnCoordinator();
    const callerSignal = new AbortController().signal;
    const order: string[] = [];
    let firstAdmitted!: () => void;
    const admitted = new Promise<void>((resolve) => { firstAdmitted = resolve; });

    const first = coordinator.runIntent(
      'shared', callerSignal, { kind: 'supersede' }, principal('user-1'), async (admit, signal) => {
        order.push('first:start');
        admit();
        firstAdmitted();
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            order.push('first:aborted');
            resolve();
          }, { once: true });
        });
        return 'first';
      },
    );
    await admitted;

    const second = coordinator.runIntent(
      'shared', callerSignal, { kind: 'supersede' }, principal('user-1'), async (admit) => {
        order.push('second:start');
        admit();
        return 'second';
      },
    );

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(order).toEqual(['first:start', 'first:aborted', 'second:start']);
  });

  it('keeps control intents attached to the active tail so a later new turn waits', async () => {
    const coordinator = new AgentTurnCoordinator();
    const signal = new AbortController().signal;
    const order: string[] = [];
    let release!: () => void;
    let activeAdmitted!: () => void;
    const admitted = new Promise<void>((resolve) => { activeAdmitted = resolve; });
    const active = coordinator.runIntent(
      'shared', signal, { kind: 'supersede' }, principal('user-1'), async (admit) => {
        order.push('active:start');
        admit();
        activeAdmitted();
        await new Promise<void>((resolve) => { release = resolve; });
        order.push('active:end');
      },
    );
    await admitted;
    await coordinator.runIntent(
      'shared', signal, { kind: 'steer' }, principal('user-1'), async (admit) => {
        order.push('control');
        admit();
      },
    );

    const next = coordinator.runIntent(
      'shared', signal, { kind: 'new' }, principal('user-1'), async (admit) => {
        order.push('new');
        admit();
      },
    );
    await Promise.resolve();
    expect(order).toEqual(['active:start', 'control']);
    release!();
    await Promise.all([active, next]);
    expect(order).toEqual(['active:start', 'control', 'active:end', 'new']);
  });

  it('preserves default cross-principal supersede behavior for shared sessions', async () => {
    const coordinator = new AgentTurnCoordinator();
    const signal = new AbortController().signal;
    let admitted!: () => void;
    const ready = new Promise<void>((resolve) => { admitted = resolve; });
    let firstAborted = false;
    const first = coordinator.runIntent(
      'shared', signal, { kind: 'new' }, principal('user-1'), async (admit, turnSignal) => {
        admit();
        admitted();
        await new Promise<void>((resolve) => {
          turnSignal.addEventListener('abort', () => {
            firstAborted = true;
            resolve();
          }, { once: true });
        });
      },
    );
    await ready;

    await expect(coordinator.runIntent(
      'shared', signal, { kind: 'supersede' }, principal('user-2'), async () => undefined,
    )).resolves.toBeUndefined();
    expect(firstAborted).toBe(true);
    await first;
  });

  it('serializes turns for the same session across generation runtimes', async () => {
    const coordinator = new AgentTurnCoordinator();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const order: string[] = [];
    const signal = new AbortController().signal;
    const first = coordinator.run('session', signal, async () => {
      order.push('first:start');
      entered();
      await blocked;
      order.push('first:end');
    });
    const second = coordinator.run('session', signal, async () => {
      order.push('second');
    });
    await started;
    expect(order).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('builds a collision-free Agent Tool catalog across plugin owners', async () => {
    const fixture = await createFixture();
    const capabilities = await new CapabilityIngress().read(fixture.snapshot, fixture.child);

    expect(capabilities.tools.map((tool) => tool.name)).toEqual(['child__lookup']);
    expect(capabilities.skills.map((skill) => skill.name)).toEqual(['research']);
    expect(capabilities.agents.map((agent) => agent.name)).toEqual(['planner']);
    expect(capabilities.mcp.map((connection) => connection.name)).toEqual(['memory']);
    await expect(capabilities.tools[0]?.execute({ value: 'x' }, invocation())).resolves.toBe('old:x');
    await expect(capabilities.mcp[0]?.listTools()).resolves.toEqual([{ name: 'search' }]);
    await expect(capabilities.mcp[0]?.callTool('search', { q: 'x' })).resolves.toEqual({ q: 'x' });
    expect(Object.isFrozen(capabilities)).toBe(true);
    await fixture.mcp.stop();
  });

  it('holds one generation for the complete Agent turn', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new ToolIngressRuntime();
    runtime.attach(store);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let captured: ExternalToolCapability | undefined;

    const turn = runtime.withTools(fixture.child, externalRequest('lease-1'), async (tools) => {
      captured = tools[0];
      entered();
      await gate;
      return tools[0]?.execute({ value: 'leased' }, 'call-leased');
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
        approval: 'never',
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

    await expect(turn).resolves.toMatchObject({ status: 'completed', output: 'old:leased' });
    expect(fixture.journal.events.at(-1)?.terminal).toBe('completed');
    await expect(runtime.withTools(fixture.child, externalRequest('lease-2'), (next) =>
      next[0]?.execute({ value: 'turn' }, 'call-turn'))).resolves.toMatchObject({
        status: 'completed', output: 'new:turn',
      });
    await expect(captured?.execute({ value: 'late' }, 'call-late'))
      .rejects.toThrow('scope has ended');
    await fixture.mcp.stop();
    await store.close();
  });

  it('preserves fail-closed approval semantics in the production Tool projection', async () => {
    const fixture = await createFixture({ approval: 'on-risk' });
    const [capability] = (await new CapabilityIngress().read(fixture.snapshot, rootPluginId())).tools;
    expect(capabilityToTool(capability!, invocation()).approval).toBe('on-risk');
    await fixture.mcp.stop();
  });

  it('fails closed for approval-gated external protocol tools', async () => {
    const fixture = await createFixture({ approval: 'always' });
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new ToolIngressRuntime();
    runtime.attach(store);

    await expect(runtime.withTools(fixture.child, externalRequest('approval'), (tools) =>
      tools[0]!.execute({ value: 'blocked' }, 'call-blocked'))).resolves.toMatchObject({
        status: 'denied',
        policy: 'approval',
      });
    expect(fixture.journal.events.at(-1)?.terminal).toBe('failed');
    await fixture.mcp.stop();
    await store.close();
  });

  it('executes one canonical TurnIngress with snapshot-owned capabilities', async () => {
    const fixture = await createFixture();
    const seen: import('../../src/turn/turn-ingress.js').TurnIngress[] = [];
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ turn, capabilities, tools }) {
      seen.push(turn);
      expect(capabilities.tools[0]?.name).toBe('child__lookup');
      expect(capabilities.tools.map((tool) => tool.name)).toContain('child__memory__search');
      expect(capabilities.tools.find((tool) => tool.name === 'child__memory__search')?.approval)
        .toBe('on-risk');
      expect('execute' in capabilities.tools[0]!).toBe(false);
      await expect(tools.execute('child__lookup', { value: 'runner' }, 'call-1')).resolves.toMatchObject({
        status: 'completed', output: 'old:runner',
      });
      await expect(turnToolExecutionAuthority(tools).execute({
        name: 'child__lookup',
        description: 'Lookup',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'must not execute transport adapter',
      }, { value: 'authority' }, 'call-2')).resolves.toMatchObject({
        status: 'completed', output: 'old:authority',
      });
      yield {
        type: 'turn_end',
        output: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      };
    }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);

    const outcome = await runtime.execute(fixture.child, {
      identity: { traceId: 'trace-1', turnId: 'turn-1' },
      origin: { kind: 'http', sessionId: 'http-1' },
      intent: { kind: 'new' },
      principal: { subjectId: 'user-1', roles: ['user'] },
      input: { text: 'hello' },
      session: { key: 'http:http-1' },
      policy: { permissions: ['user'], unattended: false },
      signal: new AbortController().signal,
      ports: {},
    }, selection(['memory']));

    expect(outcome).toMatchObject({ status: 'completed' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      identity: { rootId: 'root', generation: 0, traceId: 'trace-1', turnId: 'turn-1' },
      capabilities: { tools: ['child__lookup', 'child__memory__search'], skills: ['research'] },
    });
    await fixture.mcp.stop();
    await store.close();
  });

  it('fails closed when the active generation has no Agent Turn Engine', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);

    await expect(runtime.execute(fixture.child, externalRequest('no-engine'), selection()))
      .rejects.toThrow('Agent Turn Engine');
    await fixture.mcp.stop();
    await store.close();
  });

  it('rejects a released generation lease at the canonical execution boundary', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    const lease = store.acquire();
    lease.release();

    await expect(runtime.executeLeased(
      lease, fixture.child, externalRequest('released'), selection(),
    ))
      .rejects.toThrow('active generation lease');
    await fixture.mcp.stop();
    await store.close();
  });

  it('rejects a generation lease owned by another Root', async () => {
    const fixture = await createFixture();
    const attached = new SnapshotStore(stateFrom(fixture.snapshot));
    const other = new SnapshotStore(stateFrom(fixture.snapshot));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(attached);
    const foreignLease = other.acquire();
    await expect(runtime.executeLeased(
      foreignLease, fixture.child, externalRequest('foreign'), selection(),
    ))
      .rejects.toThrow('another Root');
    foreignLease.release();
    await fixture.mcp.stop();
    await attached.close();
    await other.close();
  });

  it('exposes only MCP servers selected by the active binding', async () => {
    const fixture = await createFixture();
    let names: readonly string[] = [];
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ capabilities }) {
      names = capabilities.tools.map((tool) => tool.name);
      yield terminalEvent();
    }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    await runtime.execute(fixture.child, externalRequest('mcp-filter'), selection());
    expect(names).toEqual(['child__lookup']);
    await fixture.mcp.stop();
    await store.close();
  });

  it('shares one session queue across distinct generation runtime instances', async () => {
    const fixture = await createFixture();
    const coordinator = new AgentTurnCoordinator();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const order: string[] = [];
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ turn }) {
      if (turn.identity.turnId.endsWith('first')) {
        order.push('old:start');
        entered();
        await blocked;
        order.push('old:end');
      } else {
        order.push('next');
      }
      yield terminalEvent();
    }));
    const firstRuntime = new AgentRuntime({ coordinator });
    const nextRuntime = new AgentRuntime({ coordinator });
    firstRuntime.attach(store);
    nextRuntime.attach(store);

    const first = firstRuntime.execute(fixture.child, externalRequest('first'), selection());
    await started;
    const next = nextRuntime.execute(fixture.child, {
      ...externalRequest('next'), intent: { kind: 'new' },
    }, selection());
    await Promise.resolve();
    expect(order).toEqual(['old:start']);
    release();
    await Promise.all([first, next]);
    expect(order).toEqual(['old:start', 'old:end', 'next']);
    await fixture.mcp.stop();
    await store.close();
  });

  it('isolates provider bindings across concurrent canonical turns', async () => {
    const fixture = await createFixture();
    const observed = new Map<string, string[]>();
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ turn }) {
      const values = observed.get(turn.identity.turnId) ?? [];
      values.push(getAgentTurnConfiguration()?.activeBinding?.name ?? 'missing');
      observed.set(turn.identity.turnId, values);
      await Promise.resolve();
      values.push(getAgentTurnConfiguration()?.activeBinding?.name ?? 'missing');
      yield terminalEvent();
    }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);

    await Promise.all([
      runtime.execute(fixture.child, {
        ...externalRequest('alpha'),
        session: { key: 'session:alpha' },
      }, selection([], 'alpha')),
      runtime.execute(fixture.child, {
        ...externalRequest('beta'),
        session: { key: 'session:beta' },
      }, selection([], 'beta')),
    ]);

    expect(observed.get('turn-alpha')).toEqual(['alpha', 'alpha']);
    expect(observed.get('turn-beta')).toEqual(['beta', 'beta']);
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
    )).tools.map((tool) => tool.name)).toEqual(['child__lookup']);

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
  readonly approval?: 'never' | 'on-risk' | 'always';
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
      approval: access.approval ?? 'never',
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
    owner: child,
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
  const journal = memoryJournalStore();
  const base = baseState(slots, journal);
  const view = createSnapshotView(1, base);
  const mcp = await McpIndex.create([mcpSlot], view, new AbortController().signal);
  await mcp.start(new AbortController().signal);
  const snapshot = createSnapshotView(1, {
    ...base,
    projections: new Map([
      [toolFeatureId, new ToolIndex([tool], view)],
      [skillFeatureId, new SkillIndex([skill], view)],
      [agentFeatureId, new AgentIndex([agent], view)],
      [mcpFeatureId, mcp],
    ]),
  });
  return { snapshot, child, mcp, journal };
}

function accessTurn(platform: string) {
  return createTurnIngress({
    intent: { kind: 'new' },
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

function invocation() {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
  } as const;
}

function principal(subjectId: string) {
  return { subjectId, roles: ['user'] } as const;
}

function externalRequest(id: string) {
  return {
    identity: { traceId: `trace-${id}`, turnId: `turn-${id}` },
    origin: { kind: 'http' as const, sessionId: 'mcp' },
    intent: { kind: 'new' as const },
    principal: { subjectId: 'mcp-client', roles: ['authenticated'] },
    input: { text: 'MCP tool request' },
    session: { key: 'mcp:stateless' },
    policy: { permissions: ['authenticated'], unattended: true },
    signal: new AbortController().signal,
    ports: {},
  };
}

function selection(mcpServers: readonly string[] = [], name = 'zhin') {
  return {
    binding: {
      name,
      providerAlias: 'provider',
      model: 'model',
      mcpServers: [...mcpServers],
    },
    mcpServers,
  };
}

function terminalEvent() {
  return {
    type: 'turn_end' as const,
    output: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}


function baseState(slots: readonly CapabilitySlot[], journal = memoryJournalStore()): SnapshotState {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  return {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [child] }],
      [child, { id: child, instanceKey: 'child', packageName: '@test/child', packageRoot: '/project/plugins/child', parent: root, children: [] }],
    ]),
    config: new Map([[root, {}], [child, {}]]),
    resources: new Map([[root, new Map([
      [permissionHostToken.id, createPermissionHost()],
      [turnJournalStoreToken.id, journal],
    ])], [child, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

function memoryJournalStore() {
  const events: import('@zhin.js/ai/agent-stream').AgentRunEvent[] = [];
  return {
    events,
    append: (event: import('@zhin.js/ai/agent-stream').AgentRunEvent) => { events.push(event); },
    replay: async (run: import('@zhin.js/ai/agent-stream').AgentRunIdentity, after = 0) =>
      events.filter((event) => event.run.sessionId === run.sessionId
        && event.run.turnId === run.turnId && event.sequence > after),
    listRuns: async () => [],
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

function stateWithEngine(
  snapshot: RuntimeSnapshot,
  run: import('../../src/plugin-runtime/agent-runtime.js').AgentTurnExecutor,
): SnapshotState {
  const state = stateFrom(snapshot);
  const rootResources = new Map(state.resources.get(state.root));
  rootResources.set(agentTurnEngineToken.id, Object.freeze({ run }));
  return { ...state, resources: new Map(state.resources).set(state.root, rootResources) };
}
