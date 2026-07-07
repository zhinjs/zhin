import type { Plugin } from 'zhin.js';
import { subscribeAIEvents } from '@zhin.js/agent';
import type { ActivityFeedbackServiceConfig } from './config.js';
import {
  ActivityFeedbackExecutor,
  createRootEndpointAccess,
  type ActivityFeedbackEndpointAccess,
} from './executor.js';
import { ActivityFeedbackOrchestrator } from './orchestrator.js';
import { ActivityFeedbackPolicy } from './policy.js';
import { loadActivityFeedbackServiceConfig } from './config.js';

export function bindActivityFeedbackToAIEvents(
  root: Plugin['root'],
  orchestrator: ActivityFeedbackOrchestrator,
): () => void {
  return subscribeAIEvents(root, {
    onQueuedStart: (payload) => orchestrator.startPhase(payload, 'queued', 'activity.queued.start'),
    onQueuedClear: (payload) => orchestrator.stopPhase(payload, 'queued', 'activity.queued.clear'),

    onProcessingStart: async (payload) => {
      await orchestrator.stopPhase(payload, 'queued', 'processing.start');
      await orchestrator.startPhase(payload, 'active', 'processing.start');
    },

    onTypingStart: async () => {},

    onProcessingFinish: async (payload) => {
      if (payload.keepTyping) return;
      await orchestrator.stopPhase(payload, 'thinking', 'processing.finish');
      await orchestrator.stopPhase(payload, 'active', 'processing.finish');
    },

    onProcessingError: async (payload) => {
      await orchestrator.stopPhase(payload, 'thinking', 'processing.error');
      await orchestrator.stopPhase(payload, 'active', 'processing.error');
    },

    onTypingStop: (payload) => orchestrator.stopPhase(payload, 'active', 'typing.stop'),

    onThinking: async (payload) => {
      if (!payload.thinking) return;
      await orchestrator.stopPhase(payload, 'active', 'thinking');
      await orchestrator.startPhase(payload, 'thinking', 'thinking');
      await orchestrator.updateThinkingText(payload, payload.thinking);
    },

    onSubagentStart: async (payload) => {
      await orchestrator.stopPhase(payload, 'active', 'subagent.start');
      await orchestrator.startPhase(payload, 'thinking', 'subagent.start');
      const label = payload.label
        ? `🔍 子任务执行中: ${payload.label}...`
        : '🔍 子 agent 处理中...';
      await orchestrator.updateThinkingText(payload, label);
    },

    onSubagentFinish: async (payload) => {
      await orchestrator.stopPhase(payload, 'thinking', 'subagent.finish');
      await orchestrator.startPhase(payload, 'active', 'subagent.finish');
    },
  });
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

export interface CreateActivityFeedbackOrchestratorOptions {
  serviceConfig: ActivityFeedbackServiceConfig;
  access: ActivityFeedbackEndpointAccess;
  logger: Plugin['logger'];
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
