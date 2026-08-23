import { describe, expect, it, vi } from 'vitest';
import {
  isGenericActivityFeedbackManager,
  type ActivityFeedbackEventContext,
  type ResolvedActivityFeedbackPhaseConfig,
} from '@zhin.js/agent';
import type { OutboundHost, OutboundSendInput } from 'zhin.js';
import { ActivityFeedbackExecutor, createOutboundEndpointAccess } from '../src/executor.js';

function createCtx(): ActivityFeedbackEventContext {
  return {
    platform: 'sandbox',
    endpointKey: 'bot1',
    sessionId: 'sandbox:bot1:private:u1',
    sceneType: 'private',
    userId: 'u1',
    options: {
      platform: 'sandbox',
      endpointKey: 'bot1',
      sessionId: 'sandbox:bot1:private:u1',
      sceneType: 'private',
      userId: 'u1',
    },
  };
}

const phaseConfig: ResolvedActivityFeedbackPhaseConfig = {
  type: 'message',
  message: '处理中…',
  autoRemove: true,
};

describe('createOutboundEndpointAccess', () => {
  it('按 platform:endpointKey 缓存同一 { endpoint, adapter }', () => {
    const access = createOutboundEndpointAccess({ send: vi.fn() });
    const first = access.resolve('sandbox', 'bot1');
    expect(first).toBeDefined();
    expect(access.resolve('sandbox', 'bot1')).toBe(first);
    expect(access.resolve('sandbox', 'bot2')).not.toBe(first);
  });

  it('start→stop 生命周期：指示器会停止，且不抛 TypeError', async () => {
    const sent: OutboundSendInput[] = [];
    const recall = vi.fn().mockResolvedValue(undefined);
    const outbound: OutboundHost = {
      capabilities: vi.fn(() => ({ operations: ['recall'] })),
      send: vi.fn(async (input: OutboundSendInput) => {
        sent.push(input);
        return 'mid-1';
      }),
      recall,
    };
    const access = createOutboundEndpointAccess(outbound, { debug: vi.fn() });
    const executor = new ActivityFeedbackExecutor(access);
    const ctx = createCtx();

    await executor.start(ctx, 'active', phaseConfig);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      adapter: 'sandbox',
      endpointKey: 'bot1',
      conversation: { kind: 'private', id: 'u1' },
    });

    // manager 挂在缓存的 endpoint 上，stop 时能解析到同一个对象
    const endpoint = access.resolve('sandbox', 'bot1')!.endpoint;
    const manager = endpoint.$activityFeedback;
    if (!manager || !isGenericActivityFeedbackManager(manager)) {
      throw new Error('expected generic activity feedback manager on cached endpoint');
    }
    expect(manager.getActiveIndicator('active', ctx.options)).toBeDefined();

    // 同 phase 重复 start：去重生效，不重复发送
    await executor.start(ctx, 'active', phaseConfig);
    expect(sent).toHaveLength(1);

    await executor.stop(ctx, 'active');
    expect(manager.getActiveIndicator('active', ctx.options)).toBeUndefined();
    expect(recall).toHaveBeenCalledOnce();
  });

  it('wires control.recall to OutboundHost.recall when available', async () => {
    const recalled: Array<{ adapter: string; endpointKey: string; message: unknown }> = [];
    const access = createOutboundEndpointAccess({
      send: vi.fn(async () => 'mid-1'),
      capabilities: vi.fn(() => ({ operations: ['recall'] })),
      recall: vi.fn(async (input) => {
        recalled.push(input);
      }),
    });
    const endpoint = access.resolve('sandbox', 'bot1')!.endpoint;
    const message = {
      conversation: {
        endpoint: { id: 'bot1', adapter: 'sandbox' },
        kind: 'private' as const,
        id: 'u1',
      },
      id: 'mid-1',
    };
    await endpoint.control?.recall?.(message);
    expect(recalled).toEqual([{ adapter: 'sandbox', endpointKey: 'bot1', message }]);
  });

  it('does not expose controls or temporary messages that the endpoint did not explicitly declare', async () => {
    const access = createOutboundEndpointAccess({
      send: vi.fn(),
      recall: vi.fn(),
      edit: vi.fn(),
      addReaction: vi.fn(),
      removeReaction: vi.fn(),
      typing: vi.fn(),
    });

    const control = access.resolve('sandbox', 'bot1')!.endpoint.control;
    expect(control?.recall).toBeUndefined();
    expect(control?.edit).toBeUndefined();
    expect(control?.addReaction).toBeUndefined();
    expect(control?.removeReaction).toBeUndefined();
    expect(control?.typing).toBeUndefined();
    await new ActivityFeedbackExecutor(access).start(createCtx(), 'active', phaseConfig);
    const manager = access.resolve('sandbox', 'bot1')!.endpoint.$activityFeedback;
    if (!manager || !isGenericActivityFeedbackManager(manager)) {
      throw new Error('expected generic activity feedback manager');
    }
    expect(manager.getAdapter('sandbox')?.supportedTypes).toEqual(['none']);
  });

  it('uses declared native typing and stops it for the same conversation', async () => {
    const typing = vi.fn().mockResolvedValue(undefined);
    const access = createOutboundEndpointAccess({
      send: vi.fn(),
      capabilities: vi.fn(() => ({ operations: ['typing'] })),
      typing,
    });
    const executor = new ActivityFeedbackExecutor(access);
    const ctx = { ...createCtx(), platform: 'telegram', options: { ...createCtx().options, platform: 'telegram' } };

    await executor.start(ctx, 'active', { type: 'typing' });
    await executor.stop(ctx, 'active');

    expect(typing).toHaveBeenNthCalledWith(1, expect.objectContaining({
      adapter: 'telegram',
      endpointKey: 'bot1',
      conversation: expect.objectContaining({ kind: 'private', id: 'u1' }),
      active: true,
    }));
    expect(typing).toHaveBeenNthCalledWith(2, expect.objectContaining({ active: false }));
  });

  it('updates an active status message through declared edit capability', async () => {
    const edit = vi.fn().mockResolvedValue('mid-1');
    const access = createOutboundEndpointAccess({
      send: vi.fn(async () => 'mid-1'),
      capabilities: vi.fn(() => ({ operations: ['edit', 'recall'] })),
      edit,
      recall: vi.fn(),
    });
    const executor = new ActivityFeedbackExecutor(access);
    const ctx = createCtx();

    await executor.start(ctx, 'active', phaseConfig);
    await executor.updateText(ctx, 'active', '处理中 [2/15]…');

    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'sandbox',
      endpointKey: 'bot1',
      message: expect.objectContaining({ id: 'mid-1' }),
      content: '处理中 [2/15]…',
    }));
  });

  it('does not invent a message id or recall when send returns null', async () => {
    const recall = vi.fn().mockResolvedValue(undefined);
    const access = createOutboundEndpointAccess({
      capabilities: vi.fn(() => ({ operations: ['recall'] })),
      send: vi.fn().mockResolvedValue(null),
      recall,
    });
    const executor = new ActivityFeedbackExecutor(access);
    const ctx = createCtx();

    await executor.start(ctx, 'active', phaseConfig);
    await executor.stop(ctx, 'active');

    expect(recall).not.toHaveBeenCalled();
  });

  it('awaits reaction removal before reporting cleanup complete', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const removeReaction = vi.fn(() => pending);
    const access = createOutboundEndpointAccess({
      capabilities: vi.fn(() => ({ operations: ['reaction'] })),
      send: vi.fn(),
      removeReaction,
    });
    const endpoint = access.resolve('sandbox', 'bot1')!.endpoint;
    const message = {
      conversation: {
        endpoint: { id: 'bot1', adapter: 'sandbox' },
        kind: 'private' as const,
        id: 'u1',
      },
      id: 'mid-1',
    };
    let settled = false;

    const cleanup = endpoint.control!.removeReaction!(message, 'rid-1').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await cleanup;

    expect(removeReaction).toHaveBeenCalledOnce();
  });

  it('awaits reaction cleanup through executor and activity manager', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const removeReaction = vi.fn(() => pending);
    const access = createOutboundEndpointAccess({
      capabilities: vi.fn(() => ({ operations: ['reaction'] })),
      send: vi.fn(),
      addReaction: vi.fn().mockResolvedValue('rid-1'),
      removeReaction,
    });
    const executor = new ActivityFeedbackExecutor(access);
    const base = createCtx();
    const ctx = {
      ...base,
      messageId: 'source-mid',
      options: { ...base.options, messageId: 'source-mid' },
    };
    await executor.start(ctx, 'active', {
      type: 'reaction', emoji: '⏳', autoRemove: true,
    });
    let settled = false;

    const stopping = executor.stop(ctx, 'active').then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await stopping;

    expect(removeReaction).toHaveBeenCalledOnce();
  });

  it('adds queued reaction for each new inbound message in the same busy group session', async () => {
    const addReaction = vi.fn(async (input: { message: { id: string } }) => input.message.id);
    const removeReaction = vi.fn().mockResolvedValue(undefined);
    const access = createOutboundEndpointAccess({
      capabilities: vi.fn(() => ({ operations: ['reaction'] })),
      send: vi.fn(),
      addReaction,
      removeReaction,
    });
    const executor = new ActivityFeedbackExecutor(access);
    const base = createCtx();
    const first = {
      ...base,
      sceneType: 'group' as const,
      groupId: 'group-1',
      messageId: 'inbound-1',
      options: {
        ...base.options,
        sceneType: 'group' as const,
        groupId: 'group-1',
        messageId: 'inbound-1',
      },
    };
    const second = {
      ...first,
      messageId: 'inbound-2',
      options: { ...first.options, messageId: 'inbound-2' },
    };
    const config = { type: 'reaction' as const, emoji: '⏳', autoRemove: true };

    await executor.start(first, 'queued', config);
    await executor.start(second, 'queued', config);

    expect(addReaction).toHaveBeenCalledTimes(2);
    expect(addReaction.mock.calls.map(([input]) => input.message.id)).toEqual([
      'inbound-1',
      'inbound-2',
    ]);

    await executor.stop(first, 'queued');
    expect(removeReaction).toHaveBeenCalledOnce();
    expect(removeReaction.mock.calls[0]![0].message.id).toBe('inbound-1');
    await executor.stop(second, 'queued');
    expect(removeReaction).toHaveBeenCalledTimes(2);
    expect(removeReaction.mock.calls[1]![0].message.id).toBe('inbound-2');
  });
});
