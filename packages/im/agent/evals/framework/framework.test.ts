import { aiOutboundJsonSchema } from '@zhin.js/core';
/**
 * Self-tests for the eval framework: passing runs pass, broken expectations
 * fail with readable messages, and invalid fixtures are rejected up front.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, Context, LlmCompletionPort, Model } from '@zhin.js/ai';
import {
  createFakeClock,
  actorOfSession,
  createLiveModel,
  createScriptedModel,
  defineEvalCase,
  evaluateExpectations,
  formatEvalReport,
  loadEvalCases,
  runEvalCase,
  validateEvalCase,
  type EvalCase,
} from './index.js';
import { evalSenderRoles } from './driver.js';

const RAW = 'RAW-PAYLOAD {"id":42,"secret_field":"do-not-show"}';

const approvalCase = (approval: EvalCase['approval']) => defineEvalCase({
  id: 'approval-gate',
  description: 'An approval-gated tool asks the approval channel first.',
  source: 'framework self-test',
  inbound: { text: '把这条消息转发到运营群', sender: { id: 'owner', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'forward_message', requiresApproval: 'once', result: 'forwarded' }],
  approval,
  script: [
    { toolCalls: [{ name: 'forward_message', args: { target: 'ops' } }] },
    { text: approval === 'approve' ? '已转发。' : '没有获得批准，未转发。' },
  ],
  expect: {},
});

describe('eval framework', () => {
  it('passes a case whose expectations hold and records approvals', async () => {
    const definition = { ...approvalCase('approve'), expect: {
      toolsCalled: ['forward_message'], approvalRequested: ['forward_message'], outboundContains: ['已转发'], modelSteps: 2,
    } };
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('derives principal roles like the Host: only a global owner carries owner trust (ADR 0056)', () => {
    expect(evalSenderRoles({ chatRole: 'owner', chatRoleLevels: { owner: 'global' } })).toEqual(['owner', 'admin', 'trusted']);
    // A lower-level owner, or one without levels (conversation level, as on the Host), counts as admin host-wide.
    expect(evalSenderRoles({ chatRole: 'owner', chatRoleLevels: { owner: 'endpoint' } })).toEqual(['admin', 'trusted']);
    expect(evalSenderRoles({ chatRole: 'owner' })).toEqual(['admin', 'trusted']);
    expect(evalSenderRoles({ chatRole: 'trusted' })).toEqual(['trusted']);
    expect(evalSenderRoles({ roles: ['user'] })).toEqual(['user']);
  });

  it('records a TurnTrace per turn and attaches it to failure reports', async () => {
    const definition = { ...approvalCase('approve'), expect: { outboundContains: ['this text never appears'] } };
    const run = await runEvalCase(definition);
    expect(run.traces).toHaveLength(1);
    const [trace] = run.traces;
    expect(trace).toMatchObject({
      turn_id: 'approval-gate:turn-1',
      principal: { subject_id: 'owner', roles: ['owner', 'admin', 'trusted'] },
      termination: { status: 'completed' },
    });
    expect(trace!.model_calls.length).toBeGreaterThanOrEqual(1);
    // Tool events reach the trace through the journal port even though the
    // engine stream does not carry them (#740).
    expect(trace!.tool_calls).toEqual([expect.objectContaining({ tool_name: 'forward_message', status: 'ok' })]);
    const report = formatEvalReport(definition, run, evaluateExpectations(definition, run));
    expect(report).toContain('turn trace:');
    expect(report).toContain('回合 approval-gate:turn-1');
  });

  it('observes that a denied approval keeps the tool from running', async () => {
    const definition = { ...approvalCase('deny'), expect: {
      toolsNotCalled: ['forward_message'], approvalRequested: true, outboundContains: ['未转发'],
    } };
    const run = await runEvalCase(definition);
    expect(run.attemptedTools).toEqual(['forward_message']);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('reports every broken expectation with a readable message and trace', async () => {
    const definition = defineEvalCase({
      id: 'leaky-reply',
      description: 'The scripted reply pastes the raw tool payload.',
      source: 'framework self-test',
      inbound: { text: 'look it up' },
      tools: [{ name: 'lookup', result: RAW }, { name: 'delete_all' }],
      script: [
        { toolCalls: [{ name: 'lookup' }] },
        { text: `Here you go: ${RAW}` },
        { text: 'never requested' },
      ],
      expect: {
        toolsCalled: ['delete_all'],
        toolsNotCalled: ['lookup'],
        outboundContains: ['summary'],
        outboundNotContains: ['secret_field'],
        noRawToolOutput: true,
        approvalRequested: true,
        termination: 'error',
        modelSteps: 1,
      },
    });
    const run = await runEvalCase(definition);
    const failures = evaluateExpectations(definition, run);
    expect(failures.map((failure) => failure.assertion)).toEqual([
      'toolsCalled', 'toolsNotCalled', 'outboundContains', 'outboundNotContains',
      'noRawToolOutput', 'approvalRequested', 'termination', 'modelSteps', 'script',
    ]);
    const report = formatEvalReport(definition, run, failures);
    expect(report).toContain('eval "leaky-reply" failed');
    expect(report).toContain('expected tool "delete_all" to run; ran [lookup]');
    expect(report).toContain('outbound text echoes raw tool output');
    expect(report).toContain('1 scripted step(s) were never requested');
    expect(report).toContain('called=[lookup]');
  });

  it('fails a case when the harness asks for more steps than the script has', async () => {
    const definition = defineEvalCase({
      id: 'short-script',
      description: 'The script ends while the harness still wants a response.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      tools: [{ name: 'lookup' }],
      script: [{ toolCalls: [{ name: 'lookup' }] }],
      expect: { termination: 'turn_end' },
    });
    const run = await runEvalCase(definition);
    const failures = evaluateExpectations(definition, run);
    expect(run.extraModelRequests).toBeGreaterThan(0);
    expect(failures.map((failure) => failure.message))
      .toContainEqual(expect.stringMatching(/model request\(s\) after the 1-step script ran out/));
  });

  it('flags scripted calls to tools the harness never offered', async () => {
    const definition = defineEvalCase({
      id: 'unoffered-tool',
      description: 'The script calls a tool that is not available to the turn.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      script: [{ toolCalls: [{ name: 'not_registered' }] }, { text: 'done' }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run).map((failure) => failure.message))
      .toContain('scripted call to not_registered (request #1) names a tool the harness did not offer');
  });

  it('supports generic provider faults as script steps', async () => {
    const definition = defineEvalCase({
      id: 'provider-faults',
      description: 'A scripted 429 is a real provider error: the harness retries and the next step answers.',
      source: 'framework self-test',
      inbound: { text: 'hi' },
      script: [{ fault: { kind: 'error', message: 'HTTP 429 rate limited', status: 429 } }, { text: 'recovered' }],
      expect: { outboundContains: ['recovered'], modelSteps: 2 },
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('fails a notOffered call that the harness did offer', async () => {
    const definition = defineEvalCase({
      id: 'offered-after-all',
      description: 'The script claims a tool is withheld, but it is available.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      tools: [{ name: 'lookup' }],
      script: [{ toolCalls: [{ name: 'lookup', notOffered: true }] }, { text: 'done' }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run).map((failure) => failure.assertion)).toContain('notOffered');
  });

  it('is deterministic across runs', async () => {
    const definition = { ...approvalCase('approve'), expect: {} };
    const first = await runEvalCase(definition);
    const second = await runEvalCase(definition);
    expect(second.outbound).toEqual(first.outbound);
    expect(second.modelRequests.map((request) => request.toolCalls)).toEqual(first.modelRequests.map((request) => request.toolCalls));
  });

  it('rejects invalid fixtures with readable problems', () => {
    const invalid = {
      id: 'Bad Id',
      description: '',
      inbound: [],
      tools: [{ name: 'bash' }, { name: 'dup' }, { name: 'dup' }],
      script: [],
      expect: {},
    } as unknown as EvalCase;
    expect(validateEvalCase(invalid)).toEqual([
      'id "Bad Id" must be kebab-case',
      'description is required',
      'source is required (the issue or incident this case guards against)',
      'inbound must contain at least one message',
      'script must contain at least one step',
      'duplicate tool names: dup',
      'tool "bash" uses a reserved built-in name; mocked tools need their own names',
    ]);
    const liveWithoutSchema = defineEvalCase({
      id: 'live-no-schema',
      description: 'A live case whose mock tool hides its arguments.',
      source: 'framework self-test',
      inbound: { text: '北京天气' },
      tools: [{ name: 'get_weather', result: 'sunny' }],
      script: [{ toolCalls: [{ name: 'get_weather', args: { city: 'Beijing' } }] }, { text: 'sunny' }],
      expect: {},
      live: { checks: () => [] },
    });
    expect(validateEvalCase(liveWithoutSchema)).toEqual(['live case: tool "get_weather" must declare parameters for city']);
    const peers = [
      { name: 'reviewer', description: 'Reviews changes.', tools: [] },
      { name: 'reviewer', description: 'Duplicate.', tools: [] },
    ];
    const withAgents = defineEvalCase({ ...approvalCase('approve'), id: 'peer-agents', agents: peers });
    expect(validateEvalCase(withAgents)).toEqual(['duplicate agent names: reviewer']);
    expect(validateEvalCase({ ...withAgents, agents: peers.slice(0, 1), script: [{ text: 'x', actor: 'ghost' }] }))
      .toEqual(['script step 1 names actor "ghost" which is not a declared agent']);
    expect(validateEvalCase({ ...withAgents, agents: peers.slice(0, 1) })).toEqual([]);
    const valid = approvalCase('approve');
    expect(() => loadEvalCases({ 'a.case.ts': { default: valid }, 'b.case.ts': { default: valid } }))
      .toThrow('b.case.ts: id "approval-gate" already used by a.case.ts');
  });
});

describe('eval framework: multi-model and virtual clock', () => {
  it('fires fake-clock timers only when advanced, in time order', () => {
    const clock = createFakeClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('late'), 50);
    const cancelled = clock.setTimeout(() => fired.push('cancelled'), 5);
    clock.setTimeout(() => fired.push('early'), 10);
    clock.clearTimeout(cancelled);
    expect(fired).toEqual([]);
    while (clock.runNext()) { /* drain */ }
    expect(fired).toEqual(['early', 'late']);
    expect(clock.now()).toBe(50);
  });

  it('flags a step pinned to a model that the request did not go to', async () => {
    const definition = defineEvalCase({
      id: 'model-pin-mismatch',
      description: 'The script expects the fallback model, but the primary answers.',
      source: 'framework self-test',
      inbound: { text: 'hi' },
      models: ['scripted-fallback'],
      script: [{ model: 'scripted-fallback', text: 'hello' }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    expect(run.modelRequests.map((request) => request.model)).toEqual(['scripted-model']);
    expect(evaluateExpectations(definition, run).map((failure) => failure.assertion)).toContain('model');
  });

  it('fails a hang step loudly when no timeout is armed instead of waiting forever', async () => {
    const definition = defineEvalCase({
      id: 'hang-without-timeout',
      description: 'A hang step with the request timeout disabled.',
      source: 'framework self-test',
      inbound: { text: 'hi' },
      agentConfig: { providerResilience: { requestTimeoutMs: 0, maxRetries: 0 } },
      script: [{ fault: { kind: 'hang' } }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    // The point is that the case returns at all: the hang step rejects at once
    // instead of blocking the suite until the vitest timeout.
    expect(run.modelRequests).toHaveLength(1);
    expect(run.terminals.at(-1)?.type).toBe('turn_end');
  });
});

describe('eval framework: mock tool parameters', () => {
  it('sends a mock tool\'s parameters schema to the model', async () => {
    const seen: Context[] = [];
    const reply = (model: Model): AssistantMessage => ({
      role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ segments: [{ type: 'text', data: { text: 'ok' } }] }) }], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: 0,
    });
    const port: LlmCompletionPort = {
      complete: async (model, context, options) => {
        expect(options?.outputSchema).toEqual(aiOutboundJsonSchema);
        seen.push(context); return reply(model);
      },
      completeSimple: async (model, context) => { seen.push(context); return reply(model); },
    };
    const model = { id: 'real', provider: 'p', api: 'ai-sdk', sdk: 'openai', input: ['text'], contextWindow: 100_000, maxTokens: 1000 } as Model;
    const parameters = { type: 'object' as const, properties: { city: { type: 'string' } }, required: ['city'] };
    const definition = defineEvalCase({
      id: 'mock-tool-parameters',
      description: 'Mock tool parameters reach the model.',
      source: 'framework self-test',
      inbound: { text: '北京天气' },
      tools: [{ name: 'get_weather', description: 'Weather for a city.', parameters, result: 'sunny' }],
      script: [{ text: 'ok' }],
      expect: {},
    });
    const run = await runEvalCase(definition, { model: () => createLiveModel({ port, model }) });
    expect(run.outbound).toEqual(['ok']);
    const tool = seen[0]!.tools?.find((candidate) => candidate.name === 'get_weather');
    expect(tool?.description).toBe('Weather for a city.');
    // Tools reach the model port as zod schemas; compare their JSON Schema projection.
    expect(z.toJSONSchema(tool!.parameters as z.ZodType)).toMatchObject({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] });
  });
});

describe('eval framework: per-actor scripted model', () => {
  const ask = async (model: ReturnType<typeof createScriptedModel>, sessionId?: string) => {
    const resolved = model.runtime.model(model.providerAlias, model.modelId);
    const context = { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] } as unknown as Context;
    return model.runtime.complete(resolved, context, sessionId ? { sessionId } : undefined);
  };
  const textOf = (message: AssistantMessage) => message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

  it('reads the actor from the child session id and treats everything else as the entry agent', () => {
    expect(actorOfSession(undefined)).toBe('zhin');
    expect(actorOfSession('eval:private:u1')).toBe('zhin');
    expect(actorOfSession('eval:private:u1#actor:researcher')).toBe('researcher');
  });

  it('serves each actor its own queue in script order, whatever the interleaving', async () => {
    const model = createScriptedModel([
      { text: 'entry-1' },
      { text: 'ops-1', actor: 'ops' },
      { text: 'researcher-1', actor: 'researcher' },
      { text: 'entry-2' },
      { text: 'ops-2', actor: 'ops' },
    ]);
    const root = 'session';
    const replies = [
      await ask(model, `${root}#actor:ops`),
      await ask(model, root),
      await ask(model, `${root}#actor:researcher`),
      await ask(model, `${root}#actor:ops`),
      await ask(model),
    ].map(textOf);
    expect(replies).toEqual(['ops-1', 'entry-1', 'researcher-1', 'ops-2', 'entry-2']);
    expect(model.requests.map((request) => request.actor)).toEqual(['ops', 'zhin', 'researcher', 'ops', 'zhin']);
    expect(model.remainingSteps()).toBe(0);
    expect(model.remainingStepsByActor()).toEqual({});
  });

  it('reports unused steps and exhausted requests per actor', async () => {
    const model = createScriptedModel([{ text: 'entry' }, { text: 'a-1', actor: 'a' }, { text: 'a-2', actor: 'a' }, { text: 'b-1', actor: 'b' }]);
    await ask(model);
    await ask(model, 'k#actor:a');
    await expect(ask(model, 'k#actor:c')).rejects.toThrow(/actor c/);
    await expect(ask(model)).rejects.toThrow(/no step/);
    expect(model.remainingSteps()).toBe(2);
    expect(model.remainingStepsByActor()).toEqual({ a: 1, b: 1 });
    expect(model.exhaustedRequests()).toBe(2);
    expect(model.exhaustedRequestsByActor()).toEqual({ c: 1, zhin: 1 });
  });

  it('keeps untagged scripts behaving as a single queue', async () => {
    const model = createScriptedModel([{ text: 'one' }, { text: 'two' }]);
    expect([textOf(await ask(model)), textOf(await ask(model, 'k'))]).toEqual(['one', 'two']);
    expect(model.remainingSteps()).toBe(0);
  });

});

describe('eval framework: timer inbound (ADR 0048 H3 Gap A)', () => {
  const timerCase = (inbound: EvalCase['inbound']) => defineEvalCase({
    id: 'timer-inbound',
    description: 'A timer firing is delivered as Mail to the entry agent.',
    source: 'ADR 0048 H3 Gap A',
    inbound,
    script: [{ text: '提醒：开会' }],
    expect: {},
  });
  const wellFormedTimer = { kind: 'timer', timerId: 'standup', content: '开会', owner: { id: 'owner', roles: ['owner'] } } as const;

  it('accepts a well-formed timer inbound', () => {
    expect(validateEvalCase(timerCase(wellFormedTimer))).toEqual([]);
    expect(validateEvalCase(timerCase([{ text: '十分钟后提醒我开会' }, wellFormedTimer]))).toEqual([]);
  });

  it('rejects a timer inbound without owner, timerId or content', () => {
    const missingOwner = { kind: 'timer', timerId: '', content: ' ' } as unknown as EvalCase['inbound'];
    expect(validateEvalCase(timerCase(missingOwner))).toEqual([
      'inbound 1 (timer) needs a timerId',
      'inbound 1 (timer) needs content',
      'inbound 1 (timer) needs an owner with an id',
    ]);
    const unknownKind = { kind: 'scene', text: 'x' } as unknown as EvalCase['inbound'];
    expect(validateEvalCase(timerCase(unknownKind))).toEqual(['inbound 1 has unknown kind "scene"']);
  });

  it('delivers a timer inbound as timer Mail and runs one turn for the owner', async () => {
    const run = await runEvalCase(timerCase(wellFormedTimer));
    expect(run.modelRequests).toHaveLength(1);
    expect(run.outbound.join('\n')).toContain('提醒：开会');
    expect(run.modelRequests[0]?.lastUserText ?? '').toContain('开会');
  });
});
