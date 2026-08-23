import { describe, it, expect, vi } from 'vitest';
import type { AIEventPayload } from '@zhin.js/agent';
import { resolveActivityFeedbackForTarget, loadActivityFeedbackServiceConfig } from '../src/config.js';
import { ActivityFeedbackOrchestrator } from '../src/orchestrator.js';
import type { ActivityFeedbackExecutor } from '../src/executor.js';
import { ActivityFeedbackPolicy } from '../src/policy.js';

describe('activityFeedback config', () => {
  it('应按 defaults → platforms → endpoints 合并策略', () => {
    const service = loadActivityFeedbackServiceConfig({
      defaults: {
        phases: {
          active: { group: { type: 'reaction', emoji: '1' } },
        },
      },
      platforms: {
        icqq: {
          phases: {
            active: { private: { type: 'message', message: 'hi' } },
          },
        },
      },
      endpoints: {
        'icqq:75318': {
          phases: {
            active: { group: { emoji: '99' } },
          },
        },
      },
    });

    const resolved = resolveActivityFeedbackForTarget(service, 'icqq', '75318');
    expect(resolved?.phases?.active?.group?.emoji).toBe('99');
    expect(resolved?.phases?.active?.private?.message).toBe('hi');
  });

  it('enabled=false 时应全局禁用', () => {
    const service = loadActivityFeedbackServiceConfig({ enabled: false });
    expect(resolveActivityFeedbackForTarget(service, 'icqq', 'x')?.enabled).toBe(false);
  });

  it('schedule finish/error 配置覆盖常规平台默认值', () => {
    const policy = new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({
      schedule: {
        phases: {
          finish: {
            private: { type: 'message', message: '计划完成', removeDelay: 1200 },
          },
        },
      },
    }));

    expect(policy.resolvePhase('discord', 'bot', 'schedule_finish', 'private')).toEqual({
      kind: 'active',
      config: expect.objectContaining({
        type: 'message', message: '计划完成', removeDelay: 1200,
      }),
    });
  });
});

describe('ActivityFeedbackOrchestrator', () => {
  it('策略为 none 时不应调用 executor', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;

    const policy = new ActivityFeedbackPolicy(
      loadActivityFeedbackServiceConfig({
        platforms: {
          icqq: {
            phases: {
              active: { group: { type: 'none' } },
            },
          },
        },
      }),
    );

    const orchestrator = new ActivityFeedbackOrchestrator(policy, executor, {
      debug: vi.fn(),
      error: vi.fn(),
    });

    await orchestrator.startPhase(
      {
        platform: 'icqq',
        endpointKey: '75318',
        sessionId: 'icqq:75318:group:1:u',
        scope: 'group',
        sceneId: 'group:1',
      } as AIEventPayload,
      'active',
      'test',
    );

    expect(executor.start).not.toHaveBeenCalled();
  });

  it('子 agent 的 message phase 应带 [agentId] 前缀', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;

    const policy = new ActivityFeedbackPolicy(
      loadActivityFeedbackServiceConfig({
        platforms: {
          qq: {
            phases: {
              thinking: { private: { type: 'message', message: '思考中...', autoRemove: true } },
              active: { private: { type: 'message', message: '正在处理中...', autoRemove: true } },
            },
          },
        },
      }),
    );

    const orchestrator = new ActivityFeedbackOrchestrator(policy, executor, {
      debug: vi.fn(),
      error: vi.fn(),
    });

    const payload = {
      source: 'subagent',
      agentId: 'researcher',
      taskId: '91a68419',
      platform: 'qq',
      endpointKey: '知音',
      sessionId: 'qq:知音:private:477561',
      sceneId: '477561',
      userId: '477561',
      scope: 'private',
      hookContext: { activityFeedbackEligible: true },
    } as AIEventPayload;

    await orchestrator.startPhase(payload, 'thinking', 'subagent.start');
    expect(executor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.stringContaining('::agent:researcher:'),
      }),
      'thinking',
      expect.objectContaining({ message: '[researcher] 思考中...' }),
    );

    await orchestrator.startPhase(payload, 'active', 'processing.start');
    expect(executor.start).toHaveBeenCalledWith(
      expect.anything(),
      'active',
      expect.objectContaining({ message: '[researcher] 正在处理中...' }),
    );
  });

  it('dispose 清理所有仍活跃的主/子 Agent phase', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;
    const orchestrator = new ActivityFeedbackOrchestrator(
      new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({})),
      executor,
      { debug: vi.fn(), error: vi.fn() },
    );
    const base = {
      platform: 'discord',
      endpointKey: 'bot',
      sessionId: 'discord:bot:private:u1',
      sceneId: 'u1',
      userId: 'u1',
      scope: 'private',
      hookContext: { activityFeedbackEligible: true },
    } as AIEventPayload;
    await orchestrator.startPhase(base, 'active', 'test');
    await orchestrator.startPhase({
      ...base, source: 'subagent', agentId: 'researcher', taskId: 'task-1',
    }, 'thinking', 'test');

    await orchestrator.dispose();

    expect(executor.stop).toHaveBeenCalledTimes(2);
    expect(executor.stop).toHaveBeenCalledWith(expect.anything(), 'active');
    expect(executor.stop).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.stringContaining('::agent:researcher:') }),
      'thinking',
    );
  });

  it('dispose 清理同一会话中每条尚未处理消息的 phase', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;
    const orchestrator = new ActivityFeedbackOrchestrator(
      new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({})),
      executor,
      { debug: vi.fn(), error: vi.fn() },
    );
    const base = {
      platform: 'discord',
      endpointKey: 'bot',
      sessionId: 'discord:bot:group:g1',
      sceneId: 'g1',
      userId: 'u1',
      scope: 'group',
      hookContext: { activityFeedbackEligible: true },
    } as AIEventPayload;

    await orchestrator.startPhase({ ...base, messageId: 'm1' }, 'queued', 'test');
    await orchestrator.startPhase({ ...base, messageId: 'm2' }, 'queued', 'test');
    await orchestrator.dispose();

    expect(executor.stop).toHaveBeenCalledTimes(2);
    expect(executor.stop.mock.calls.map(([ctx]) => ctx.messageId)).toEqual(['m1', 'm2']);
  });

  it('tracks delimiter-containing endpoint tuples without phase-key collisions', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;
    const orchestrator = new ActivityFeedbackOrchestrator(
      new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({})),
      executor,
      { debug: vi.fn(), error: vi.fn() },
    );
    const base = {
      source: 'zhin-agent',
      sceneId: 'u1',
      userId: 'u1',
      scope: 'private',
      hookContext: { activityFeedbackEligible: true },
    } as const;
    const first = {
      ...base,
      platform: 'a:b', endpointKey: 'c', sessionId: 'd',
    } as AIEventPayload;
    const second = {
      ...base,
      platform: 'a', endpointKey: 'b', sessionId: 'c:d',
    } as AIEventPayload;

    await orchestrator.startPhase(first, 'active', 'test');
    await orchestrator.startPhase(second, 'active', 'test');
    await orchestrator.stopPhase(first, 'active', 'test');
    executor.stop.mockClear();
    await orchestrator.dispose();

    expect(executor.stop).toHaveBeenCalledOnce();
    expect(executor.stop).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'a', endpointKey: 'b', sessionId: 'c:d' }),
      'active',
    );
  });

  it('dispose waits for transient cleanup already started by its timer', async () => {
    vi.useFakeTimers();
    let releaseStop!: () => void;
    const stopPending = new Promise<void>((resolve) => { releaseStop = resolve; });
    const executor = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => stopPending),
      updateText: vi.fn(),
      updateThinkingText: vi.fn(),
    } satisfies ActivityFeedbackExecutor;
    const orchestrator = new ActivityFeedbackOrchestrator(
      new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({
        schedule: {
          phases: {
            finish: { group: { type: 'reaction', removeDelay: 10 } },
          },
        },
      })),
      executor,
      { debug: vi.fn(), error: vi.fn() },
    );
    const payload = {
      platform: 'icqq', endpointKey: 'bot', sessionId: 'schedule:cleanup',
      sceneId: 'group:1', groupId: '1', scope: 'group',
      hookContext: { scheduleActivityFeedback: true, scheduleJobId: 'cleanup' },
    } as AIEventPayload;

    await orchestrator.showTransientPhase(payload, 'schedule_finish', 'test');
    await vi.advanceTimersByTimeAsync(10);
    let disposed = false;
    const disposal = orchestrator.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);

    releaseStop();
    await disposal;
    expect(disposed).toBe(true);
    vi.useRealTimers();
  });
});
