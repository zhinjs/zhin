/**
 * @zhin.js/service-activity-feedback
 */
import { usePlugin } from 'zhin.js';
import {
  createActivityFeedbackOrchestratorFromPlugin,
  mountActivityFeedbackService,
} from './ai-event-binder.js';
import { loadActivityFeedbackServiceConfig, type ActivityFeedbackServiceConfig } from './config.js';

const plugin = usePlugin();
const { root, logger } = plugin;

const configService = root.inject('config');
const appConfig = configService?.getPrimary<{ activityFeedback?: ActivityFeedbackServiceConfig }>() || {};
const serviceConfig = loadActivityFeedbackServiceConfig(appConfig.activityFeedback);

if (serviceConfig.enabled !== false) {
  mountActivityFeedbackService(
    plugin,
    createActivityFeedbackOrchestratorFromPlugin(plugin, serviceConfig),
  );
} else {
  logger.debug('[ActivityFeedback] disabled by activityFeedback.enabled=false');
}

export {
  bindActivityFeedbackToAIEvents,
  createActivityFeedbackOrchestrator,
  createActivityFeedbackOrchestratorFromPlugin,
  mountActivityFeedbackService,
} from './ai-event-binder.js';
export { ActivityFeedbackOrchestrator } from './orchestrator.js';
export { ActivityFeedbackPolicy } from './policy.js';
export {
  loadActivityFeedbackServiceConfig,
  resolveActivityFeedbackForTarget,
  type ActivityFeedbackServiceConfig,
} from './config.js';
export type { ActivityFeedbackEndpointAccess } from './executor.js';
export default plugin;
