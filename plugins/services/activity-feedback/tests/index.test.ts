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
});

describe('ActivityFeedbackOrchestrator', () => {
  it('策略为 none 时不应调用 executor', async () => {
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
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
});
