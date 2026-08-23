import {
  createGenerationAdmissionGate,
  createToken,
  definePlugin,
  outboundHostToken,
  type GenerationAdmissionGate,
} from 'zhin.js';
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
  createOutboundEndpointAccess,
} from './src/executor.js';

const logger = getLogger('activity-feedback');
const activityFeedbackAdmissionToken = createToken<GenerationAdmissionGate>(
  'zhin.activity-feedback.generation-admission',
);

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

    const outbound = context.resources.has(outboundHostToken)
      ? context.resources.use(outboundHostToken)
      : undefined;
    if (!outbound || typeof outbound.runWithView !== 'function') {
      logger.debug(
        '[ActivityFeedback] disabled: OutboundHost with generation-bound runWithView is required',
      );
      return;
    }
    const access = createOutboundEndpointAccess(outbound, logger);

    const orchestrator = createActivityFeedbackOrchestratorForRuntime(
      serviceConfig,
      logger,
      access,
    );
    const admission = createGenerationAdmissionGate();
    context.resources.provide(activityFeedbackAdmissionToken, admission);
    const dispose = bindActivityFeedbackToAIEventBus(
      orchestrator,
      admission,
      outbound.runWithView.bind(outbound),
    );
    context.lifecycle.add(async () => {
      logger.debug('[ActivityFeedback] Disposing Runtime AI event binder');
      await dispose();
    });
  },
});
