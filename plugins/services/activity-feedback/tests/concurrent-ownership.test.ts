import { activityFeedbackSource, type AIEventPayload } from '@zhin.js/agent';
import { fakeOf } from '@zhin.js/testing';
import { ActivityFeedbackExecutor } from '../src/executor.js';
import { ActivityFeedbackOrchestrator } from '../src/orchestrator.js';
import { ActivityFeedbackPolicy } from '../src/policy.js';

it('keeps transient cleanup independent for complete source scenes', async () => {
  vi.useFakeTimers();
  const recalled: string[] = [], released: string[] = [];
  const client = {};
  const executor = new ActivityFeedbackExecutor({ capture(context) {
    const source = context[activityFeedbackSource];
    if (!source?.target.threadId) throw new Error('test requires a complete source scene');
    const target = source.target, threadId = source.target.threadId;
    return { target, signal: new AbortController().signal,
      send: async () => `status-${target.threadId}`,
      recall: async () => { recalled.push(threadId); },
      release: () => { released.push(threadId); } };
  } });
  const orchestrator = new ActivityFeedbackOrchestrator(new ActivityFeedbackPolicy({ defaults: { phases: {
    active: { group: { type: 'message', message: 'Working', autoRemove: true, removeDelay: 10 } },
  } } }), executor, { debug: vi.fn(), error: vi.fn() });
  const payload = (threadId: string) => {
    const value = fakeOf<AIEventPayload>({ platform: 'synthetic', endpointKey: 'display-alias', sessionId: 'shared-session',
      messageId: 'incoming', scope: 'group', sceneId: 'group', userId: 'user',
      hookContext: { activityFeedbackEligible: true } });
    const target = { endpoint: { adapter: 'synthetic', id: 'canonical-account' }, kind: 'group' as const,
      id: 'group', parent: { kind: 'channel' as const, id: 'parent' }, threadId };
    Object.defineProperty(value, activityFeedbackSource, { value: { target, client, signal: new AbortController().signal } });
    return value;
  };
  try {
    await orchestrator.showTransientPhase(payload('A'), 'active', 'first scene');
    await orchestrator.showTransientPhase(payload('B'), 'active', 'second scene');
    await vi.advanceTimersByTimeAsync(10);
    expect(recalled).toEqual(['A', 'B']);
    expect(released).toEqual(['A', 'B']);
  } finally { await orchestrator.dispose(); vi.useRealTimers(); }
});

it('deduplicates concurrent replacement phases after draining the previous source', async () => {
  let finishRecall!: () => void;
  const pendingRecall = new Promise<void>(resolve => { finishRecall = resolve; });
  const recalled: number[] = [], released: number[] = [], sent: number[] = [];
  const target = { endpoint: { adapter: 'synthetic', id: 'canonical-account' }, kind: 'group' as const, id: 'group' };
  let captures = 0;
  const executor = new ActivityFeedbackExecutor({ capture() {
    const id = ++captures;
    return { target, signal: new AbortController().signal,
      send: async () => { sent.push(id); return `status-${id}`; },
      recall: async () => { recalled.push(id); if (id === 1) await pendingRecall; },
      release: () => { released.push(id); } };
  } });
  const orchestrator = new ActivityFeedbackOrchestrator(new ActivityFeedbackPolicy({ defaults: { phases: {
    active: { group: { type: 'message', message: 'Working', autoRemove: true } },
  } } }), executor, { debug: vi.fn(), error: vi.fn() });
  const payload = (client: object) => {
    const value = fakeOf<AIEventPayload>({ platform: 'synthetic', endpointKey: 'display-alias', sessionId: 'session',
      messageId: 'incoming', scope: 'group', sceneId: 'group', userId: 'user',
      hookContext: { activityFeedbackEligible: true } });
    Object.defineProperty(value, activityFeedbackSource, { value: { target, client, signal: new AbortController().signal } });
    return value;
  };
  try {
    await orchestrator.startPhase(payload({}), 'active', 'initial');
    const replacement = payload({});
    const starts = [orchestrator.startPhase(replacement, 'active', 'replacement'),
      orchestrator.startPhase(replacement, 'active', 'duplicate replacement')];
    await vi.waitFor(() => { expect(recalled).toEqual([1]); });
    finishRecall();
    await Promise.all(starts);
    expect(captures).toBe(2);
    expect(sent).toEqual([1, 2]);
  } finally {
    finishRecall();
    await orchestrator.dispose();
  }
  expect(recalled).toEqual([1, 2]);
  expect(released).toEqual([1, 2]);
});
