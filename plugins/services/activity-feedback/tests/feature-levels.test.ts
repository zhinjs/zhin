import { describe, it, expect, vi } from 'vitest';
import type { AIEventPayload } from '@zhin.js/agent';
import schema from '../schema.json' with { type: 'json' };
import { loadActivityFeedbackServiceConfig } from '../src/config.js';
import { ActivityFeedbackOrchestrator } from '../src/orchestrator.js';
import type { ActivityFeedbackExecution } from '../src/executor.js';
import { ActivityFeedbackPolicy } from '../src/policy.js';

describe('activity-feedback layered feature switch (ADR 0050 / 0055)', () => {
  it('declares all four levels and keeps its own defaults / platforms / endpoints layers global', () => {
    expect(schema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'] });
    for (const property of Object.values(schema.properties)) expect(property['x-zhin-config']).toMatchObject({ levels: ['global'] });
  });

  it('shows no feedback in conversations where activity-feedback is switched off', async () => {
    const executor = {
      kindCapabilities: vi.fn(() => undefined), start: vi.fn(), stop: vi.fn(), updateText: vi.fn(), updateThinkingText: vi.fn(),
      dispose: vi.fn(async () => undefined),
    } satisfies ActivityFeedbackExecution;
    const checked: unknown[] = [];
    const orchestrator = new ActivityFeedbackOrchestrator(new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig({})), executor,
      { debug: vi.fn(), error: vi.fn() }, 'zh-CN', target => { checked.push(target); return target.conversation.id !== 'g-off'; });
    const payload = (group: string) => ({ platform: 'discord', endpointKey: 'discord\0im\0bot', sessionId: `discord:bot:group:${group}:u`,
      scope: 'group', sceneId: `group:${group}`, userId: 'u', hookContext: { activityFeedbackEligible: true } }) as AIEventPayload;
    await orchestrator.startPhase(payload('g-off'), 'active', 'test');
    expect(executor.start).not.toHaveBeenCalled();
    await orchestrator.startPhase(payload('g-on'), 'active', 'test');
    expect(executor.start).toHaveBeenCalledTimes(1);
    expect(checked).toEqual([
      { conversation: { endpoint: { id: 'discord\0im\0bot' }, kind: 'group', id: 'g-off' } },
      { conversation: { endpoint: { id: 'discord\0im\0bot' }, kind: 'group', id: 'g-on' } },
    ]);
  });
});
