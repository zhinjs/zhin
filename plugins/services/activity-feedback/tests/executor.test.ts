import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityFeedbackSource, type ActivityFeedbackEventContext } from '@zhin.js/agent';
import type { CapturedOutboundOperation, OutboundHost } from 'zhin.js/plugin-runtime';
import { ActivityFeedbackExecutor, createOutboundEndpointAccess } from '../src/executor.js';

const executors: ActivityFeedbackExecutor[] = [];
afterEach(async () => { await Promise.all(executors.splice(0).map(executor => executor.dispose())); vi.useRealTimers(); });
const target = { endpoint: { adapter: 'synthetic', id: 'canonical-account' }, kind: 'private' as const,
  id: 'alice', parent: { kind: 'group' as const, id: 'source-group' }, threadId: 'source-thread' };
function context(messageId = 'incoming', controller = new AbortController()): ActivityFeedbackEventContext {
  const value: ActivityFeedbackEventContext = { platform: 'synthetic', endpointKey: 'reusable-alias',
    sessionId: 'session', messageId, sceneType: 'private', userId: 'alice', options: {
      locale: 'en', platform: 'synthetic', endpointKey: 'reusable-alias', sessionId: 'session',
      messageId, sceneType: 'private', userId: 'alice' } };
  Object.defineProperty(value, activityFeedbackSource, { value: { target, client: controller, signal: controller.signal }, enumerable: false });
  return value;
}
function fixture(methods: Partial<CapturedOutboundOperation> = {}) {
  const controller = new AbortController(), release = vi.fn();
  const operation: CapturedOutboundOperation = { target, signal: controller.signal,
    send: vi.fn(async () => 'status-message'), release, ...methods };
  const captureOperation = vi.fn(() => operation);
  const host: OutboundHost = { send: vi.fn(), captureOperation };
  const access = createOutboundEndpointAccess(host);
  const executor = new ActivityFeedbackExecutor(access); executors.push(executor);
  return { controller, release, operation, captureOperation, executor, access, ctx: context('incoming', controller) };
}
const messageConfig = { type: 'message' as const, message: 'Working', autoRemove: true };

describe('captured activity operations', () => {
  it('keeps feedback best effort when the business send rejects and releases its operation', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const f = fixture({ send, recall: async () => undefined });
    await expect(f.executor.start(f.ctx, 'active', messageConfig)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
  });

  it('captures once while a phase is active, deduplicates start, then releases on stop', async () => {
    const recall = vi.fn(async () => undefined), f = fixture({ recall });
    await f.executor.start(f.ctx, 'active', messageConfig);
    await f.executor.start(f.ctx, 'active', messageConfig);
    expect(f.captureOperation).toHaveBeenCalledExactlyOnceWith(f.ctx[activityFeedbackSource]);
    expect(f.operation.send).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled();
    await f.executor.stop(f.ctx, 'active');
    expect(recall).toHaveBeenCalledExactlyOnceWith({ conversation: target, id: 'status-message' });
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('retains complete source addressing and locale for send, edit and recall', async () => {
    const recall = vi.fn(async () => undefined), edit = vi.fn(async () => 'status-message');
    const f = fixture({ recall, edit });
    await f.executor.start(f.ctx, 'active', messageConfig);
    expect(f.operation.send).toHaveBeenCalledExactlyOnceWith([{ type: 'text', data: { text: 'Working' } }], { locale: 'en' });
    await f.executor.updateText(f.ctx, 'active', 'Working [2/15]');
    expect(edit).toHaveBeenCalledExactlyOnceWith({ conversation: target, id: 'status-message' }, 'Working [2/15]');
    await f.executor.stop(f.ctx, 'active');
    expect(recall).toHaveBeenCalledExactlyOnceWith({ conversation: target, id: 'status-message' });
  });

  it('does not fabricate transient messages or controls that the operation did not declare', async () => {
    const f = fixture();
    await f.executor.start(f.ctx, 'active', messageConfig);
    expect(f.operation.send).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
  });

  it('does not grant synthetic lifecycle events platform effects', async () => {
    const f = fixture(), { [activityFeedbackSource]: _source, ...synthetic } = f.ctx;
    await f.executor.start(synthetic, 'active', messageConfig);
    expect(f.captureOperation).not.toHaveBeenCalled();
    expect(f.operation.send).not.toHaveBeenCalled();
  });

  it('does not let source-free stop or update events affect an active operation', async () => {
    const recall = vi.fn(async () => undefined), edit = vi.fn(async () => 'status-message');
    const f = fixture({ recall, edit }), { [activityFeedbackSource]: _source, ...synthetic } = f.ctx;
    await f.executor.start(f.ctx, 'active', messageConfig);
    await f.executor.updateText(synthetic, 'active', 'spoofed');
    await f.executor.stop(synthetic, 'active');
    expect(edit).not.toHaveBeenCalled(); expect(recall).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
    await f.executor.stop(f.ctx, 'active'); expect(recall).toHaveBeenCalledOnce();
  });

  it('uses declared native typing and stops the same complete conversation', async () => {
    const typing = vi.fn(async () => undefined), f = fixture({ typing });
    await f.executor.start(f.ctx, 'active', { type: 'typing' });
    await f.executor.stop(f.ctx, 'active');
    expect(typing).toHaveBeenNthCalledWith(1, target, true);
    expect(typing).toHaveBeenNthCalledWith(2, target, false);
  });

  it('never invents a message id or recalls when send returns null', async () => {
    const recall = vi.fn(async () => undefined), f = fixture({ send: vi.fn(async () => null), recall });
    await f.executor.start(f.ctx, 'active', messageConfig); await f.executor.stop(f.ctx, 'active');
    expect(recall).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
  });

  it('awaits reaction cleanup and does not release a still-running cleanup', async () => {
    let finish!: () => void;
    const cleanup = new Promise<void>(resolve => { finish = resolve; });
    const removeReaction = vi.fn(() => cleanup);
    const f = fixture({ addReaction: vi.fn(async () => 'reaction'), removeReaction });
    await f.executor.start(f.ctx, 'active', { type: 'reaction', autoRemove: true });
    let settled = false;
    const stopping = f.executor.stop(f.ctx, 'active').then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false); expect(f.release).not.toHaveBeenCalled();
    finish(); await stopping;
    expect(removeReaction).toHaveBeenCalledExactlyOnceWith({ conversation: target, id: 'incoming' }, 'reaction');
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('tracks queued reactions per incoming message in a busy session', async () => {
    const addReaction = vi.fn(async () => 'reaction'), removeReaction = vi.fn(async () => undefined);
    const f = fixture({ addReaction, removeReaction });
    const first = context('first', f.controller), second = context('second', f.controller);
    await f.executor.start(first, 'queued', { type: 'reaction' });
    await f.executor.start(second, 'queued', { type: 'reaction' });
    expect(addReaction.mock.calls.map(([message]) => message.id)).toEqual(['first', 'second']);
    await f.executor.stop(first, 'queued');
    expect(removeReaction.mock.calls.map(([message]) => message.id)).toEqual(['first']);
    await f.executor.stop(second, 'queued');
    expect(removeReaction.mock.calls.map(([message]) => message.id)).toEqual(['first', 'second']);
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('cleans keepalive timers and releases on account cancellation without a finish event', async () => {
    vi.useFakeTimers();
    const typing = vi.fn(async () => undefined), f = fixture({ typing });
    await f.executor.start(f.ctx, 'active', { type: 'typing' });
    f.controller.abort(); await f.executor.dispose();
    const stopped = typing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(typing).toHaveBeenCalledTimes(stopped); expect(f.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains a capture failure within feedback and never falls back to an alias send', async () => {
    const send = vi.fn(), debug = vi.fn();
    const executor = new ActivityFeedbackExecutor(createOutboundEndpointAccess({ send,
      captureOperation: () => { throw new Error('source retired'); } }, { debug }));
    executors.push(executor);
    await expect(executor.start(context(), 'active', messageConfig)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled(); expect(debug).toHaveBeenCalledOnce();
  });
});
