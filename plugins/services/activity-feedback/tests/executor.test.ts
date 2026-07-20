import { describe, expect, it, vi } from 'vitest';
import {
  isGenericActivityFeedbackManager,
  type ActivityFeedbackEventContext,
  type ResolvedActivityFeedbackPhaseConfig,
} from '@zhin.js/agent';
import type { OutboundHost, OutboundSendInput } from '@zhin.js/plugin-runtime';
import { ActivityFeedbackExecutor, createOutboundEndpointAccess } from '../src/executor.js';

function createCtx(): ActivityFeedbackEventContext {
  return {
    platform: 'sandbox',
    endpointId: 'bot1',
    sessionId: 'sandbox:bot1:private:u1',
    sceneType: 'private',
    userId: 'u1',
    options: {
      platform: 'sandbox',
      endpointId: 'bot1',
      sessionId: 'sandbox:bot1:private:u1',
      sceneType: 'private',
      userId: 'u1',
    },
  };
}

const phaseConfig: ResolvedActivityFeedbackPhaseConfig = {
  type: 'message',
  message: '处理中…',
};

describe('createOutboundEndpointAccess', () => {
  it('按 platform:endpointId 缓存同一 { endpoint, adapter }', () => {
    const access = createOutboundEndpointAccess({ send: vi.fn() });
    const first = access.resolve('sandbox', 'bot1');
    expect(first).toBeDefined();
    expect(access.resolve('sandbox', 'bot1')).toBe(first);
    expect(access.resolve('sandbox', 'bot2')).not.toBe(first);
  });

  it('start→stop 生命周期：指示器会停止，且不抛 TypeError', async () => {
    const sent: OutboundSendInput[] = [];
    const outbound: OutboundHost = {
      send: vi.fn(async (input: OutboundSendInput) => {
        sent.push(input);
      }),
    };
    const access = createOutboundEndpointAccess(outbound, { debug: vi.fn() });
    const executor = new ActivityFeedbackExecutor(access);
    const ctx = createCtx();

    await executor.start(ctx, 'active', phaseConfig);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      adapter: 'sandbox',
      endpointId: 'bot1',
      channelType: 'private',
      channelId: 'u1',
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

    // OutboundHost 未提供 recall 时，$recallMessage 仍是安全 no-op
    await expect(endpoint.$recallMessage?.('any-id')).resolves.toBeUndefined();
  });

  it('wires $recallMessage to OutboundHost.recall when available', async () => {
    const recalled: Array<{ adapter: string; endpointId: string; messageId: string }> = [];
    const access = createOutboundEndpointAccess({
      send: vi.fn(async () => 'mid-1'),
      recall: vi.fn(async (input) => {
        recalled.push(input);
      }),
    });
    const endpoint = access.resolve('sandbox', 'bot1')!.endpoint;
    await endpoint.$recallMessage?.('mid-1');
    expect(recalled).toEqual([{ adapter: 'sandbox', endpointId: 'bot1', messageId: 'mid-1' }]);
  });
});
