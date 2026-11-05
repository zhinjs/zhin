import { Scope, DisposeStack, rootPluginId } from '@zhin.js/plugin-runtime';
import { ImRuntime } from '@zhin.js/core/runtime';
import { aiCompletionToken, type AgentRuntime } from '@zhin.js/agent/runtime';
import type { ApprovalJudgment } from '@zhin.js/agent/session';
import { AgentRuntimeFoundation } from '../../../src/plugin-runtime/agent/runtime-foundation.js';
import { publishAgentToolFeatures } from '../../../src/plugin-runtime/agent/tool-feature-publisher.js';
import { AgentTurnIngressRoute } from '../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { configurationFixture } from '../inference/configuration-fixture.js';

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
  const foundation = await AgentRuntimeFoundation.create({
    config: { sessions: { useDatabase: false }, agents: { zhin: {}, reviewer: {}, manifest: {} } },
    modelRuntime: f.host.modelRuntimeOptions(),
    acquireDeploymentModels: input => f.host.acquireDeploymentModels(input),
    projectRoot: f.directory, im: new ImRuntime(), processRuntime: {} as AgentRuntime, resources, lifecycle,
  });
  const definitions = new Map<string, { execute(input: Record<string, unknown>, context: unknown): Promise<unknown> }>();
  publishAgentToolFeatures({ service: foundation.service, projectRoot: f.directory,
    addFeature: (_feature, name, definition) => definitions.set(name, definition as never), mcpServers: [], runtimeTools: [] });
  return { ...f, foundation, definitions, completion: resources.use(aiCompletionToken),
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

it('uses the current image purpose in the actual native suite', async () => {
  const f = await fixture();
  try {
    await f.publish();
    const input = { prompt: 'a tree' }, context = { signal: new AbortController().signal, sessionId: 'session', toolCallId: 'image-call', toolName: 'generate_image' };
    await f.withModels(async () => { await f.definitions.get('generate_image')!.execute(input, context); });
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

it('keeps an admitted approval fixed while graph publication and the next operation complete', async () => {
  const f = await fixture(), hold = f.holdNext(), signal = new AbortController().signal;
  const run = () => f.withModels<ApprovalJudgment>(() => f.foundation.approvalJudgment.judge({
    request: { requestId: 'bounded', toolName: 'bounded', question: 'one bounded operation', signal }, priorDecisions: [], signal }));
  const pending = run();
  try {
    await Promise.race([hold.entered, pending.then(() => { throw new Error('operation ended before entering the fake transport'); })]);
    await f.publish();
    await run();
    expect(await observed(f)).toMatchObject([oldRequest, nextRequest]);
  } finally { hold.release(); await pending; await f.close(); }
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
