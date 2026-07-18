import type { Plugin } from 'zhin.js';
import {
  subscribeAIEvents,
  subscribeAIEventsOnTarget,
  activityFeedbackAiBus,
  isActivityFeedbackEnabled,
  type AIEventHandlers,
} from '@zhin.js/agent';
import { loadActivityFeedbackServiceConfig, type ActivityFeedbackServiceConfig } from './config.js';
import {
  ActivityFeedbackExecutor,
  createNoopEndpointAccess,
  createRootEndpointAccess,
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
      await orchestrator.startPhase(payload, 'active', 'processing.start');
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

    onTypingStop: (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      return orchestrator.stopPhase(payload, 'active', 'typing.stop');
    },

    onThinking: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'thinking')) return;
      if (!payload.thinking) return;
      await orchestrator.stopPhase(payload, 'active', 'thinking');
      await orchestrator.startPhase(payload, 'thinking', 'thinking');
      await orchestrator.updateThinkingText(payload, payload.thinking);
    },

    onSubagentStart: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'thinking')) return;
      await orchestrator.stopPhase(payload, 'active', 'subagent.start');
      await orchestrator.startPhase(payload, 'thinking', 'subagent.start');
      const label = payload.label
        ? `🔍 子任务执行中: ${payload.label}...`
        : '🔍 子 agent 处理中...';
      await orchestrator.updateThinkingText(payload, label);
    },

    onSubagentFinish: async (payload) => {
      if (!isActivityFeedbackEnabled(payload, 'active')) return;
      await orchestrator.stopPhase(payload, 'thinking', 'subagent.finish');
      await orchestrator.startPhase(payload, 'active', 'subagent.finish');
    },

    onScheduleStart: (payload) => orchestrator.startPhase(payload, 'schedule_start', 'schedule.start'),
    onScheduleFinish: (payload) => orchestrator.stopPhase(payload, 'schedule_start', 'schedule.finish'),
    onScheduleError: async (payload) => {
      await orchestrator.stopPhase(payload, 'schedule_start', 'schedule.error');
      await orchestrator.startPhase(payload, 'schedule_error', 'schedule.error');
    },
  };
}

/** Legacy host Plugin path (ALS-aware subscribeAIEvents). */
export function bindActivityFeedbackToAIEvents(
  root: Plugin['root'],
  orchestrator: ActivityFeedbackOrchestrator,
): () => void {
  return subscribeAIEvents(root, createActivityFeedbackAIEventHandlers(orchestrator));
}

/**
 * Plugin Runtime path: subscribe on module-level `activityFeedbackAiBus`
 * (fed by ZhinAgentEventEmitter.emit). No usePlugin / Adapter inject.
 */
export function bindActivityFeedbackToAIEventBus(
  orchestrator: ActivityFeedbackOrchestrator,
): () => void {
  return subscribeAIEventsOnTarget(
    activityFeedbackAiBus,
    createActivityFeedbackAIEventHandlers(orchestrator),
  );
}

export function mountActivityFeedbackService(
  plugin: Plugin,
  orchestrator: ActivityFeedbackOrchestrator,
): void {
  const dispose = bindActivityFeedbackToAIEvents(plugin.root, orchestrator);
  plugin.onDispose(() => {
    plugin.logger.debug('[ActivityFeedback] Disposing binder');
    dispose();
  });
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

export function createActivityFeedbackOrchestratorFromPlugin(
  plugin: Plugin,
  serviceConfig: ActivityFeedbackServiceConfig,
): ActivityFeedbackOrchestrator {
  return createActivityFeedbackOrchestrator({
    serviceConfig,
    access: createRootEndpointAccess(plugin.root),
    logger: plugin.logger,
  });
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
