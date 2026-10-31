import {
  subscribeAIEventsOnTarget,
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
import { isLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './messages.js';

export function createActivityFeedbackAIEventHandlers(
  orchestrator: ActivityFeedbackOrchestrator,
  defaultLocale: Locale = 'zh-CN',
): AIEventHandlers {
  const locale = (payload: AIEventPayload) => isLocale(payload.locale) ? payload.locale : defaultLocale;
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
      if (typeof payload.iterations === 'number' && payload.iterations > 1) {
        const progress = payload.iterationProgress;
        const text = payload.content?.trim() || (progress
          ? t(locale(payload), 'iteration', { iteration: progress.current, maxIterations: progress.total })
          : undefined);
        if (text) await orchestrator.updatePhaseText(payload, 'active', text);
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
      const text = t(locale(payload), 'toolCall', { tool: payload.toolName.trim() });
      await orchestrator.updatePhaseText(payload, 'thinking', text);
      await orchestrator.updatePhaseText(payload, 'active', text);
    },

    onToolResult: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active') || !payload.toolName?.trim()) return;
      const text = t(locale(payload), payload.status === 'error' || payload.error ? 'toolIncomplete' : 'toolDone', { tool: payload.toolName.trim() });
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
        ? t(locale(payload), 'subtask', { label: payload.label.trim() })
        : t(locale(payload), 'thinking');
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
 * Plugin Runtime path: subscribe to the generation-owned Agent event bus.
 */
export function bindActivityFeedbackToAIEventBus(
  source: AIEventTarget,
  orchestrator: ActivityFeedbackOrchestrator,
  admission: GenerationAdmissionGate,
  runWithView: <T>(operation: () => Promise<T>) => Promise<T>,
  defaultLocale: Locale = 'zh-CN',
): () => Promise<void> {
  const serialized = createGenerationSerializedTarget(
    source,
    admission,
    runWithView,
  );
  const unsubscribe = subscribeAIEventsOnTarget(
    serialized.target,
    createActivityFeedbackAIEventHandlers(orchestrator, defaultLocale),
  );
  let shutdown: Promise<void> | undefined;
  function close(): Promise<void> {
    if (shutdown) return shutdown;
    const cleanup = async () => {
      unsubscribe();
      await serialized.close();
      await orchestrator.dispose();
    };
    // Live indicators already own captured operations. Cleanup never acquires a
    // latest generation view or a new call through a retired facade.
    shutdown = cleanup();
    return shutdown;
  }
  return close;
}

/** Generation-local ordering: one queue per IM session, no module-level runtime state. */
function createGenerationSerializedTarget(
  source: AIEventTarget,
  admission: GenerationAdmissionGate,
  runWithView: <T>(operation: () => Promise<T>) => Promise<T>,
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
  defaultLocale?: Locale;
  serviceConfig: ActivityFeedbackServiceConfig;
  access: ActivityFeedbackEndpointAccess;
  logger: ActivityFeedbackLogger;
}

export function createActivityFeedbackOrchestrator(
  options: CreateActivityFeedbackOrchestratorOptions,
): ActivityFeedbackOrchestrator {
  const policy = new ActivityFeedbackPolicy(loadActivityFeedbackServiceConfig(options.serviceConfig));
  const executor = new ActivityFeedbackExecutor(options.access);
  return new ActivityFeedbackOrchestrator(policy, executor, options.logger, options.defaultLocale);
}

/** Runtime: prefer OutboundHost-backed access; else noop until Host wires outbound. */
export function createActivityFeedbackOrchestratorForRuntime(
  serviceConfig: ActivityFeedbackServiceConfig,
  logger: ActivityFeedbackLogger,
  access: ActivityFeedbackEndpointAccess = createNoopEndpointAccess(),
  defaultLocale: Locale = 'zh-CN',
): ActivityFeedbackOrchestrator {
  return createActivityFeedbackOrchestrator({
    serviceConfig,
    access,
    logger,
    defaultLocale,
  });
}
