import { agentUsageStoreToken } from '../../src/usage/usage-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalImageAssetStore, localImageAssetsToken } from '../../src/media/local-image-assets.js';
import { expandMcpTools } from '../../src/plugin-runtime/agent-runtime.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createNativeLocalAssetsToolFeature } from '../../src/plugin-runtime/native-local-assets-tool.js';
import { describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
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
  parseAgentPackage,
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
import {
  PromptSectionIndex,
  defineAgentPromptSection,
  promptSectionFeatureId,
} from '@zhin.js/prompt-section';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { compactAgentMessages } from '@zhin.js/ai';
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
import { TurnToolExecutionAuthority } from '../../src/tool/turn-tool-runtime.js';
import { getAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { assistantTextReply, assistantToolCallReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { asPrivate } from '../../src/internal/as-private.js';
import { AgentCore } from '../../src/core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps } from '../../src/core/compose-deps.js';
import { createConversationReferenceCapability } from '../../src/tool/conversation-reference-tool.js';

describe('Agent CapabilityIngress', () => {
  it('projects a private image for one full-engine request without persisting bytes into the next turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-image-full-turn-'));
    const localAssets = new LocalImageAssetStore(directory);
    const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const fixture = await createFixture({ localAssets, mcpResult: { content: [{ type: 'image', data: image, mimeType: 'image/gif' }] } });
    const llm = wireMockLlmApi();
    const model = { ...llm.runtime.model('mock', 'mock-model'), input: ['text', 'image'] as const };
    vi.spyOn(llm.runtime, 'model').mockReturnValue(model);
    const agent = new ZhinAgent(llm.provider, { outputSchema: false, maxIterations: 6, toolExecution: 'sequential',
      deferredTools: { alwaysLoadedTools: ['child__memory__search', 'get_local_assets', 'child__lookup'] } }, undefined, llm.runtime);
    agent.activeBinding = { name: 'zhin', providerAlias: 'mock', model: 'mock-model', mcpServers: ['memory'] };
    agent.markMemoryPersistenceReady();
    agent.configure({ localAssets });
    const host = asPrivate(agent);
    const engine = createFullAgentTurnEngine({ host, core: new AgentCore(DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps()),
      sessionSystem: host.sessionSystem, contextSystem: host.contextSystem });
    const snapshot = new SnapshotStore(stateWithEngine(fixture.snapshot, context => engine.run(context)));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() }); runtime.attach(snapshot);
    const requests: unknown[] = [];
    let step = 0;
    llm.respondWith(context => {
      requests.push(JSON.parse(JSON.stringify(context)));
      if (++step === 1) return assistantToolCallReply([{ id: 'capture', name: 'child__memory__search', arguments: {} }]);
      if (step === 2) {
        const assetId = JSON.stringify(context.messages).match(/asset_id[^a-f0-9]+([a-f0-9-]{36})/u)?.[1];
        expect(assetId).toBeTruthy();
        return assistantToolCallReply([{ id: 'inspect', name: 'get_local_assets', arguments: { asset_id: assetId } }]);
      }
      if (step === 3) return assistantToolCallReply([{ id: 'later', name: 'child__lookup', arguments: { value: 'ok' } }]);
      return assistantTextReply('A private image.');
    });
    const selection = { binding: agent.activeBinding, mcpServers: ['memory'] };
    try {
      for (const id of ['first', 'second']) {
        const outcome = await runtime.execute(fixture.child, { ...externalRequest(id), policy: { permissions: ['master'], unattended: false },
          principal: { subjectId: 'owner', roles: ['master'] }, ports: { approval: { requestApproval: async () => true } } }, selection);
        expect(outcome.status, JSON.stringify(outcome)).toBe('completed');
      }
      expect(requests).toHaveLength(5);
      expect(JSON.stringify(requests[2])).toContain(image);
      for (const request of [requests[1], requests[3], requests[4]]) expect(JSON.stringify(request)).not.toContain(image);
      expect(JSON.stringify(fixture.journal.events)).not.toContain(image);
      const session = await host.agentSessionStore.findActive('mcp:stateless');
      expect(session).toBeDefined();
      expect(JSON.stringify(await host.contextRepository.loadContext(session!.session_id))).not.toContain(image);
    } finally { await snapshot.close(); await fixture.mcp.stop(); await rm(directory, { recursive: true, force: true }); }
  });
  it('captures MCP images before the canonical journal and preserves get_local_assets identity through ToolIndex', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-mcp-ingress-'));
    const localAssets = new LocalImageAssetStore(directory);
    const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const fixture = await createFixture({ localAssets, mcpResult: { content: [{ type: 'image', data: image, mimeType: 'image/gif' }] } });
    try {
      const capabilities = await new CapabilityIngress().read(fixture.snapshot, fixture.child);
      const tools = await expandMcpTools(capabilities, ['memory']);
      const events: unknown[] = [];
      const turn = createTurnIngress({ ...accessTurn('icqq'), capabilities: { tools: [...capabilities.tools, ...tools].map(tool => tool.name), skills: [] }, ports: { journal: { append: event => { events.push(event); } }, approval: { requestApproval: async () => true } } });
      const runtime = new TurnToolRuntime(turn, [...capabilities.tools, ...tools]);
      const outcome = await runtime.execute(tools[0]!.name, {}, 'capture');
      expect(outcome.status, JSON.stringify(outcome)).toBe('completed');
      expect(JSON.stringify(events)).not.toContain(image);
      const assetId = JSON.stringify(outcome).match(/asset_id[^a-f0-9]+([a-f0-9-]{36})/u)?.[1];
      expect(assetId).toBeTruthy();
      const inspectTool = capabilities.tools.find(tool => tool.name === 'get_local_assets');
      expect(inspectTool).toBeDefined();
      const inspected = await runtime.execute(inspectTool!.name, { asset_id: assetId }, 'inspect');
      expect(inspected.status).toBe('completed');
      if (inspected.status === 'completed') expect(localAssets.isInspection(inspected.output)).toBe(true);
      expect(JSON.stringify(events)).not.toContain(image);
    } finally { await fixture.mcp.stop(); await rm(directory, { recursive: true, force: true }); }
  });
  it('exposes one scoped reference tool and rejects references outside the current turn', async () => {
    const calls: string[] = [];
    const request = {
      ...externalRequest('reference'),
      input: {
        text: 'inspect it',
        references: [{ key: 'ref-1', kind: 'message' as const, sourceId: 'm-1' }],
      },
      ports: {
        references: {
          resolve: async (key: string) => {
            calls.push(key);
            return { status: 'resolved' as const, content: { id: 'm-1', text: 'quoted' } };
          },
        },
      },
    };
    const capability = createConversationReferenceCapability(rootPluginId(), request);
    await expect(capability?.execute({ reference: 'ref-1', depth: 9 }, invocation()))
      .resolves.toEqual({ status: 'resolved', content: { id: 'm-1', text: 'quoted' } });
    await expect(capability?.execute({ reference: 'ref-other' }, invocation()))
      .resolves.toEqual({ status: 'forbidden', code: 'reference_not_in_turn' });
    expect(calls).toEqual(['ref-1']);
  });

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
    expect(capabilities.promptSections.map((section) => section.title)).toEqual(['Project rules']);
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
        requiresApproval: 'never',
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
    const fixture = await createFixture({
      requiresApproval: 'on-risk',
      tags: ['lookup'],
      keywords: ['find'],
    });
    const [capability] = (await new CapabilityIngress().read(fixture.snapshot, rootPluginId())).tools;
    expect(capabilityToTool(capability!, invocation())).toMatchObject({
      requiresApproval: 'on-risk',
      tags: ['lookup'],
      keywords: ['find'],
    });
    await fixture.mcp.stop();
  });

  it('fails closed for approval-gated external protocol tools', async () => {
    const fixture = await createFixture({ requiresApproval: 'always' });
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
      expect(capabilities.tools.find((tool) => tool.name === 'child__memory__search')?.requiresApproval)
        .toBe('on-risk');
      expect('execute' in capabilities.tools[0]!).toBe(false);
      await expect(tools.execute('child__lookup', { value: 'runner' }, 'call-1')).resolves.toMatchObject({
        status: 'completed', output: 'old:runner',
      });
      await expect(new TurnToolExecutionAuthority(tools).execute({
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

  it('saves a TurnTrace with tool events from the journal when a trace store is configured (#722)', async () => {
    const fixture = await createFixture();
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ turn }) {
      yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      // Tool runtimes write tool events straight to the journal, not the stream.
      await turn.ports.journal.append({ type: 'tool_call', toolName: 'lookup', args: { q: 'x' }, toolUseId: 'c1' });
      await turn.ports.journal.append({ type: 'tool_failed', toolName: 'lookup', toolUseId: 'c1', error: 'boom', durationMs: 2 });
      yield terminalEvent();
    }));
    const saved: import('../../src/trace/turn-trace.js').TurnTrace[] = [];
    const runtime = new AgentRuntime({
      coordinator: new AgentTurnCoordinator(),
      turnTraceStore: {
        save: async (trace) => { saved.push(trace); },
        list: async () => saved,
        latest: async () => saved.at(-1),
        find: async () => undefined,
      },
    });
    runtime.attach(store);

    await runtime.execute(fixture.child, {
      identity: { traceId: 'trace-t', turnId: 'turn-t' },
      origin: { kind: 'http', sessionId: 'http-t' },
      intent: { kind: 'new' },
      principal: { subjectId: 'user-1', roles: ['user'] },
      input: { text: 'hello' },
      session: { key: 'http:http-t' },
      policy: { permissions: ['user'], unattended: false },
      signal: new AbortController().signal,
      ports: {},
    }, selection([]));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      turn_id: 'turn-t',
      session_key: 'http:http-t',
      principal: { subject_id: 'user-1' },
      usage: { total_tokens: 15 },
      termination: { status: 'completed' },
    });
    expect(saved[0]!.tool_calls).toEqual([expect.objectContaining({ tool_name: 'lookup', status: 'failed', error: 'boom' })]);
    await fixture.mcp.stop();
    await store.close();
  });

  it('tightens turns started by ordinary group members (#719) and leaves master turns alone', async () => {
    const fixture = await createFixture();
    const seen: import('../../src/turn/turn-ingress.js').TurnIngress[] = [];
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* ({ turn }) {
      seen.push(turn);
      yield terminalEvent();
    }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    const request = (roles: string[], turnId: string) => ({
      identity: { traceId: `trace-${turnId}`, turnId },
      origin: { kind: 'im' as const, platform: 'icqq', endpoint: 'bot', scope: 'group' as const, sceneId: 'g1', messageId: turnId },
      principal: { subjectId: `user-${turnId}`, roles },
      intent: { kind: 'new' as const },
      input: { text: 'run ls' },
      session: { key: `im:icqq:bot:group:g1:${turnId}` },
      policy: {
        permissions: roles,
        unattended: false,
        shell: { security: 'allowlist' as const, execPreset: 'development' as const, approvalMode: 'auto' as const, isolation: 'required' as const },
        filesystem: { workspaceRoot: '/ws', workingDirectory: '/ws', access: 'workspace-write' as const },
      },
      signal: new AbortController().signal,
      ports: {},
    });

    await runtime.execute(fixture.child, request(['user'], 'member'), selection());
    await runtime.execute(fixture.child, request(['user', 'master'], 'owner'), selection());

    expect(seen[0]?.policy.shell).toBeUndefined();
    expect(seen[0]?.policy.filesystem?.access).toBe('read-only');
    expect(seen[1]?.policy.shell).toBeDefined();
    expect(seen[1]?.policy.filesystem?.access).toBe('workspace-write');
    await fixture.mcp.stop();
    await store.close();
  });

  it('routes Alice and Bob through runtime ingress, control arbitration, persistence, and journals', async () => {
    const fixture = await createFixture();
    let release!: () => void;
    let activeStarted!: () => void;
    const started = new Promise<void>((resolve) => { activeStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const llm = wireMockLlmApi({ name: 'shared-session', models: ['model'] });
    const agent = new ZhinAgent(llm.provider, {
      outputSchema: false,
      maxIterations: 5,
      toolExecution: 'sequential',
      deferredTools: { maxLoadedPerSession: 8, alwaysLoadedTools: ['child__lookup'] },
    }, undefined, llm.runtime);
    agent.activeBinding = {
      name: 'zhin', providerAlias: 'shared-session', model: 'model', mcpServers: [],
    };
    agent.markMemoryPersistenceReady();
    const host = asPrivate(agent);
    llm.respondWith(async (modelContext) => {
      const toolResults = modelContext.messages.filter((message) => message.role === 'toolResult');
      const hasBob = modelContext.messages.some((message) => (
        message.role === 'user' && 'actor' in message && message.actor?.subjectId === 'bob-id'
      ));
      if (toolResults.length === 0) {
        activeStarted();
        await gate;
        return assistantToolCallReply([{
          id: 'call-alice', name: 'child__lookup', arguments: { value: 'alice' },
        }]);
      }
      if (hasBob && toolResults.length === 1) {
        return assistantToolCallReply([{
          id: 'call-bob', name: 'child__lookup', arguments: { value: 'bob' },
        }]);
      }
      return assistantTextReply('done');
    });
    const engine = createFullAgentTurnEngine({
      host,
      core: new AgentCore(DEFAULT_AGENT_CORE_CONFIG, createDefaultAgentCoreDeps()),
      sessionSystem: host.sessionSystem,
      contextSystem: host.contextSystem,
    });
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, (context) => engine.run(context)));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    const request = (
      subjectId: string,
      displayName: string,
      text: string,
      turnId: string,
      intent: import('../../src/turn/turn-ingress.js').TurnIntent,
    ) => ({
      identity: { traceId: `trace-${turnId}`, turnId },
      origin: {
        kind: 'im' as const,
        platform: 'sandbox',
        endpoint: 'main',
        scope: 'group' as const,
        sceneId: 'team',
        messageId: `message-${turnId}`,
      },
      principal: { subjectId, displayName, roles: ['user'] },
      intent,
      input: { text },
      session: { key: 'im:sandbox:main:group:team' },
      policy: { permissions: ['user'], unattended: false },
      signal: new AbortController().signal,
      ports: {},
    });
    const sharedSelection = {
      binding: {
        name: 'zhin', providerAlias: 'shared-session', model: 'model', mcpServers: [],
      },
      mcpServers: [],
    };

    const alice = runtime.execute(fixture.child, request(
      'alice-id', 'Alice', '先不要改数据库', 'turn-alice', { kind: 'new' },
    ), sharedSelection);
    await Promise.race([
      started,
      alice.then((outcome) => {
        throw new Error(`Alice turn completed before reaching the model: ${JSON.stringify(outcome)}`);
      }),
    ]);
    const bob = runtime.execute(fixture.child, request(
      'bob-id', 'Bob', '记得不能使用 Kubernetes', 'turn-bob', {
        kind: 'steer', targetTurnId: 'turn-alice', authorizedBy: 'product_policy',
      },
    ), sharedSelection);
    await bob;
    release();
    await alice;
    expect(llm.calls[0]?.context.systemPrompt).toContain('Prefer repository-local conventions.');

    const session = await host.agentSessionStore.findActive('im:sandbox:main:group:team');
    expect(session).toBeDefined();
    const restored = await host.contextRepository.loadContext(session!.session_id);
    expect(restored.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', actor: expect.objectContaining({ subjectId: 'alice-id', displayName: 'Alice' }) }),
      expect.objectContaining({ role: 'user', actor: expect.objectContaining({ subjectId: 'bob-id', displayName: 'Bob' }) }),
    ]));
    llm.respondText('Alice 要求先不要改数据库；Bob 补充不能使用 Kubernetes。');
    const compacted = await compactAgentMessages({
      transport: llm.runtime,
      model: llm.runtime.model('shared-session', 'model'),
      messages: restored.messages,
      keepRecentTokens: 1,
      minKeepCount: 1,
    });
    const summaryPrompt = llm.calls.at(-1)?.context.messages
      .filter((message) => message.role === 'user')
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => block.type === 'text' ? block.text : '')
      .join('\n');
    expect(summaryPrompt).toContain('[User:Alice id=alice-id');
    expect(summaryPrompt).toContain('[User:Bob id=bob-id');
    expect(compacted.summary).toContain('Alice');
    expect(compacted.summary).toContain('Bob');
    const bobToolEvent = fixture.journal.events.find((event) => event.data?.callId === 'call-bob');
    expect(bobToolEvent)
      .toMatchObject({
        run: { turnId: 'turn-alice' },
        data: {
          principal: { subjectId: 'alice-id' },
          causedBy: {
            principal: { subjectId: 'bob-id' },
            turn: { turnId: 'turn-bob', intent: 'steer', targetTurnId: 'turn-alice' },
          },
        },
      });
    expect(fixture.journal.events.find((event) => (
      event.run.turnId === 'turn-bob' && event.terminal === 'completed'
    )))
      .toMatchObject({
        terminal: 'completed',
        data: {
          principal: { subjectId: 'bob-id' },
          control: { intent: 'steer', targetTurnId: 'turn-alice' },
        },
      });
    await fixture.mcp.stop();
    await store.close();
    agent.dispose();
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
    const hiddenCapabilities = await ingress.read(hidden.snapshot, hidden.child);
    expect(hiddenCapabilities.tools.map((tool) => tool.name)).toEqual(['child__lookup']);
    expect(hiddenCapabilities.tools[0]?.hidden).toBe(true);
    await hidden.mcp.stop();
  });

  it('projects child Skills to the root Agent and applies the canonical access predicate', async () => {
    const fixture = await createFixture({
      skillMarkdown: `---
platforms: [qq]
scopes: [group]
permissions: [role(trusted)]
---
# Research`,
    });
    const ingress = new CapabilityIngress();

    expect((await ingress.read(
      fixture.snapshot,
      rootPluginId(),
      () => true,
      accessTurn('qq'),
    )).skills.map((skill) => skill.qualifiedName)).toEqual(['child__research']);
    expect((await ingress.read(
      fixture.snapshot,
      rootPluginId(),
      () => true,
      accessTurn('telegram'),
    )).skills).toEqual([]);
    await fixture.mcp.stop();
  });

  it('projects an Agent-private Skill only when that Agent is selected', async () => {
    const fixture = await createFixture({ privateSkillAgent: 'planner' });
    const ingress = new CapabilityIngress();

    expect((await ingress.read(fixture.snapshot, rootPluginId())).skills).toEqual([]);
    expect((await ingress.read(
      fixture.snapshot,
      rootPluginId(),
      () => true,
      undefined,
      'planner',
    )).skills).toMatchObject([{ name: 'research', agentName: 'planner' }]);
    await fixture.mcp.stop();
  });

  it('publishes platform prompt sections only to matching IM turns', async () => {
    const fixture = await createFixture({ promptPlatforms: ['github'], promptScopes: ['group'] });
    const ingress = new CapabilityIngress();

    expect((await ingress.read(
      fixture.snapshot,
      fixture.child,
      () => true,
      accessTurn('github'),
    )).promptSections.map((section) => section.title)).toEqual(['Project rules']);
    expect((await ingress.read(
      fixture.snapshot,
      fixture.child,
      () => true,
      accessTurn('icqq'),
    )).promptSections).toEqual([]);

    for (const scope of ['private', 'channel'] as const) {
      expect((await ingress.read(fixture.snapshot, fixture.child, () => true,
        accessTurn('github', ['trusted'], scope))).promptSections).toEqual([]);
    }
    expect((await ingress.read(fixture.snapshot, fixture.child)).promptSections).toEqual([]);

    await fixture.mcp.stop();
  });

  it('filters Agent packages with the canonical platform and permission predicate', async () => {
    const fixture = await createFixture({ platforms: ['github'], permissions: ['role(admin)'] });
    const ingress = new CapabilityIngress();

    expect((await ingress.read(fixture.snapshot, rootPluginId(), () => true, accessTurn('github')))
      .agents).toHaveLength(0);
    expect((await ingress.read(fixture.snapshot, rootPluginId(), () => true, accessTurn('github', ['admin'])))
      .agents.map((agent) => agent.name)).toEqual(['planner']);
    expect((await ingress.read(fixture.snapshot, rootPluginId(), () => true, accessTurn('icqq', ['admin'])))
      .agents).toHaveLength(0);

    await fixture.mcp.stop();
  });
});

async function createFixture(access: {
  readonly localAssets?: LocalImageAssetStore;
  readonly mcpResult?: unknown;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  readonly requiresApproval?: 'never' | 'on-risk' | 'once' | 'always';
  readonly tags?: readonly string[];
  readonly keywords?: readonly string[];
  readonly promptPlatforms?: readonly string[];
  readonly promptScopes?: readonly ('private' | 'group' | 'channel')[];
  readonly skillMarkdown?: string;
  readonly privateSkillAgent?: string;
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
      requiresApproval: access.requiresApproval ?? 'never',
      execute(input) { return `old:${input.value}`; },
    }),
  });
  const skill = createCapabilitySlot({
    owner: child,
    feature: skillFeatureId,
    localName: access.privateSkillAgent ? `agent/${access.privateSkillAgent}/research` : 'research',
    source: '/skills/research/SKILL.md',
    definition: parseSkillMarkdown(access.skillMarkdown ?? '# Research', validation(
      child,
      skillFeatureId,
      access.privateSkillAgent ? `agent/${access.privateSkillAgent}/research` : 'research',
      '/skills/research/SKILL.md',
    )),
  });
  const agent = createCapabilitySlot({
    owner: root,
    feature: agentFeatureId,
    localName: 'planner',
    source: '/agents/planner/agent.json',
    definition: parseAgentPackage({
      manifest: {
        name: 'Planner', version: '1.0.0', description: 'Planner',
        trigger_rules: { file_patterns: [], keywords: ['plan'] },
        entry_points: ['system.md', 'boundaries.md', 'conventions.md'],
        platforms: access.platforms,
        scopes: access.scopes,
        permissions: access.permissions,
      },
      files: {
        'system.md': '# Planner',
        'boundaries.md': '# Boundaries\n\nStay in scope.',
        'conventions.md': '# Conventions\n\nFollow AGENTS.md.',
      },
      workflows: [], knowledge: [],
    }, validation(
      root,
      agentFeatureId,
      'planner',
      '/agents/planner/agent.json',
    )),
  });
  const mcpSlot = createCapabilitySlot({
    owner: child,
    feature: mcpFeatureId,
    localName: 'memory',
    source: '/mcps/memory/index.ts',
    definition: defineMcp({
      create: () => ({
        listTools: () => [{ name: 'search' }],
        callTool: (_name, input) => access.mcpResult ?? input,
      }),
    }),
  });
  const promptSection = createCapabilitySlot({
    owner: root,
    feature: promptSectionFeatureId,
    localName: 'project-rules',
    source: '/prompt-sections/project-rules.ts',
    definition: defineAgentPromptSection({
      title: 'Project rules',
      content: 'Prefer repository-local conventions.',
      platforms: access.promptPlatforms,
      scopes: access.promptScopes,
    }),
  });
  const native = access.localAssets && createNativeLocalAssetsToolFeature(access.localAssets);
  const localTool = native && createCapabilitySlot({ owner: root, feature: toolFeatureId,
    localName: native.name, source: '/builtin/get_local_assets', definition: native.definition });
  const slots: readonly CapabilitySlot[] = [tool, skill, agent, mcpSlot, promptSection, ...(localTool ? [localTool] : [])];
  const journal = memoryJournalStore();
  const base = baseState(slots, journal);
  if (access.localAssets) (base.resources.get(root) as Map<string, unknown>).set(localImageAssetsToken.id, access.localAssets);
  const view = createSnapshotView(1, base);
  const mcp = await McpIndex.create([mcpSlot], view, new AbortController().signal);
  await mcp.start(new AbortController().signal);
  const snapshot = createSnapshotView(1, {
    ...base,
    projections: new Map([
      [toolFeatureId, new ToolIndex([tool, ...(localTool ? [localTool] : [])], view)],
      [skillFeatureId, new SkillIndex([skill], view)],
      [agentFeatureId, new AgentIndex([agent], view)],
      [mcpFeatureId, mcp],
      [promptSectionFeatureId, new PromptSectionIndex([promptSection], view)],
    ]),
  });
  return { snapshot, child, mcp, journal };
}

function accessTurn(platform: string, roles: readonly string[] = ['trusted'], scope: 'private' | 'group' | 'channel' = 'group') {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform, endpoint: 'bot', scope, sceneId: '100' },
    principal: { subjectId: 'trusted-user', roles },
    input: { text: 'lookup' },
    session: { key: `im:${platform}:bot:group:100` },
    policy: { permissions: roles, unattended: false },
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
      [permissionHostToken.id, new PermissionHost()],
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

describe('automatic usage logs (#957)', () => {
  it.each(['private', 'group', 'channel'] as const)('uses the canonical %s scene in logs', async scope => {
    const fixture = await createFixture();
    const info = vi.spyOn(getLogger('ai.usage'), 'info').mockImplementation(() => undefined);
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* () { yield terminalEvent(); }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() }); runtime.attach(store);
    try {
      await runtime.execute(fixture.child, { ...externalRequest(scope),
        origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope, sceneId: 'scene' } }, selection([]));
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]![0])).toContain(`scene: qq/${scope}`);
    } finally { info.mockRestore(); await fixture.mcp.stop(); await store.close(); }
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('logs one %s summary without requiring a trace archive', async status => {
    const fixture = await createFixture();
    const logger = getLogger('ai.usage');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* () {
      yield { type: 'usage', provider: 'provider', model: 'model', durationMs: 20, stopReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, cacheReadTokens: 60, cacheWriteTokens: 0 } };
      if (status === 'failed') throw new Error('PRIVATE-ERROR-BODY');
      if (status === 'cancelled') yield { type: 'turn_cancelled', code: 'cancelled', reason: 'PRIVATE-REASON' };
      else yield terminalEvent();
    }));
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    try {
      await runtime.execute(fixture.child, { ...externalRequest('usage'), input: { text: 'PRIVATE-USER-BODY' } }, selection([]));
      expect(info).toHaveBeenCalledTimes(1);
      const line = String(info.mock.calls[0]![0]);
      expect(line).toContain(`status: ${status}`);
      expect(line).toContain('input: 100');
      expect(line).toContain('cache_read: 60');
      expect(line).toContain('cache_write: 0');
      expect(line).toContain('calls: 1');
      expect(line).toContain('model: provider/model');
      expect(line).not.toMatch(/PRIVATE|\n/);
    } finally { info.mockRestore(); debug.mockRestore(); await fixture.mcp.stop(); await store.close(); }
  });

  it('keeps execution successful and saves its trace when a log transport throws', async () => {
    const fixture = await createFixture();
    const info = vi.spyOn(getLogger('ai.usage'), 'info').mockImplementation(() => { throw new Error('transport down'); });
    const store = new SnapshotStore(stateWithEngine(fixture.snapshot, async function* () { yield terminalEvent(); }));
    const save = vi.fn(async () => undefined);
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator(), turnTraceStore: {
      save, list: async () => [], latest: async () => undefined, find: async () => undefined,
    } }); runtime.attach(store);
    try {
      expect((await runtime.execute(fixture.child, externalRequest('log-fail'), selection([]))).status).toBe('completed');
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]).toEqual([expect.objectContaining({ termination: { status: 'completed' } })]);
    }
    finally { info.mockRestore(); await fixture.mcp.stop(); await store.close(); }
  });
});


describe('structured usage persistence', () => {
  it.each([false, true])('records usage with INFO disabled; store failure=%s never changes outcome', async failing => {
    const fixture = await createFixture();
    const logger = getLogger('ai.usage');
    const enabled = vi.spyOn(logger, 'isLevelEnabled').mockReturnValue(false);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const save = vi.fn(async (_record: unknown) => { if (failing) throw new Error('PRIVATE DB FAILURE'); });
    const state = stateWithEngine(fixture.snapshot, async function* () {
      yield { type: 'usage', provider: 'p', model: 'm', usage: { promptTokens: 9, completionTokens: 1, totalTokens: 10 } };
      yield terminalEvent();
    });
    const root = new Map(state.resources.get(state.root));
    root.set(agentUsageStoreToken.id, { save });
    const store = new SnapshotStore({ ...state, resources: new Map(state.resources).set(state.root, root) });
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() }); runtime.attach(store);
    try {
      expect((await runtime.execute(fixture.child, { ...externalRequest('persist'), input: { text: 'PRIVATE CHAT BODY' } }, selection([]))).status).toBe('completed');
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]![0]).toMatchObject({ turn: { status: 'completed', call_count: 1 }, calls: [{ input_tokens: 9, output_tokens: 1 }] });
      expect(JSON.stringify(save.mock.calls)).not.toContain('PRIVATE');
      expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
      expect(error).toHaveBeenCalledTimes(failing ? 1 : 0);
    } finally { enabled.mockRestore(); error.mockRestore(); await fixture.mcp.stop(); await store.close(); }
  });
});
