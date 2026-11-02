import type { CoreReplyStream } from '@zhin.js/core/runtime';
import { createUserMessage, EMPTY_TOKEN_USAGE, projectPromptContext, type AssistantMessage } from '@zhin.js/ai';
import { SessionToldLedger } from '../../src/memory/told-ledger.js';
import { stampDeliveredMessageId } from '../../src/session/participant-header-stamp.js';
import type { ReplyPhaseFacts } from '../../src/core/reply-phase.js';
import { executeAgentTurn } from '../../src/turn/execute-agent-turn.js';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { UsageQuota } from '../../src/security/usage-quota.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';

it.each(['sent', 'partial', 'legacy'] as const)('projects %s delivery facts through the complete turn engine', async mode => {
  const conversation = { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private' as const, id: 'user' };
  const message = { conversation, id: 'physical' };
  const confirmed = [{ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: 'confirmed' } }] }];
  const output = [{ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: 'confirmed planned-tail' } }] }];
  const receipt = mode === 'partial'
    ? { status: 'failed' as const, parts: [{ message }], failure: { code: 'transport_unknown', message: 'unknown', retryable: false, deliveryUnknown: true as const } }
    : { status: 'sent' as const, parts: [{ message }], message };
  const native: CoreReplyStream = { receipt, confirmed: [{ key: 'physical', message, segments: confirmed[0]!.segments }],
    update: vi.fn(), finish: vi.fn(async () => receipt), cancel: vi.fn(async () => receipt) };
  const send = vi.fn(async () => ({ status: 'sent' as const }));
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'user', conversation },
    principal: { subjectId: 'user', roles: ['user'] }, input: { text: 'hello' }, session: { key: 'sandbox:bot:private:user' },
    policy: { permissions: ['user'], unattended: false }, capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => undefined }, reply: { send, openStream: () => native } },
  });
  const projectConversation = vi.fn(async () => undefined), record = vi.fn(), finalizeActiveTurn = vi.fn();
  const host = { emitter: new ZhinAgentEventEmitter(new AgentEventBus()), config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) }, usageQuota: new UsageQuota(),
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }), setDeferredToolSnapshot: async () => undefined },
    promptController: new PromptController('one-at-a-time', 'one-at-a-time'), activeBinding: { providerAlias: 'provider', model: 'model' },
    toldLedger: { record, renderBlocks: () => [] }, finalizeActiveTurn };
  const engine = createFullAgentTurnEngine({ host: host as never,
    core: { runText(input: { replyStream: CoreReplyStream }) { return (async function* () {
      expect(input.replyStream).toBeDefined();
      const snapshot = { revision: 1, messages: [{ key: 'message-0', complete: true,
        segments: [{ key: 'segment-0', complete: true, value: output[0]!.segments[0]! }] }] };
      yield { type: 'turn_end' as const, output, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return { reply: 'confirmed planned-tail', output, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        path: 'chat' as const, iterations: 1, model: 'model', toolCalls: [], projectConversation,
        ...(mode === 'legacy' ? {} : { progressive: { run: new ReplyStreamRun(input.replyStream), snapshot } }) };
    })(); } } as never,
    sessionSystem: { prepareIngressTurn: async () => ({ sessionKey: turn.session.key, userId: 'user', sessionId: 'session', isNewSession: false,
      turnUser: { rawContent: 'hello', promptMessages: [createUserMessage('hello')] } }), touchAfterTurn: async () => undefined } as never,
    contextSystem: { buildTextTurnContext: async () => ({ userMessages: [createUserMessage('hello')], personaEnhanced: 'persona',
      modelCandidates: ['model'], modelId: 'model', providerAlias: 'provider', modelSdk: 'google', turnEnvelope: null }) } as never,
  });
  const stream = engine.run({ turn, capabilities: { generation: 1, owner: rootPluginId(), tools: [], skills: [], agents: [], mcp: [], promptSections: [] },
    toolCapabilities: [], tools: new TurnToolRuntime(turn, []), selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] } });
  while (true) {
    const step = await stream.next();
    if (!step.done) continue;
    if (mode === 'partial') await expect(step.value.project()).rejects.toThrow('transport_unknown');
    else await step.value.project();
    break;
  }
  if (mode === 'legacy') {
    expect(send).toHaveBeenCalledExactlyOnceWith(output);
    expect(native.finish).not.toHaveBeenCalled();
  } else {
    expect(send).not.toHaveBeenCalled();
    expect(native.finish).toHaveBeenCalledOnce();
    expect(projectConversation).toHaveBeenCalledWith(expect.objectContaining({ confirmedOutput: confirmed, messageIds: ['physical'] }));
    expect(record).toHaveBeenCalledWith('session', 'confirmed', 'reply', 'turn');
    expect(finalizeActiveTurn).toHaveBeenCalledWith(expect.objectContaining({ output: 'confirmed' }));
  }
});

it.each(['stream', 'off', 'stopped', 'fallback', 'cancel', 'cancel-projection-failure', 'journal-failure', 'journal-projection-failure'] as const)('normalizes a late follow-up into one terminal with %s phase delivery', async mode => {
  const controller = new PromptController('one-at-a-time', 'one-at-a-time');
  const conversation = { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private' as const, id: 'user' };
  const sessionKey = 'sandbox:bot:private:user';
  const order: string[] = [], projects: ReturnType<typeof vi.fn>[] = [];
  const streams: CoreReplyStream[] = [];
  const cancellation = new AbortController(), publish = vi.fn(async () => undefined);
  const cancelling = mode === 'cancel' || mode === 'cancel-projection-failure';
  const journaling = mode === 'journal-failure' || mode === 'journal-projection-failure';
  const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 'ordinary' }));
  const openStream = vi.fn((answer?: { phaseId?: string }) => {
    if (mode === 'off') return undefined;
    const index = streams.length + 1, message = { conversation, id: `physical-${index}` };
    const receipt = mode === 'stopped'
      ? { status: 'failed' as const, parts: [{ message }], failure: { code: 'phase_unknown', message: 'unconfirmed tail', retryable: false, deliveryUnknown: true as const } }
      : { status: 'sent' as const, message, parts: [{ message }] };
    const native: CoreReplyStream = { receipt, confirmed: [{ key: 'physical', message, segments: [{ type: 'text', data: { text: `confirmed-${index}` } }] }],
      update: vi.fn(), finish: vi.fn(async () => { order.push(`finish:${index}`); return receipt; }), cancel: vi.fn(async () => receipt) };
    expect(answer?.phaseId).toBe(`turn:answer:${index}`);
    streams.push(native); return native;
  });
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'user', conversation },
    principal: { subjectId: 'user', roles: ['user'] }, input: { text: 'first' }, session: { key: sessionKey },
    policy: { permissions: ['user'], unattended: false }, capabilities: { tools: [], skills: [] }, signal: cancellation.signal,
    ports: { journal: { append: async event => { if (journaling && event.type === 'turn_end') throw new Error('synthetic terminal commit failed'); } }, reply: { send, openStream }, activity: { publish } },
  });
  const finalizeActiveTurn = vi.fn(), ledger = new SessionToldLedger();
  const record = vi.spyOn(ledger, 'record'), returnedFacts: ReplyPhaseFacts[] = [];
  const host = { emitter: new ZhinAgentEventEmitter(new AgentEventBus()), config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) }, usageQuota: new UsageQuota(),
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }), setDeferredToolSnapshot: async () => undefined },
    promptController: controller, activeBinding: { providerAlias: 'provider', model: 'model' },
    toldLedger: ledger, finalizeActiveTurn };
  let calls = 0;
  const engine = createFullAgentTurnEngine({ host: host as never,
    core: { runText(input: import('../../src/core/agent-core-run.js').AgentLoopTurnInput) { return (async function* () {
      const index = ++calls;
      order.push(`core:${index}`);
      if (index === 2 && (mode === 'stream' || mode === 'off')) {
        expect(projects[0]).toHaveBeenCalledOnce();
        if (mode === 'off') expect(projects[0]).toHaveBeenCalledWith({ confirmedOutput: [] });
      }
      const output = [{ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: `planned-${index}` } }] }];
      let phaseId: string | undefined, stopped = false;
      if (input.replyPhases) {
        const phase = input.replyPhases.open(); phaseId = phase.id;
        const facts = await input.replyPhases.settle({ id: phase.id, reply: `planned-${index}`, output,
          ...(mode === 'fallback' ? {} : { run: new ReplyStreamRun(phase.stream!),
            snapshot: { revision: 1, messages: [{ key: 'message', complete: true, segments: [{ key: 'body', complete: true, value: output[0]!.segments[0]! }] }] } }) });
        returnedFacts.push(facts);
        stopped = facts.stopped === true;
      }
      const projectConversation = vi.fn(async () => { order.push(`history:${index}`); if (mode === 'cancel-projection-failure' || mode === 'journal-projection-failure') throw new Error('synthetic projection failure'); }); projects.push(projectConversation);
      yield { type: 'turn_end' as const, output, usage: { promptTokens: index, completionTokens: 1, totalTokens: index + 1, cacheReadTokens: index } };
      // This is after the Core terminal but before PromptController observes execute completion.
      if (index === 1) {
        if (cancelling) cancellation.abort();
        else if (!journaling) controller.followUp(sessionKey, createUserMessage('late follow-up'));
      }
      return { reply: `planned-${index}`, output, usage: { prompt_tokens: index, completion_tokens: 1, total_tokens: index + 1 },
        path: 'chat' as const, iterations: 1, model: 'model', toolCalls: [], projectConversation,
        ...(phaseId ? { replyPhaseId: phaseId } : {}), ...(stopped ? { replyPhaseStopped: true as const } : {}) };
    })(); } } as never,
    sessionSystem: { prepareIngressTurn: async () => ({ sessionKey, userId: 'user', sessionId: 'session', isNewSession: false,
      turnUser: { rawContent: 'first', promptMessages: [createUserMessage('first')] } }), touchAfterTurn: async () => undefined } as never,
    contextSystem: { buildTextTurnContext: async () => ({ userMessages: [createUserMessage('first')], personaEnhanced: 'persona',
      modelCandidates: ['model'], modelId: 'model', providerAlias: 'provider', modelSdk: 'google', turnEnvelope: null }) } as never,
  });
  const events: import('../../src/event/turn-event.js').TurnEvent[] = [];
  const stream = engine.run({ turn, capabilities: { generation: 1, owner: rootPluginId(), tools: [], skills: [], agents: [], mcp: [], promptSections: [] },
    toolCapabilities: [], tools: new TurnToolRuntime(turn, []), selection: { binding: { name: 'zhin', providerAlias: 'provider', model: 'model', mcpServers: [] }, mcpServers: [] } });
  if (journaling) {
    const outcome = await executeAgentTurn(turn, () => stream);
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'turn_journal_commit_failed', message: 'synthetic terminal commit failed' } });
    expect(projects[0]).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(finalizeActiveTurn).not.toHaveBeenCalled();
    if (mode === 'journal-projection-failure') expect(publish).toHaveBeenCalledWith({ type: 'turn_projection_failed', data: 'synthetic projection failure' });
    return;
  }
  const consume = async () => { while (true) {
    const step = await stream.next();
    if (!step.done) { events.push(step.value); continue; }
    if (mode === 'stopped') await expect(step.value.project()).rejects.toThrow('phase_unknown');
    else await step.value.project();
    break;
  } };
  if (cancelling) {
    await expect(consume()).rejects.toThrow('Turn cancelled');
    expect(calls).toBe(1);
    expect(projects[0]).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(finalizeActiveTurn).not.toHaveBeenCalled();
    if (mode === 'cancel-projection-failure') expect(publish).toHaveBeenCalledWith({ type: 'turn_projection_failed', data: 'synthetic projection failure' });
    return;
  }
  await consume();
  const terminals = events.filter(event => event.type === 'turn_end');
  expect(terminals).toHaveLength(1);
  expect(calls).toBe(mode === 'stopped' ? 1 : 2);
  expect(terminals[0]!.usage).toMatchObject(mode === 'stopped'
    ? { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheReadTokens: 1 }
    : { promptTokens: 3, completionTokens: 2, totalTokens: 5, cacheReadTokens: 3 });
  expect(finalizeActiveTurn).toHaveBeenCalledOnce();
  expect(finalizeActiveTurn).toHaveBeenCalledWith(expect.objectContaining({ usage: mode === 'stopped'
    ? { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } : { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
  if (mode === 'off') {
    expect(send).toHaveBeenCalledExactlyOnceWith([{ type: 'message', segments: [{ type: 'text', data: { text: 'planned-2' } }] }]);
    expect(order.indexOf('history:1')).toBeLessThan(order.indexOf('core:2'));
    expect(projects.every(project => project.mock.calls.length === 1)).toBe(true);
  } else if (mode === 'fallback') {
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(call => call[1])).toEqual([{ intent: 'answer', phaseId: 'turn:answer:1' }, { intent: 'answer', phaseId: 'turn:answer:2' }]);
    expect(streams.every(native => vi.mocked(native.finish).mock.calls.length === 0)).toBe(true);
    expect(record.mock.calls.map(call => call[1])).toEqual(['planned-1', 'planned-2']);
    expect(projects.every(project => project.mock.calls.length === 1)).toBe(true);
  } else {
    expect(send).not.toHaveBeenCalled();
    expect(streams.every(native => vi.mocked(native.finish).mock.calls.length === 1)).toBe(true);
    expect(record.mock.calls.map(call => call[1])).toEqual(mode === 'stopped' ? ['confirmed-1'] : ['confirmed-1', 'confirmed-2']);
    expect(order.indexOf('finish:1')).toBeLessThan(order.indexOf('history:1'));
    if (mode === 'stream') {
      expect(order.indexOf('history:1')).toBeLessThan(order.indexOf('core:2'));
      const entries = ledger.entries('session');
      expect(entries.map(entry => entry.turnId)).toEqual(['turn', 'turn']);
      expect(entries[0]!.contextRef).not.toBe(entries[1]!.contextRef);
      expect(returnedFacts[1]!.contextRefs).toContain(entries[1]!.contextRef);
      const raw: AssistantMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'confirmed-2' }],
        api: 'test', provider: 'test', model: 'test', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop' };
      const visible = stampDeliveredMessageId([raw], 'physical-2', returnedFacts[1]!.contextRefs)[0] as AssistantMessage;
      const current = { ...createUserMessage('current'), content: [...ledger.renderBlocks('session'), { type: 'text' as const, text: 'current' }] };
      const projected = projectPromptContext([visible, current]);
      expect(JSON.stringify(projected.at(-1)?.content)).toContain('confirmed-1');
      expect(JSON.stringify(projected.at(-1)?.content)).not.toContain('confirmed-2');
    }
    expect(projects.every(project => project.mock.calls.length === 1)).toBe(true);
  }
});
