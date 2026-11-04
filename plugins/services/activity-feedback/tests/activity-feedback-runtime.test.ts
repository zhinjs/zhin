import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { GenerationAdmissionGate } from 'zhin.js';
import { createFakePlugin, fakeOf, fakeResource } from '@zhin.js/testing';
import { AgentEventBus, type AIEventPayload } from '@zhin.js/agent';
import { agentEventBusToken } from '@zhin.js/agent/runtime';
import plugin from '../plugin.ts';
import type { ActivityFeedbackOrchestrator } from '../src/orchestrator.js';
import { loadActivityFeedbackServiceConfig, type ActivityFeedbackServiceConfig } from '../src/config.js';
import {
  bindActivityFeedbackToAIEventBus,
  createActivityFeedbackAIEventHandlers,
  createActivityFeedbackOrchestratorForRuntime,
} from '../src/ai-event-binder.js';

function mutableAdmission(initial: boolean): {
  gate: GenerationAdmissionGate;
  setActive(active: boolean): void;
} {
  let active = initial;
  const deactivationListeners = new Set<() => void>();
  return {
    gate: fakeOf<GenerationAdmissionGate>({
      acquire: () => active ? () => undefined : undefined,
      onDeactivate(listener: () => void) {
        if (!active) {
          listener();
          return () => undefined;
        }
        deactivationListeners.add(listener);
        return () => { deactivationListeners.delete(listener); };
      },
    }),
    setActive(next) {
      const wasActive = active;
      active = next;
      if (wasActive && !next) {
        for (const listener of [...deactivationListeners]) listener();
      }
    },
  };
}

const runWithView = <T>(operation: () => Promise<T>): Promise<T> => operation();

describe('@zhin.js/service-activity-feedback runtime', () => {
  const events = new AgentEventBus();
  beforeEach(() => {
    events.clear();
  });

  afterEach(() => {
    events.clear();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('activity-feedback');
  });

  it('loads default service config', () => {
    const cfg = loadActivityFeedbackServiceConfig({});
    expect(cfg.enabled).not.toBe(false);
  });

  it('setup binds AI event bus without throw; dispose cleans up', async () => {
    const fake = createFakePlugin<ActivityFeedbackServiceConfig>({
      name: 'activity-feedback',
      config: {},
      resources: [fakeResource(agentEventBusToken, events)],
    });

    await expect(fake.setup(plugin)).resolves.toBeUndefined();

    const received: string[] = [];
    const probe = (payload: AIEventPayload) => {
      received.push(payload.sessionId);
    };
    events.on('ai.processing.start', probe);

    await events.dispatch('ai.processing.start', fakeOf<AIEventPayload>({
      sessionId: 's1',
      source: 'zhin-agent',
    }));
    expect(received).toEqual(['s1']);

    await fake.dispose();

    received.length = 0;
    await events.dispatch('ai.processing.start', fakeOf<AIEventPayload>({
      sessionId: 's2',
      source: 'zhin-agent',
    }));
    expect(received).toEqual(['s2']);
    events.off('ai.processing.start', probe);
  });

  it('skips binding when enabled=false', async () => {
    const fake = createFakePlugin<ActivityFeedbackServiceConfig>({
      name: 'activity-feedback',
      config: { enabled: false },
      hosts: { database: false, schedule: false, outbound: false },
    });
    await fake.setup(plugin);

    await expect(fake.dispose()).resolves.toBeUndefined();
  });

  it('bindActivityFeedbackToAIEventBus dispose unsubscribes handlers', async () => {
    const startPhase = vi.fn().mockResolvedValue(undefined);
    const dispose = bindActivityFeedbackToAIEventBus(events, fakeOf<ActivityFeedbackOrchestrator>({
      startPhase,
      stopPhase: vi.fn(),
      updateThinkingText: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    }), mutableAdmission(true).gate, runWithView);

    dispose();

    events.emit('ai.activity.queued.start', fakeOf<AIEventPayload>({
      sessionId: 's1',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(startPhase).not.toHaveBeenCalled();
  });

  it('rolls back an unactivated binder without entering a generation view', async () => {
    const orchestrator = {
      startPhase: vi.fn(),
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const runWithUnavailableView = vi.fn(async () => {
      throw new Error('Root is not accepting generation operations (idle)');
    });
    const dispose = bindActivityFeedbackToAIEventBus(
      events,
      fakeOf<ActivityFeedbackOrchestrator>(orchestrator),
      mutableAdmission(false).gate,
      runWithUnavailableView,
    );

    await expect(dispose()).resolves.toBeUndefined();
    expect(runWithUnavailableView).not.toHaveBeenCalled();
    expect(orchestrator.dispose).toHaveBeenCalledOnce();
  });

  it('createActivityFeedbackOrchestratorForRuntime uses noop endpoint access by default', async () => {
    const orchestrator = createActivityFeedbackOrchestratorForRuntime(
      loadActivityFeedbackServiceConfig({}),
      { debug: vi.fn(), error: vi.fn() },
    );
    await expect(
      orchestrator.startPhase(
        fakeOf<AIEventPayload>({
          sessionId: 's1',
          source: 'zhin-agent',
          platform: 'sandbox',
          endpointKey: 'bot',
          scope: 'private',
          sceneId: 'u1',
          hookContext: { activityFeedbackEligible: true },
        }),
        'active',
        'test',
      ),
    ).resolves.toBeUndefined();
  });

  it('updates task/tool progress and shows transient schedule terminal states', async () => {
    const orchestrator = {
      startPhase: vi.fn().mockResolvedValue(undefined),
      stopPhase: vi.fn().mockResolvedValue(undefined),
      updatePhaseText: vi.fn().mockResolvedValue(undefined),
      showTransientPhase: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createActivityFeedbackAIEventHandlers(fakeOf<ActivityFeedbackOrchestrator>(orchestrator));
    const payload = fakeOf<AIEventPayload>({
      sessionId: 's1',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    });

    await handlers.onProcessingStart?.({ ...payload, iterations: 2, content: '处理中 [2/15]...' });
    await handlers.onToolCall?.({ ...payload, toolName: 'web_search' });
    await handlers.onToolResult?.({ ...payload, toolName: 'web_search' });
    await handlers.onToolResult?.({
      ...payload,
      toolName: 'shell',
      status: 'error',
      error: 'denied',
    });

    expect(orchestrator.updatePhaseText).toHaveBeenCalledWith(
      expect.anything(), 'active', '处理中 [2/15]...',
    );
    expect(orchestrator.stopPhase).toHaveBeenCalledWith(
      expect.anything(), 'thinking', 'processing.iteration',
    );
    expect(orchestrator.updatePhaseText).toHaveBeenCalledWith(
      expect.anything(), 'active', '调用工具：web_search…',
    );
    expect(orchestrator.updatePhaseText).toHaveBeenCalledWith(
      expect.anything(), 'active', '工具 web_search 已完成，继续处理…',
    );
    expect(orchestrator.updatePhaseText).toHaveBeenCalledWith(
      expect.anything(), 'active', '工具 shell 未完成，继续处理…',
    );

    const schedulePayload = fakeOf<AIEventPayload>({
      ...payload,
      sessionId: 'schedule:job-1',
      hookContext: { scheduleJobId: 'job-1', scheduleActivityFeedback: true },
    });
    await handlers.onScheduleFinish?.(schedulePayload);
    await handlers.onScheduleError?.(schedulePayload);
    expect(orchestrator.showTransientPhase).toHaveBeenCalledWith(
      schedulePayload, 'schedule_finish', 'schedule.finish',
    );
    expect(orchestrator.showTransientPhase).toHaveBeenCalledWith(
      schedulePayload, 'schedule_error', 'schedule.error',
    );
  });

  it('typing.stop clears both active and thinking states', async () => {
    const orchestrator = {
      stopPhase: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createActivityFeedbackAIEventHandlers(fakeOf<ActivityFeedbackOrchestrator>(orchestrator));
    const payload = fakeOf<AIEventPayload>({
      sessionId: 'cancelled',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    });

    await handlers.onTypingStop?.(payload);

    expect(orchestrator.stopPhase).toHaveBeenNthCalledWith(
      1, payload, 'thinking', 'typing.stop',
    );
    expect(orchestrator.stopPhase).toHaveBeenNthCalledWith(
      2, payload, 'active', 'typing.stop',
    );
  });

  it('subagent finish independently clears thinking and active phases', async () => {
    const orchestrator = {
      stopPhase: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createActivityFeedbackAIEventHandlers(fakeOf<ActivityFeedbackOrchestrator>(orchestrator));
    const payload = fakeOf<AIEventPayload>({
      sessionId: 'subagent:thinking-only',
      source: 'subagent',
      agentId: 'researcher',
      hookContext: {
        activityFeedbackEligible: true,
      },
    });

    await handlers.onSubagentFinish?.(payload);

    expect(orchestrator.stopPhase).toHaveBeenCalledWith(
      payload, 'thinking', 'subagent.finish',
    );
    expect(orchestrator.stopPhase).toHaveBeenCalledWith(
      payload, 'active', 'subagent.finish',
    );
  });

  it('serializes start/finish handlers inside one plugin generation', async () => {
    const order: string[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => { finished = resolve; });
    const orchestrator = {
      startPhase: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('start');
      }),
      stopPhase: vi.fn(async (_payload, phase: string) => {
        if (phase === 'active') {
          order.push('finish');
          finished();
        }
      }),
      updatePhaseText: vi.fn(),
      updateThinkingText: vi.fn(),
      showTransientPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const dispose = bindActivityFeedbackToAIEventBus(
      events,
      fakeOf<ActivityFeedbackOrchestrator>(orchestrator),
      mutableAdmission(true).gate,
      runWithView,
    );
    const payload = fakeOf<AIEventPayload>({
      sessionId: 'ordered',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    });

    events.emit('ai.processing.start', payload);
    events.emit('ai.processing.finish', payload);
    await done;

    expect(order).toEqual(['start', 'finish']);
    dispose();
  });

  it('admits an event only to the generation active when dispatch begins', async () => {
    const previous = mutableAdmission(true);
    const candidate = mutableAdmission(false);
    let releasePrevious!: () => void;
    const pendingPrevious = new Promise<void>((resolve) => { releasePrevious = resolve; });
    const previousStart = vi.fn(() => pendingPrevious);
    const candidateStart = vi.fn().mockResolvedValue(undefined);
    const previousDispose = bindActivityFeedbackToAIEventBus(events, fakeOf<ActivityFeedbackOrchestrator>({
      startPhase: previousStart,
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    }), previous.gate, runWithView);
    const candidateDispose = bindActivityFeedbackToAIEventBus(events, fakeOf<ActivityFeedbackOrchestrator>({
      startPhase: candidateStart,
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    }), candidate.gate, runWithView);
    const payload = fakeOf<AIEventPayload>({
      sessionId: 'hmr-event',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    });

    const dispatch = events.dispatch('ai.processing.start', payload);
    await Promise.resolve();
    previous.setActive(false);
    candidate.setActive(true);
    releasePrevious();
    await dispatch;

    expect(previousStart).toHaveBeenCalledOnce();
    expect(candidateStart).not.toHaveBeenCalled();
    await events.dispatch('ai.processing.start', payload);
    expect(previousStart).toHaveBeenCalledOnce();
    expect(candidateStart).toHaveBeenCalledOnce();
    await previousDispose();
    await candidateDispose();
  });

  it('finishes an accepted handler after admission closes and cleans captured state without re-entering a retired view', async () => {
    const admission = mutableAdmission(true);
    let currentView = 'old';
    const enteredViews: string[] = [];
    let releaseHandler!: () => void;
    const handlerPending = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const orchestrator = {
      startPhase: vi.fn(() => handlerPending),
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const dispose = bindActivityFeedbackToAIEventBus(
      events,
      fakeOf<ActivityFeedbackOrchestrator>(orchestrator),
      admission.gate,
      async (operation) => {
        enteredViews.push(currentView);
        return operation();
      },
    );
    const dispatch = events.dispatch('ai.processing.start', fakeOf<AIEventPayload>({
      sessionId: 'retiring-state',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    }));
    await Promise.resolve();

    admission.setActive(false);
    currentView = 'new';
    expect(enteredViews).toEqual(['old']);
    expect(orchestrator.dispose).not.toHaveBeenCalled();

    releaseHandler();
    await dispatch;
    await dispose();
    expect(orchestrator.dispose).toHaveBeenCalledOnce();
    expect(enteredViews).toEqual(['old']);
  });
});
