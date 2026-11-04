import { Scope, DisposeStack, rootPluginId } from '@zhin.js/plugin-runtime';
import { ImRuntime } from '@zhin.js/core/runtime';
import { ZhinAgent, aiCompletionToken, type AgentRuntime } from '@zhin.js/agent/runtime';
import { SubagentRuntime, type SubagentSyncResult, type TurnRequest } from '@zhin.js/agent';
import type { ApprovalJudgment } from '@zhin.js/agent/session';
import { createUserMessage } from '@zhin.js/ai';
import { runWithAgentTurnConfiguration } from '@zhin.js/agent/turn';
import { personalSessionIdentity, personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import { AgentRuntimeFoundation } from '../../../src/plugin-runtime/agent/runtime-foundation.js';
import { publishAgentToolFeatures } from '../../../src/plugin-runtime/agent/tool-feature-publisher.js';
import { AgentTurnIngressRoute } from '../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { configurationFixture } from '../inference/configuration-fixture.js';

const subagentOrigin = { message: { conversation: { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'private', id: 'user' },
  endpointId: 'account', sender: { id: 'user' }, content: 'one subtask' } };

/** Actual Host graph, credentials, SDK and consumers; file configuration is a separate authority. */
async function fixture() {
  const f = await configurationFixture();
  let hold: (() => Promise<void>) | undefined;
  f.setTransport(async request => {
    const held = hold; hold = undefined; await held?.();
    const body: { model: string } = await request.clone().json();
    if (request.url.includes('/images/')) return Response.json({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] });
    const content = (await request.clone().text()).includes('quietly reading')
      ? '{"engage":false,"confidence":0.9,"reason":"not addressed"}'
      : '{"decision":"approve","reason":"bounded"}';
    return Response.json({ id: 'synthetic', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  });
  const lifecycle = new DisposeStack(), resources = new Scope(rootPluginId());
  const subagents = vi.spyOn(ZhinAgent.prototype, 'initSubagentSystem');
  const foundation = await AgentRuntimeFoundation.create({
    config: { sessions: { useDatabase: false }, agents: { zhin: {}, reviewer: {}, manifest: {} } },
    modelRuntime: f.host.modelRuntimeOptions(),
    acquireDeploymentModels: input => f.host.acquireDeploymentModels(input),
    projectRoot: f.directory, im: new ImRuntime(), processRuntime: {} as AgentRuntime, resources, lifecycle,
  });
  const subagentTools = subagents.mock.calls.at(-1)![0];
  const definitions = new Map<string, { execute(input: Record<string, unknown>, context: unknown): Promise<unknown> }>();
  publishAgentToolFeatures({ service: foundation.service, projectRoot: f.directory,
    addFeature: (_feature, name, definition) => definitions.set(name, definition as never), mcpServers: [], runtimeTools: [] });
  return { ...f, foundation, subagentTools, definitions, completion: resources.use(aiCompletionToken),
    withModels: <T>(operation: () => Promise<T>) => f.host.withDeploymentModels({ service: foundation.service }, operation),
    holdNext() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const completed = new Promise<void>(resolve => { release = resolve; });
      hold = async () => { entered(); await completed; };
      return { entered: started, release };
    },
    async close() { await lifecycle.dispose(); await f.close(); vi.restoreAllMocks(); },
  };
}

async function observed(f: Awaited<ReturnType<typeof fixture>>) {
  return Promise.all(f.requests.map(async request => ({ url: request.url,
    key: request.headers.get('authorization'), body: await request.clone().json() as { model: string } })));
}

const oldRequest = { url: 'https://old.example/v1/chat/completions', key: 'Bearer synthetic-old-key', body: { model: 'old' } };
const nextRequest = { url: 'https://next.example/v1/chat/completions', key: 'Bearer synthetic-next-key', body: { model: 'next' } };

it('uses the current Host graph for the actual approval reviewer, independently of personal selection', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const input = { request: { requestId: 'request', toolName: 'bounded', question: 'one bounded operation', signal }, priorDecisions: [], signal };
  try {
    await f.withModels(() => f.foundation.approvalJudgment.judge(input));
    await f.publish();
    await f.withModels(() => f.foundation.approvalJudgment.judge(input));
    expect(await observed(f)).toMatchObject([oldRequest, nextRequest]);
  } finally { await f.close(); }
});

it.each(['main', 'subagent'] as const)('uses the current image purpose in the actual %s native suite', async path => {
  const f = await fixture();
  try {
    await f.publish();
    const input = { prompt: 'a tree' }, context = { signal: new AbortController().signal, sessionId: 'session', toolCallId: 'image-call', toolName: 'generate_image' };
    await f.withModels(async () => {
      if (path === 'main') await f.definitions.get('generate_image')!.execute(input, context);
      else await f.subagentTools().find(tool => tool.name === 'generate_image')!.execute(input, undefined, context);
    });
    expect(await observed(f)).toMatchObject([{ url: 'https://next.example/v1/images/generations', key: 'Bearer synthetic-next-key', body: { model: 'image', prompt: 'a tree' } }]);
    expect(f.requests).toHaveLength(1);
  } finally { await f.close(); }
});

it('selects only an available image Profile instead of an arbitrary provider or native model', async () => {
  const f = await fixture();
  try {
    await f.publish();
    const feature = f.definitions.get('generate_image')!;
    await f.withModels(async () => {
      await expect(feature.execute({ profile_id: 'unavailable', prompt: 'a tree' }, { signal: new AbortController().signal })).rejects.toThrow('unavailable');
      expect(f.requests).toHaveLength(0);
      await feature.execute({ profile_id: 'old-image', prompt: 'a tree' }, { signal: new AbortController().signal });
    });
    expect(await observed(f)).toMatchObject([{ url: 'https://old.example/v1/images/generations', key: 'Bearer synthetic-old-key', body: { model: 'image' } }]);
    expect(f.requests).toHaveLength(1);
  } finally { await f.close(); }
});

it.each([false, true])('uses the independently selected ambient Profile in the actual ingress judge (explicit=%s)', async explicit => {
  const f = await fixture();
  vi.spyOn(f.foundation.service, 'getTriggerConfig').mockReturnValue({ enabled: true,
    ambient: { conversations: ['*'], quietMs: 0, cooldownMs: 0, judgeIntervalMs: 0 } });
  const route = new AgentTurnIngressRoute({ projectRoot: f.directory,
    agent: f.foundation, runtime: { executeLeased: vi.fn() } as never,
    withInferenceScope: (input, operation) => f.host.withInferenceScope(input, operation),
    ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
    im: { readConversationContext: async () => ({ blocks: [{ text: 'One unanswered question' }], cursor: 1 }) } as never });
  const conversation = { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'group', id: 'group' };
  const message = { conversation, endpointId: 'account', sender: { id: 'user' }, content: 'a question', message: { conversation, id: 'message' } };
  const lease = f.runtime.snapshots.acquire();
  try {
    await route.route(message as never, lease, rootPluginId(), 1);
    await f.publish(explicit ? { purposes: { defaults: { chat: 'next', image: 'next-image', ambient: 'old' } } } : undefined);
    await route.route(message as never, lease, rootPluginId(), 2);
    expect(await observed(f)).toMatchObject([oldRequest, explicit ? oldRequest : nextRequest]);
  } finally { lease.release(); route.dispose(); await f.close(); }
});

it('uses each newly admitted Host graph for real subagents and preserves their structured terminal result', async () => {
  const f = await fixture();
  const binding = f.foundation.service.getBindingRegistry().requireZhinBinding();
  const run = () => f.withModels(() => f.foundation.agent.getSubagentSystem()!.spawnSync({
    task: 'one bounded subtask', binding, origin: subagentOrigin as never, contextMode: 'fresh',
  }));
  try {
    await expect(run()).resolves.toMatchObject({ status: 'ok', terminal: { stopReason: 'stop' } });
    await f.publish();
    await expect(run()).resolves.toMatchObject({ status: 'ok', terminal: { stopReason: 'stop' } });
    expect(await observed(f)).toMatchObject([oldRequest, nextRequest]);
  } finally { await f.close(); }
});

it.each(['approval', 'subagent'] as const)('keeps an admitted %s fixed while graph publication and the next operation complete', async path => {
  const f = await fixture(), hold = f.holdNext(), signal = new AbortController().signal;
  const run = () => f.withModels<ApprovalJudgment | SubagentSyncResult>(() => path === 'approval'
    ? f.foundation.approvalJudgment.judge({ request: { requestId: 'bounded', toolName: 'bounded', question: 'one bounded operation', signal },
      priorDecisions: [], signal })
    : f.foundation.agent.getSubagentSystem()!.spawnSync({ task: 'bounded subtask', contextMode: 'fresh', origin: subagentOrigin as never,
      binding: f.foundation.service.getBindingRegistry().requireZhinBinding() }));
  const pending = run();
  try {
    await Promise.race([hold.entered, pending.then(() => { throw new Error('operation ended before entering the fake transport'); })]);
    await f.publish();
    await run();
    expect(await observed(f)).toMatchObject([oldRequest, nextRequest]);
  } finally { hold.release(); await pending; await f.close(); }
});

it('uses the configured child role Profile without taking model ownership from manifest metadata', async () => {
  const f = await fixture();
  f.foundation.agent.getSubagentSystem()!.configureRouting({ resolveAgentMeta: async () => ({
    provider: 'unavailable', model: 'unavailable', systemPrompt: 'One bounded task', name: 'manifest', toolNames: [], filePath: '/synthetic/agent.json',
  }) as never });
  try {
    await f.publish({ purposes: { defaults: { chat: 'next', image: 'next-image' }, agents: { manifest: 'old' } } });
    await expect(f.withModels(() => f.foundation.agent.getSubagentSystem()!.spawnSync({
      task: 'one bounded task', agent: 'manifest', contextMode: 'fresh', origin: subagentOrigin as never,
    }))).resolves.toMatchObject({ status: 'ok' });
    expect(await observed(f)).toMatchObject([oldRequest]);
    expect(f.requests).toHaveLength(1);
  } finally { await f.close(); }
});

it('leaves a ServiceAgent on its explicitly borrowed operation while a newly admitted operation follows the graph', async () => {
  const f = await fixture();
  const old = await f.host.acquireDeploymentModels({ service: f.foundation.service });
  const agent = f.foundation.service.createAgent({ models: old, maxIterations: 1 });
  let next: typeof old | undefined;
  try {
    await agent.run('first bounded task');
    await f.publish();
    await agent.run('same admitted task');
    next = await f.host.acquireDeploymentModels({ service: f.foundation.service });
    await f.foundation.service.runAgent('newly admitted task', { models: next, maxIterations: 1 });
    expect(await observed(f)).toMatchObject([oldRequest, oldRequest, nextRequest]);
  } finally { agent.dispose(); await old.release(); await next?.release(); await f.close(); }
});

it.each([undefined, 'reviewer'])('requires an explicit role Profile and otherwise follows the current default (%s)', async agent => {
  const f = await fixture();
  try {
    const initial = f.completion.completeText({ purpose: 'classification', prompt: 'one bounded task', agent });
    if (agent) {
      await expect(initial).rejects.toMatchObject({ code: 'not-configured' });
      expect(f.requests).toHaveLength(0);
    } else await initial;
    await f.publish({ purposes: { defaults: { chat: 'next', image: 'next-image' }, agents: { reviewer: 'old' } } });
    await f.completion.completeText({ purpose: 'classification', prompt: 'another bounded task', agent });
    expect(await observed(f)).toMatchObject(agent ? [oldRequest] : [oldRequest, nextRequest]);
  } finally { await f.close(); }
});

it('rejects a native model override before scope, secret or transport acquisition', async () => {
  const f = await fixture();
  try {
    await expect(f.completion.completeText({ purpose: 'classification', prompt: 'one bounded task', model: 'not-in-profile' })).rejects.toThrow('configured Profile');
    await f.publish();
    await expect(f.completion.completeText({ purpose: 'classification', prompt: 'another bounded task', model: 'not-in-profile' })).rejects.toThrow('configured Profile');
    expect(f.requests).toHaveLength(0); expect(f.resolveSource).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it.each(['complete', 'cancel'] as const)(
  'retains the personal principal and exact Host lease for a queued child across real config and graph publication (%s)', async outcome => {
    const f = await fixture();
    const views: { delegated: boolean; generation: number; revision: number; owner: string }[] = [];
    const createInference = f.host.createInference.bind(f.host);
    vi.spyOn(f.host, 'createInference').mockImplementation(held => {
      const runtime = createInference(held);
      return { ...runtime,
        openScope: async input => {
          const scope = await runtime.openScope(input);
          views.push({ delegated: false, generation: held.value.generation, revision: scope.graph.revision, owner: scope.context.ownerId });
          return scope;
        },
        openDelegatedScope: async input => {
          const scope = await runtime.openDelegatedScope(input);
          views.push({ delegated: true, generation: held.value.generation, revision: scope.graph.revision, owner: scope.context.ownerId });
          return scope;
        },
      };
    });
    const conversation = { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'private' as const, id: 'user' };
    const address = { rootId: f.host.rootId, platform: 'fixture', endpoint: 'account', subjectId: 'alice', conversation };
    const personal = personalSessionIdentity(address), owner = personalSessionOwnerId(personal.owner);
    const request: TurnRequest = { identity: { traceId: 'trusted-personal', turnId: 'parent' },
      origin: { kind: 'im', platform: 'fixture', endpoint: 'account', scope: 'private', sceneId: 'user', conversation },
      principal: { subjectId: 'alice', roles: ['user'] }, intent: { kind: 'new' }, input: { text: 'one bounded task' },
      session: { key: personal.key, personal: address }, policy: { permissions: ['user'], unattended: false },
      signal: new AbortController().signal, ports: {} };
    const lease = await f.runtime.control(async control => control.retain());
    const parent = await f.foundation.service.getModelRuntime().acquireForTurn({ request,
      binding: f.foundation.service.getBindingRegistry().requireZhinBinding(), lease, snapshots: f.runtime.snapshots });
    let metadataReady!: (value: null) => void;
    const metadata = new Promise<null>(resolve => { metadataReady = resolve; });
    let taskId: string | undefined;
    const manager = new SubagentRuntime({ workspace: f.directory, createTools: () => [], maxIterations: 1,
      resolveAgentMeta: () => metadata, onEvent: event => { if (event.phase === 'start') taskId = event.taskId; } });
    const hold = f.holdNext();
    const pending = runWithAgentTurnConfiguration({ models: parent }, () => manager.spawnSync({ task: 'one bounded child',
      agent: 'zhin', contextMode: 'fresh', origin: { message: { ...subagentOrigin.message, sender: { id: 'alice' } } } as never }));
    try {
      const generation = lease.value.generation;
      expect(parent.context.ownerId).toBe(owner);
      await parent.release(); lease.release();
      await f.runtime.patchConfig([{ op: 'set', path: ['menuKeyword'], value: 'next' }]);
      await f.publish();
      await f.foundation.service.dispose();
      expect(f.runtime.snapshot.generation).toBeGreaterThan(generation);
      expect(f.requests).toHaveLength(0);
      metadataReady(null);
      await Promise.race([hold.entered, pending.then(() => { throw new Error('child ended before its held transport'); })]);
      expect(views.find(view => view.delegated)).toEqual({ delegated: true, generation, revision: 1, owner });
      if (outcome === 'cancel') { expect(taskId).toBeDefined(); expect(manager.cancel(taskId!)).toBe(true); }
      hold.release();
      const result = await pending;
      expect(result.status).toBe(outcome === 'complete' ? 'ok' : 'error');
      if (outcome === 'cancel') expect(f.requests[0].signal.aborted).toBe(true);
      const nextLease = f.runtime.snapshots.acquire();
      const next = await f.service.getModelRuntime().acquireForTurn({ request: { ...request, identity: { ...request.identity, turnId: 'next' } },
        binding: f.service.getBindingRegistry().requireZhinBinding(), lease: nextLease, snapshots: f.runtime.snapshots });
      try {
        expect(next.context.ownerId).toBe(owner); expect(next.graph.revision).toBe(2);
        await next.chat.completion.complete(next.chat.model, { systemPrompt: '', messages: [createUserMessage('next operation')] });
      } finally { await next.release(); nextLease.release(); }
      expect(await observed(f)).toMatchObject([oldRequest, nextRequest]);
      expect(views.at(-1)).toMatchObject({ delegated: false, generation: f.runtime.snapshot.generation, revision: 2, owner });
    } finally {
      metadataReady(null); hold.release(); await pending.catch(() => undefined);
      await parent.release(); lease.release(); await manager.dispose(); await f.close();
    }
  },
);
