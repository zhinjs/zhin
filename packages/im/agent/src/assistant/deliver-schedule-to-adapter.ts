/**
 * Schedule → adapter delivery helper — ADR 0039 P1.
 * Routes scheduled task output through proactive outbound / Adapter.sendMessage (D2).
 */
import type { JobNotify } from './types.js';
import {
  createNotificationRouter,
  type DeliverResult,
  type NotificationRouter,
  type NotificationRouterDeps,
} from './notification-router.js';
import type { ProactiveOutboundService } from '../outbound/send-proactive.js';

export interface DeliverScheduleToAdapterInput {
  notify: JobNotify;
  content: string;
  jobId?: string;
  label?: string;
  proactiveOutbound?: ProactiveOutboundService;
  router?: NotificationRouter;
  resolveAdapter?: NotificationRouterDeps['resolveAdapter'];
}

/**
 * Deliver schedule/cron task output to IM via the unified outbound chain.
 */
export async function deliverScheduleToAdapter(
  input: DeliverScheduleToAdapterInput,
): Promise<DeliverResult> {
  const { notify, content, jobId, label, proactiveOutbound } = input;
  if (notify.channel === 'im' && proactiveOutbound) {
    await proactiveOutbound.send(
      { scene: notify.target.scene, source: 'scheduled' },
      content,
    );
    return { delivered: true, channel: 'im' };
  }

  const router = input.router ?? (input.resolveAdapter
    ? createNotificationRouter({ resolveAdapter: input.resolveAdapter })
    : undefined);
  if (!router) {
    return { delivered: false, channel: notify.channel };
  }
  return router.deliver({ notify, content, jobId, label });
}
