import { fakeOf } from '@zhin.js/testing';
import type { Message, OutboundHost, OutboundSendInput } from 'zhin.js';
import type { Locale } from 'zhin.js/i18n';
import { ZhinAgentEventEmitter } from '../../../../packages/im/agent/src/event/event-emitter.js';
import { createTurnActivityProjector } from '../../../../packages/im/agent/src/activity-feedback/turn-event-projector.js';
import type { AIEventPayload } from '@zhin.js/agent';
import { createActivityFeedbackAIEventHandlers, createActivityFeedbackOrchestratorForRuntime } from '../src/ai-event-binder.js';
import { createOutboundEndpointAccess } from '../src/executor.js';

function fixture(defaultLocale: Locale = 'zh-CN', customMessage?: string) {
  const sent: OutboundSendInput[] = [];
  const edit = vi.fn(async () => 'edited');
  const recall = vi.fn(async () => {});
  const outbound: OutboundHost = {
    capabilities: () => ({ operations: ['recall', 'edit'] }),
    send: async input => { sent.push(input); return `message-${sent.length}`; }, edit, recall,
  };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const orchestrator = createActivityFeedbackOrchestratorForRuntime({ defaults: { phases: {
    active: { private: { type: 'message', ...(customMessage === undefined ? {} : { message: customMessage }) } },
  } } }, logger, createOutboundEndpointAccess(outbound, logger), defaultLocale);
  const handlers = createActivityFeedbackAIEventHandlers(orchestrator, defaultLocale);
  const emitter = new ZhinAgentEventEmitter();
  const source = { locale: 'en' as Locale, sender: { id: 'alice' }, clientAdapter: 'sandbox', endpointId: 'bot',
    id: 'incoming', conversation: { endpoint: { id: 'bot', adapter: 'sandbox' }, kind: 'private' as const, id: 'alice' } };
  const payload = emitter.createPayload('sandbox:bot:private:alice', fakeOf<Message>(source), 'text', {
    hookContext: { activityFeedbackEligible: true },
  });
  return { source, payload, sent, edit, recall, handlers, orchestrator, logger };
}

it('carries the originating personal language through status sends, edits, iteration and child activity', async () => {
  const f = fixture('zh-CN');
  try {
    // Preference changes after event creation cannot alter this operation's language.
    f.source.locale = 'zh-CN';
    await f.handlers.onProcessingStart?.(f.payload);
    expect(f.sent[0]).toMatchObject({ content: 'Working...', locale: 'en' });
    await f.handlers.onToolCall?.({ ...f.payload, toolName: '查询工具' });
    await f.handlers.onToolResult?.({ ...f.payload, toolName: '查询工具', status: 'error', error: '第三方错误' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'Calling tool: 查询工具…' }));
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'Tool 查询工具 did not complete; continuing…' }));

    const iterations: AIEventPayload[] = [];
    const project = createTurnActivityProjector({ payload: f.payload, thinkingPreview: false, thinkingMaxLength: 100,
      publish: (_event, payload) => { iterations.push(payload); } });
    project({ type: 'iteration_start', iteration: 2, maxIterations: 15 });
    await f.handlers.onProcessingStart?.(iterations[0]!);
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'Working [2/15]...' }));

    await f.handlers.onThinking?.({ ...f.payload, thinking: '模型思考原文' });
    expect(f.sent.at(-1)).toMatchObject({ content: 'Thinking...', locale: 'en' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: '模型思考原文' }));
    await f.handlers.onSubagentStart?.({ ...f.payload, source: 'subagent', taskId: 'child', agentId: 'researcher', label: '原始任务标题' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: '[researcher] Subtask running: 原始任务标题...' }));
    expect(f.sent.every(input => input.locale === 'en')).toBe(true);
    expect(f.logger.error).not.toHaveBeenCalled();
  } finally { await f.orchestrator.dispose(); }
  expect(f.recall).toHaveBeenCalled();
});

it('preserves explicitly authored phase text, including text equal to the old Chinese default', async () => {
  const f = fixture('zh-CN', '正在处理中...');
  try {
    await f.handlers.onProcessingStart?.(f.payload);
    expect(f.sent[0]).toMatchObject({ content: '正在处理中...', locale: 'en' });
  } finally { await f.orchestrator.dispose(); }
});

it('uses the generation project language only when an older event has no captured language', async () => {
  const f = fixture('en');
  try {
    const { locale: _locale, ...legacy } = f.payload;
    await f.handlers.onProcessingStart?.(legacy);
    expect(f.sent[0]).toMatchObject({ content: 'Working...', locale: 'en' });
    await f.handlers.onToolCall?.({ ...legacy, toolName: 'search' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'Calling tool: search…' }));
    await f.handlers.onScheduleFinish?.({ ...legacy, sessionId: 'schedule:job',
      hookContext: { scheduleJobId: 'job', scheduleActivityFeedback: true } });
    expect(f.sent.at(-1)).toMatchObject({ content: '✅ Scheduled task completed', locale: 'en' });
  } finally { await f.orchestrator.dispose(); }
});

it('keeps separate users on one endpoint independent', async () => {
  const f = fixture('zh-CN');
  try {
    await Promise.all([
      f.handlers.onProcessingStart?.(f.payload),
      f.handlers.onProcessingStart?.({ ...f.payload, locale: 'zh-CN', sessionId: 'sandbox:bot:private:bob', userId: 'bob', sceneId: 'bob', messageId: 'incoming-bob' }),
    ]);
    expect(f.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ locale: 'en', content: 'Working...', conversation: { kind: 'private', id: 'alice' } }),
      expect.objectContaining({ locale: 'zh-CN', content: '正在处理中...', conversation: { kind: 'private', id: 'bob' } }),
    ]));
  } finally { await f.orchestrator.dispose(); }
});

it.each([
  ['en', undefined, 'Working [2/15]...'],
  ['zh-CN', undefined, '处理中 [2/15]...'],
  ['zh-CN', 'en', 'Working [2/15]...'],
  ['en', 'zh-CN', '处理中 [2/15]...'],
] as const)('formats projected iteration progress after resolving project %s / operation %s', async (projectLocale, locale, expected) => {
  const f = fixture(projectLocale);
  try {
    const payload = { ...f.payload, locale, content: '用户请求原文，不是状态提示' };
    const events: AIEventPayload[] = [];
    const project = createTurnActivityProjector({ payload, thinkingPreview: false, thinkingMaxLength: 100,
      publish: (_event, value) => { events.push(value); } });
    project({ type: 'iteration_start', iteration: 2, maxIterations: 15 });
    expect(events[0]).toMatchObject({ iterations: 2, iterationProgress: { current: 2, total: 15 } });
    expect(events[0]).not.toHaveProperty('content');
    expect(payload.content).toBe('用户请求原文，不是状态提示');
    await f.handlers.onProcessingStart?.(events[0]!);
    expect(f.edit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: expected }));
    expect(f.sent[0]?.locale).toBe(locale ?? projectLocale);
    expect(JSON.stringify(f.sent)).not.toContain(payload.content);
  } finally { await f.orchestrator.dispose(); }
});

it('keeps explicitly authored iteration content and model thinking independent of progress localization', async () => {
  const f = fixture('en');
  try {
    const { locale: _locale, ...legacy } = f.payload;
    await f.handlers.onProcessingStart?.({ ...legacy, iterations: 2,
      iterationProgress: { current: 2, total: 15 }, content: '  自定义处理中 [2/15]...  ' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: '自定义处理中 [2/15]...' }));
    await f.handlers.onThinking?.({ ...legacy, thinking: '模型原文：处理中 [2/15]...' });
    expect(f.edit).toHaveBeenCalledWith(expect.objectContaining({ content: '模型原文：处理中 [2/15]...' }));
  } finally { await f.orchestrator.dispose(); }
});
