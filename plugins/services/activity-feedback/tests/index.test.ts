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
        endpointId: '75318',
        sessionId: 'icqq:75318:group:1:u',
        scope: 'group',
        sceneId: 'group:1',
      } as AIEventPayload,
      'active',
      'test',
    );

    expect(executor.start).not.toHaveBeenCalled();
  });
});
