import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DisposeStack, type GenerationAdmissionGate } from 'zhin.js';
import { activityFeedbackAiBus } from '@zhin.js/agent';
import plugin from '../plugin.ts';
import { loadActivityFeedbackServiceConfig } from '../src/config.js';
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
    gate: {
      acquire: () => active ? () => undefined : undefined,
      onDeactivate(listener: () => void) {
        if (!active) {
          listener();
          return () => undefined;
        }
        deactivationListeners.add(listener);
        return () => { deactivationListeners.delete(listener); };
      },
    } as GenerationAdmissionGate,
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
      provide: vi.fn(),
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

    await activityFeedbackAiBus.dispatch('ai.processing.start', {
      sessionId: 's1',
      source: 'zhin-agent',
    } as never);
    expect(received).toEqual(['s1']);

    await lifecycle.dispose();

    received.length = 0;
    await activityFeedbackAiBus.dispatch('ai.processing.start', {
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
        provide: vi.fn(),
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
      dispose: vi.fn().mockResolvedValue(undefined),
    } as never, mutableAdmission(true).gate, runWithView);

    dispose();

    activityFeedbackAiBus.emit('ai.activity.queued.start', {
      sessionId: 's1',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
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
          endpointKey: 'bot',
          scope: 'private',
          sceneId: 'u1',
          hookContext: { activityFeedbackEligible: true },
        } as never,
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
    const handlers = createActivityFeedbackAIEventHandlers(orchestrator as never);
    const payload = {
      sessionId: 's1',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never;

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

    const schedulePayload = {
      ...payload,
      sessionId: 'schedule:job-1',
      hookContext: { scheduleJobId: 'job-1', scheduleActivityFeedback: true },
    } as never;
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
    const handlers = createActivityFeedbackAIEventHandlers(orchestrator as never);
    const payload = {
      sessionId: 'cancelled',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never;

    await handlers.onTypingStop?.(payload);

    expect(orchestrator.stopPhase).toHaveBeenNthCalledWith(
      1, payload, 'thinking', 'typing.stop',
    );
    expect(orchestrator.stopPhase).toHaveBeenNthCalledWith(
      2, payload, 'active', 'typing.stop',
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
      orchestrator as never,
      mutableAdmission(true).gate,
      runWithView,
    );
    const payload = {
      sessionId: 'ordered',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never;

    activityFeedbackAiBus.emit('ai.processing.start', payload);
    activityFeedbackAiBus.emit('ai.processing.finish', payload);
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
    const previousDispose = bindActivityFeedbackToAIEventBus({
      startPhase: previousStart,
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as never, previous.gate, runWithView);
    const candidateDispose = bindActivityFeedbackToAIEventBus({
      startPhase: candidateStart,
      stopPhase: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as never, candidate.gate, runWithView);
    const payload = {
      sessionId: 'hmr-event',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never;

    const dispatch = activityFeedbackAiBus.dispatch('ai.processing.start', payload);
    await Promise.resolve();
    previous.setActive(false);
    candidate.setActive(true);
    releasePrevious();
    await dispatch;

    expect(previousStart).toHaveBeenCalledOnce();
    expect(candidateStart).not.toHaveBeenCalled();
    await activityFeedbackAiBus.dispatch('ai.processing.start', payload);
    expect(previousStart).toHaveBeenCalledOnce();
    expect(candidateStart).toHaveBeenCalledOnce();
    await previousDispose();
    await candidateDispose();
  });

  it('starts full state cleanup in the retiring generation view', async () => {
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
      orchestrator as never,
      admission.gate,
      async (operation) => {
        enteredViews.push(currentView);
        return operation();
      },
    );
    const dispatch = activityFeedbackAiBus.dispatch('ai.processing.start', {
      sessionId: 'retiring-state',
      source: 'zhin-agent',
      platform: 'sandbox',
      endpointKey: 'bot',
      hookContext: { activityFeedbackEligible: true },
    } as never);
    await Promise.resolve();

    admission.setActive(false);
    currentView = 'new';
    expect(enteredViews).toEqual(['old', 'old']);
    expect(orchestrator.dispose).not.toHaveBeenCalled();

    releaseHandler();
    await dispatch;
    await dispose();
    expect(orchestrator.dispose).toHaveBeenCalledOnce();
  });
});
