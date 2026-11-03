import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiHttpTransport } from '@zhin.js/ai';
import { ZhinAgent, aiCompletionToken, type AgentRuntime } from '@zhin.js/agent/runtime';
import { legacyModelPresetId, type ModelRuntimeService, type ModelRuntimeConfig } from '@zhin.js/agent/model-runtime';
import { DisposeStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { ImRuntime } from '@zhin.js/core/runtime';
import { AgentRuntimeFoundation } from '../../../src/plugin-runtime/agent/runtime-foundation.js';
import { publishAgentToolFeatures } from '../../../src/plugin-runtime/agent/tool-feature-publisher.js';
import { createModelConfigurationAccess } from '../../../src/plugin-runtime/personal-models/configuration.js';
import { AgentTurnIngressRoute } from '../../../src/plugin-runtime/agent/turn/ingress-route.js';

const subagentOrigin = { message: { conversation: { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'private', id: 'user' },
  endpointId: 'account', sender: { id: 'user' }, content: 'one subtask' } };

function config(next = false): ModelRuntimeConfig {
  const provider = { sdk: 'openai-compatible' as const, apiKey: next ? 'synthetic-next-key' : 'synthetic-old-key',
    baseUrl: next ? 'https://next.invalid/v1' : 'https://old.invalid/v1', models: ['old', 'next'],
    imageGeneration: { defaultModel: 'image-default', promptSuffix: next ? 'next-style' : 'old-style' } };
  return { providers: { main: provider, ...(next ? { added: provider } : {}) },
    agents: { zhin: { provider: 'main', model: next ? 'next' : 'old' } } };
}
async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-model-consumer-'));
  const requests: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
  let hold: (() => Promise<void>) | undefined;
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, key: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    const held = hold; hold = undefined; await held?.();
    if (url.includes('/images/')) return new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] }),
      { headers: { 'content-type': 'application/json' } });
    const answer = String(init?.body).includes('quietly reading')
      ? '{"engage":false,"confidence":0.9,"reason":"not addressed"}' : '{"decision":"approve","reason":"bounded"}';
    const base = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic' };
    if (!requests.at(-1)!.body.stream) return new Response(JSON.stringify({ ...base, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }),
    { headers: { 'content-type': 'application/json' } });
    return new Response(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant',
      content: answer }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', network);
  const lifecycle = new DisposeStack();
  const resources = new Scope(rootPluginId());
  let current: ModelRuntimeService;
  const configuration = createModelConfigurationAccess({ runtime: () => current });
  const subagents = vi.spyOn(ZhinAgent.prototype, 'initSubagentSystem');
  const foundation = await AgentRuntimeFoundation.create({ config: config(), modelConfiguration: configuration,
    modelRuntime: { hostOwnerId: 'host/consumer', rootId: projectRoot,
      personalCatalogSnapshot: async () => { throw new Error('Host-only consumer tried to read a personal catalog'); },
      runtimePolicySnapshot: async () => { throw new Error('Host-only consumer tried to borrow a chat override'); },
      hostTransportFactory: () => new AiHttpTransport({ fetch: network }),
      acquireDeploymentSelection: (selection, signal) => configuration.acquireHostModel(selection, signal) },
    projectRoot, im: new ImRuntime(), processRuntime: {} as AgentRuntime,
    resources, lifecycle });
  current = foundation.service.getModelRuntime();
  const factory = subagents.mock.calls.at(-1)![0];
  const definitions = new Map<string, { execute(input: Record<string, unknown>, context: unknown): Promise<unknown> }>();
  publishAgentToolFeatures({ service: foundation.service, projectRoot, modelConfiguration: configuration,
    addFeature: (_feature, name, definition) => definitions.set(name, definition as never), mcpServers: [], runtimeTools: [] });
  return { foundation, requests, configuration, definitions, subagentTools: factory, completion: resources.use(aiCompletionToken),
    holdNext: () => {
      let started!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const done = new Promise<void>(resolve => { release = resolve; });
      hold = async () => { started(); await done; };
      return { entered, release };
    },
    publish: () => { const updated = current.prepareConfiguration(config(true));
      if (updated.kind !== 'ready') throw new Error('expected hot update'); current = updated.runtime; },
    close: async () => { await lifecycle.dispose(); await rm(projectRoot, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.restoreAllMocks(); } };
}

it('uses the newly published deployment binding for the actual approval reviewer, independently of chat selection', async () => {
  const f = await fixture();
  const input = { request: { requestId: 'request', toolName: 'bounded', question: 'one bounded operation' }, priorDecisions: [], signal: new AbortController().signal };
  try {
    await f.foundation.approvalJudgment.judge(input);
    f.publish();
    await f.foundation.approvalJudgment.judge(input);
    expect(f.requests.map(({ url, key, body }) => ({ url, key, model: body.model }))).toEqual([
      { url: 'https://old.invalid/v1/chat/completions', key: 'Bearer synthetic-old-key', model: 'old' },
      { url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', model: 'next' },
    ]);
  } finally { await f.close(); }
});

it.each(['main', 'subagent'] as const)('uses current image providers/defaults and preserves explicit image model in the %s native suite', async path => {
  const f = await fixture();
  try {
    f.publish();
    const input = { provider_alias: 'added', prompt: 'a tree', model: 'explicit-image-model' };
    const context = { signal: new AbortController().signal };
    if (path === 'main') await f.definitions.get('generate_image')!.execute(input, context);
    else await f.subagentTools().find(tool => tool.name === 'generate_image')!.execute(input, undefined, context);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ url: 'https://next.invalid/v1/images/generations', key: 'Bearer synthetic-next-key',
      body: { model: 'explicit-image-model', prompt: 'a tree next-style' } });
  } finally { await f.close(); }
});

it.each([undefined, 'main/old'])('uses current deployment resources in the ingress ambient judge (%s)', async judge => {
  const f = await fixture();
  vi.spyOn(f.foundation.service, 'getTriggerConfig').mockReturnValue({ enabled: true,
    ambient: { conversations: ['*'], quietMs: 0, cooldownMs: 0, judgeIntervalMs: 0, ...(judge ? { judge } : {}) } });
  const route = new AgentTurnIngressRoute({ projectRoot: '/host', modelConfiguration: f.configuration,
    agent: f.foundation, runtime: { executeLeased: vi.fn() } as never,
    ingress: { read: async () => ({ agents: [], tools: [], skills: [] }) } as never,
    im: { readConversationContext: async () => ({ blocks: [{ text: 'One unanswered question' }], cursor: 1 }) } as never });
  const conversation = { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'group', id: 'group' };
  const message = { conversation, endpointId: 'account', sender: { id: 'user' }, content: 'a question',
    message: { conversation, id: 'message' } };
  const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() };
  try {
    await route.route(message as never, { value: snapshot, active: true } as never, rootPluginId(), 1);
    f.publish();
    await route.route(message as never, { value: snapshot, active: true } as never, rootPluginId(), 2);
    expect(f.requests.map(({ url, key, body }) => ({ url, key, model: body.model }))).toEqual([
      { url: 'https://old.invalid/v1/chat/completions', key: 'Bearer synthetic-old-key', model: 'old' },
      { url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', model: judge ? 'old' : 'next' },
    ]);
  } finally { route.dispose(); await f.close(); }
});

it('uses the current connection for a real Host subagent while retaining its admitted binding authority', async () => {
  const f = await fixture();
  const binding = f.foundation.service.getBindingRegistry().requireZhinBinding();
  const origin = { message: { conversation: { endpoint: { id: 'account', adapter: 'fixture' }, kind: 'private', id: 'user' },
    endpointId: 'account', sender: { id: 'user' }, content: 'one subtask' } };
  try {
    await f.foundation.agent.getSubagentSystem()!.spawnSync({ task: 'one bounded subtask', binding, origin: origin as never, contextMode: 'fresh' });
    f.publish();
    await f.foundation.agent.getSubagentSystem()!.spawnSync({ task: 'another bounded subtask', binding, origin: origin as never, contextMode: 'fresh' });
    expect(f.requests.map(({ url, key, body }) => ({ url, key, model: body.model }))).toEqual([
      { url: 'https://old.invalid/v1/chat/completions', key: 'Bearer synthetic-old-key', model: 'old' },
      { url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', model: 'next' },
    ]);
  } finally { await f.close(); }
});

it.each(['approval', 'subagent'] as const)('keeps an already admitted %s on its old connection while a new operation uses the next connection', async path => {
  const f = await fixture();
  const hold = f.holdNext();
  const run = () => path === 'approval'
    ? f.foundation.approvalJudgment.judge({ request: { requestId: 'bounded', toolName: 'bounded', question: 'one bounded operation' },
      priorDecisions: [], signal: new AbortController().signal })
    : f.foundation.agent.getSubagentSystem()!.spawnSync({ task: 'bounded subtask', contextMode: 'fresh', origin: subagentOrigin as never,
      binding: f.foundation.service.getBindingRegistry().requireZhinBinding() });
  const pending = run();
  try {
    await Promise.race([hold.entered, pending.then(() => { throw new Error('operation ended before entering the fake transport'); })]);
    f.publish();
    await run();
    expect(f.requests.map(request => [request.url, request.key, request.body.model])).toEqual([
      ['https://old.invalid/v1/chat/completions', 'Bearer synthetic-old-key', 'old'],
      ['https://next.invalid/v1/chat/completions', 'Bearer synthetic-next-key', 'next'],
    ]);
  } finally { hold.release(); await pending; await f.close(); }
});

it('preserves manifest provider and explicit model semantics for a new subagent after a provider update', async () => {
  const f = await fixture();
  f.foundation.agent.getSubagentSystem()!.configureRouting({ resolveAgentMeta: async () => ({ provider: 'added', model: 'old',
    systemPrompt: 'One bounded task', name: 'manifest', toolNames: [], filePath: '/synthetic/agent.json' }) as never });
  try {
    f.publish();
    const result = await f.foundation.agent.getSubagentSystem()!.spawnSync({ task: 'one bounded task', agent: 'manifest',
      contextMode: 'fresh', origin: subagentOrigin as never });
    expect(result).not.toContain('Error:');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', body: { model: 'old' } });
  } finally { await f.close(); }
});

it.each(['preset', 'explicit-model'] as const)('keeps a ServiceAgent %s selection while new runs acquire the current connection version', async kind => {
  const f = await fixture();
  const agent = f.foundation.service.createAgent(kind === 'preset' ? { preset: legacyModelPresetId('main', 'old') }
    : { provider: 'main', model: 'old' });
  try {
    await agent.run('one bounded task');
    f.publish();
    await agent.run('another bounded task');
    expect(f.requests.map(({ url, key, body }) => ({ url, key, model: body.model }))).toEqual([
      { url: 'https://old.invalid/v1/chat/completions', key: 'Bearer synthetic-old-key', model: 'old' },
      { url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', model: 'old' },
    ]);
  } finally { await agent.dispose(); await f.close(); }
});

it.each([undefined, 'explicit-not-in-chat-models'])('uses current Host resources for the public completion port with explicit binding/model (%s)', async model => {
  const f = await fixture();
  try {
    await f.completion.completeText({ purpose: 'classification', prompt: 'one bounded task', agent: 'zhin', model });
    f.publish();
    await f.completion.completeText({ purpose: 'classification', prompt: 'another bounded task', agent: 'zhin', model });
    expect(f.requests.map(({ url, key, body }) => ({ url, key, model: body.model }))).toEqual([
      { url: 'https://old.invalid/v1/chat/completions', key: 'Bearer synthetic-old-key', model: model ?? 'old' },
      { url: 'https://next.invalid/v1/chat/completions', key: 'Bearer synthetic-next-key', model: model ?? 'next' },
    ]);
  } finally { await f.close(); }
});
