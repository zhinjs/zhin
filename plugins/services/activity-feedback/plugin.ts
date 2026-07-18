import { definePlugin, outboundHostToken } from '@zhin.js/plugin-runtime';
import { getLogger } from '@zhin.js/logger';
import {
  loadActivityFeedbackServiceConfig,
  type ActivityFeedbackServiceConfig,
} from './src/config.js';
import {
  bindActivityFeedbackToAIEventBus,
  createActivityFeedbackOrchestratorForRuntime,
} from './src/ai-event-binder.js';
import {
  createNoopEndpointAccess,
  createOutboundEndpointAccess,
} from './src/executor.js';

const logger = getLogger('activity-feedback');

/**
 * Activity Feedback service — Plugin Runtime entry.
 *
 * Subscribes AI lifecycle events via `activityFeedbackAiBus`.
 * When Root provides `outboundHostToken`, typing/status text uses
 * ImRuntime.sendEndpointMessage; otherwise phases no-op.
 */
export default definePlugin<ActivityFeedbackServiceConfig>({
  name: 'activity-feedback',
  metadata: {
    displayName: 'Activity Feedback',
  },
  setup(context) {
    const serviceConfig = loadActivityFeedbackServiceConfig(context.config.get());
    if (serviceConfig.enabled === false) {
      return;
    }

    const access = context.resources.has(outboundHostToken)
      ? createOutboundEndpointAccess(context.resources.use(outboundHostToken), logger)
      : createNoopEndpointAccess();

    const orchestrator = createActivityFeedbackOrchestratorForRuntime(
      serviceConfig,
      logger,
      access,
    );
    const dispose = bindActivityFeedbackToAIEventBus(orchestrator);
    context.lifecycle.add(() => {
      logger.debug('[ActivityFeedback] Disposing Runtime AI event binder');
      dispose();
    });
  },
});
