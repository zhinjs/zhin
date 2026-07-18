import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DisposeStack } from '@zhin.js/plugin-runtime';
import { activityFeedbackAiBus } from '@zhin.js/agent';
import plugin from '../plugin.ts';
import { loadActivityFeedbackServiceConfig } from '../src/config.js';
import {
  bindActivityFeedbackToAIEventBus,
  createActivityFeedbackOrchestratorForRuntime,
} from '../src/ai-event-binder.js';

describe('@zhin.js/service-activity-feedback runtime', () => {
  beforeEach(() => {
    activityFeedbackAiBus.clear();
  });

  afterEach(() => {
    activityFeedbackAiBus.clear();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('activity-feedback');
  });

  it('loads default service config', () => {
    const cfg = loadActivityFeedbackServiceConfig({});
    expect(cfg.enabled).not.toBe(false);
  });

  it('setup binds AI event bus without throw; dispose cleans up', async () => {
    const lifecycle = new DisposeStack();
    const resources = {
      has: () => false,
      use: () => {
        throw new Error('missing resource');
      },
    };

    expect(() => {
      void plugin.setup?.({
        plugin: {
          id: 'activity-feedback',
          instanceKey: 'activity-feedback',
          root: 'activity-feedback',
          role: 'root',
        },
        config: { get: () => ({}) },
        resources: resources as never,
        lifecycle,
        handoff: {} as never,
      });
    }).not.toThrow();

    const received: string[] = [];
    const probe = (payload: { sessionId: string }) => {
      received.push(payload.sessionId);
    };
    activityFeedbackAiBus.on('ai.processing.start', probe as never);

    activityFeedbackAiBus.emit('ai.processing.start', {
      sessionId: 's1',
      source: 'zhin-agent',
    } as never);
    expect(received).toEqual(['s1']);

    await lifecycle.dispose();

    received.length = 0;
    activityFeedbackAiBus.emit('ai.processing.start', {
      sessionId: 's2',
      source: 'zhin-agent',
    } as never);
    expect(received).toEqual(['s2']);
    activityFeedbackAiBus.off('ai.processing.start', probe as never);
  });

  it('skips binding when enabled=false', async () => {
    const lifecycle = new DisposeStack();
    void plugin.setup?.({
      plugin: {
        id: 'activity-feedback',
        instanceKey: 'activity-feedback',
        root: 'activity-feedback',
        role: 'root',
      },
      config: { get: () => ({ enabled: false }) },
      resources: {
        has: () => false,
        use: () => {
          throw new Error('missing resource');
        },
      } as never,
      lifecycle,
      handoff: {} as never,
    });

    await expect(lifecycle.dispose()).resolves.toBeUndefined();
  });

  it('bindActivityFeedbackToAIEventBus dispose unsubscribes handlers', async () => {
    const startPhase = vi.fn().mockResolvedValue(undefined);
    const dispose = bindActivityFeedbackToAIEventBus({
      startPhase,
      stopPhase: vi.fn(),
      updateThinkingText: vi.fn(),
    } as never);

    dispose();

    activityFeedbackAiBus.emit('ai.activity.queued.start', {
      sessionId: 's1',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointId: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(startPhase).not.toHaveBeenCalled();
  });

  it('createActivityFeedbackOrchestratorForRuntime uses noop endpoint access by default', async () => {
    const orchestrator = createActivityFeedbackOrchestratorForRuntime(
      loadActivityFeedbackServiceConfig({}),
      { debug: vi.fn(), error: vi.fn() },
    );
    await expect(
      orchestrator.startPhase(
        {
          sessionId: 's1',
          source: 'zhin-agent',
          platform: 'sandbox',
          endpointId: 'bot',
          scope: 'private',
          sceneId: 'u1',
          hookContext: { activityFeedbackEligible: true },
        } as never,
        'active',
        'test',
      ),
    ).resolves.toBeUndefined();
  });
});
