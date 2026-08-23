import {
  subscribeAIEventsOnTarget,
  activityFeedbackAiBus,
  isActivityFeedbackEnabled,
  type AIEventHandlers,
  type AIEventPayload,
  type AIEventTarget,
} from '@zhin.js/agent';
import { loadActivityFeedbackServiceConfig, type ActivityFeedbackServiceConfig } from './config.js';
import type { GenerationAdmissionGate } from 'zhin.js';
import {
  ActivityFeedbackExecutor,
  createNoopEndpointAccess,
  type ActivityFeedbackEndpointAccess,
} from './executor.js';
import { ActivityFeedbackOrchestrator } from './orchestrator.js';
import { ActivityFeedbackPolicy } from './policy.js';

export function createActivityFeedbackAIEventHandlers(
  orchestrator: ActivityFeedbackOrchestrator,
): AIEventHandlers {
  return {
    onQueuedStart: (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'queued')) return;
      return orchestrator.startPhase(payload, 'queued', 'activity.queued.start');
    },
    onQueuedClear: (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'queued')) return;
      return orchestrator.stopPhase(payload, 'queued', 'activity.queued.clear');
    },

    onProcessingStart: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      await orchestrator.stopPhase(payload, 'queued', 'processing.start');
      if (typeof payload.iterations === 'number' && payload.iterations > 1) {
        await orchestrator.stopPhase(payload, 'thinking', 'processing.iteration');
      }
      await orchestrator.startPhase(payload, 'active', 'processing.start');
      if (typeof payload.iterations === 'number' && payload.iterations > 1 && payload.content?.trim()) {
        await orchestrator.updatePhaseText(payload, 'active', payload.content.trim());
      }
    },

    onTypingStart: async () => {},

    onProcessingFinish: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      if (payload.keepTyping) return;
      await orchestrator.stopPhase(payload, 'thinking', 'processing.finish');
      await orchestrator.stopPhase(payload, 'active', 'processing.finish');
    },

    onProcessingError: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      await orchestrator.stopPhase(payload, 'thinking', 'processing.error');
      await orchestrator.stopPhase(payload, 'active', 'processing.error');
    },

    onTypingStop: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      await orchestrator.stopPhase(payload, 'thinking', 'typing.stop');
      await orchestrator.stopPhase(payload, 'active', 'typing.stop');
    },

    onThinking: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'thinking')) return;
      if (!payload.thinking) return;
      await orchestrator.stopPhase(payload, 'active', 'thinking');
      await orchestrator.startPhase(payload, 'thinking', 'thinking');
      await orchestrator.updateThinkingText(payload, payload.thinking);
    },

    onToolCall: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active') || !payload.toolName?.trim()) return;
      const text = `调用工具：${payload.toolName.trim()}…`;
      await orchestrator.updatePhaseText(payload, 'thinking', text);
      await orchestrator.updatePhaseText(payload, 'active', text);
    },

    onToolResult: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active') || !payload.toolName?.trim()) return;
      const outcome = payload.status === 'error' || payload.error ? '未完成' : '已完成';
      const text = `工具 ${payload.toolName.trim()} ${outcome}，继续处理…`;
      await orchestrator.updatePhaseText(payload, 'thinking', text);
      await orchestrator.updatePhaseText(payload, 'active', text);
    },

    onSubagentStart: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'thinking')) return;
      // The subagent has an isolated session key; remove its own active placeholder
      // before switching to the richer thinking state.
      await orchestrator.stopPhase(payload, 'active', 'subagent.start');
      await orchestrator.startPhase(payload, 'thinking', 'subagent.start');
      const tag = payload.agentId?.trim() || 'subagent';
      const label = payload.label?.trim()
        ? `子任务执行中: ${payload.label.trim()}...`
        : '思考中...';
      await orchestrator.updateThinkingText(payload, `[${tag}] ${label}`);
    },

    onSubagentFinish: async (payload) => {
      if (isActivityFeedbackEnabled(payload, 'thinking')) {
        await orchestrator.stopPhase(payload, 'thinking', 'subagent.finish');
      }
      if (isActivityFeedbackEnabled(payload, 'active')) {
        await orchestrator.stopPhase(payload, 'active', 'subagent.finish');
      }
    },

    onScheduleStart: (payload) => orchestrator.startPhase(payload, 'schedule_start', 'schedule.start'),
    onScheduleFinish: async (payload) => {
      await orchestrator.stopPhase(payload, 'schedule_start', 'schedule.finish');
      await orchestrator.showTransientPhase(payload, 'schedule_finish', 'schedule.finish');
    },
    onScheduleError: async (payload) => {
      await orchestrator.stopPhase(payload, 'schedule_start', 'schedule.error');
      await orchestrator.showTransientPhase(payload, 'schedule_error', 'schedule.error');
    },
  };
}

/**
 * Plugin Runtime path: subscribe on module-level `activityFeedbackAiBus`
 * (fed by ZhinAgentEventEmitter.emit). No usePlugin / Adapter inject.
 */
export function bindActivityFeedbackToAIEventBus(
  orchestrator: ActivityFeedbackOrchestrator,
  admission: GenerationAdmissionGate,
  runWithView: <T>(operation: () => Promise<T>) => Promise<T>,
): () => Promise<void> {
  let stopWatchingRetirement: (() => void) | undefined;
  const watchRetirement = () => {
    if (stopWatchingRetirement) return;
    stopWatchingRetirement = admission.onDeactivate(() => {
      void close();
    });
  };
  const serialized = createGenerationSerializedTarget(
    activityFeedbackAiBus,
    admission,
    runWithView,
    watchRetirement,
  );
  const unsubscribe = subscribeAIEventsOnTarget(
    serialized.target,
    createActivityFeedbackAIEventHandlers(orchestrator),
  );
  let shutdown: Promise<void> | undefined;
  function close(): Promise<void> {
    if (shutdown) return shutdown;
    // Retirement is published before SnapshotStore changes its current pointer.
    // Enter the IM view synchronously here so timers, native-typing keepalives,
    // and final reaction/message cleanup all remain on this generation's Endpoint.
    shutdown = runWithView(async () => {
      unsubscribe();
      await serialized.close();
      await orchestrator.dispose();
    });
    return shutdown;
  }
  return async () => {
    stopWatchingRetirement?.();
    await close();
  };
}

/** Generation-local ordering: one queue per IM session, no module-level runtime state. */
function createGenerationSerializedTarget(
  source: AIEventTarget,
  admission: GenerationAdmissionGate,
  runWithView: <T>(operation: () => Promise<T>) => Promise<T>,
  onAdmitted: () => void,
): {
  target: AIEventTarget;
  close(): Promise<void>;
} {
  const tails = new Map<string, Promise<void>>();
  const wrappers = new Map<(payload: AIEventPayload) => void | Promise<void>,
    (payload: AIEventPayload) => Promise<void>>();
  let closed = false;
  const target: AIEventTarget = {
    on(event, listener) {
      const wrapped = async (payload: AIEventPayload) => {
        const release = admission.acquire();
        if (!release) return;
        onAdmitted();
        try {
          await runWithView(async () => {
            const key = payload.sessionId || '__global__';
            const previous = tails.get(key);
            const run = async () => {
              if (!closed) await listener(payload);
            };
            const current = previous
              ? previous.catch(() => undefined).then(run)
              : run();
            tails.set(key, current);
            try {
              await current;
            } finally {
              if (tails.get(key) === current) tails.delete(key);
            }
          });
        } finally {
          release();
        }
      };
      wrappers.set(listener, wrapped);
      return source.on(event, wrapped);
    },
    off(event, listener) {
      const wrapped = wrappers.get(listener);
      if (!wrapped) return source.off(event, listener);
      wrappers.delete(listener);
      return source.off(event, wrapped);
    },
  };
  return {
    target,
    async close() {
      closed = true;
      const pending = [...tails.values()];
      await Promise.allSettled(pending);
      tails.clear();
      wrappers.clear();
    },
  };
}

export type ActivityFeedbackLogger = {
  debug: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
};

export interface CreateActivityFeedbackOrchestratorOptions {
  serviceConfig: ActivityFeedbackServiceConfig;
  access: ActivityFeedbackEndpointAccess;
  logger: ActivityFeedbackLogger;
}

export function createActivityFeedbackOrchestrator(
  options: CreateActivityFeedbackOrchestratorOptions,
): ActivityFeedbackOrchestrator {
  const policy = new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig(options.serviceConfig));
  const executor = new ActivityFeedbackExecutor(options.access);
  return new ActivityFeedbackOrchestrator(policy, executor, options.logger);
}

/** Runtime: prefer OutboundHost-backed access; else noop until Host wires outbound. */
export function createActivityFeedbackOrchestratorForRuntime(
  serviceConfig: ActivityFeedbackServiceConfig,
  logger: ActivityFeedbackLogger,
  access: ActivityFeedbackEndpointAccess = createNoopEndpointAccess(),
): ActivityFeedbackOrchestrator {
  return createActivityFeedbackOrchestrator({
    serviceConfig,
    access,
    logger,
  });
}
