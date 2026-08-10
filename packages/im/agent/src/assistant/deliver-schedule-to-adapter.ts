/**
 * Schedule → adapter delivery helper — ADR 0039 P1.
 * Routes scheduled task output through NotificationRouter (unified outbound chain).
 */
import type { JobNotify } from './types.js';
import {
  createNotificationRouter,
  type DeliverResult,
  type NotificationRouter,
  type NotificationRouterDeps,
} from './notification-router.js';

export interface DeliverScheduleToAdapterInput {
  notify: JobNotify;
  content: string;
  jobId?: string;
  label?: string;
  router?: NotificationRouter;
  /** @deprecated 仅用于未注入 router 时的回退构造 */
  resolveAdapter?: NotificationRouterDeps['resolveAdapter'];
  source?: string;
}

/**
 * Deliver schedule/cron task output to IM via the unified outbound chain.
 */
export async function deliverScheduleToAdapter(
  input: DeliverScheduleToAdapterInput,
): Promise<DeliverResult> {
  const { notify, content, jobId, label, source } = input;
  const router = input.router ?? (input.resolveAdapter
    ? createNotificationRouter({ resolveAdapter: input.resolveAdapter })
    : undefined);
  if (!router) {
    return { delivered: false, channel: notify.channel };
  }
  return router.deliver({ notify, content, jobId, label, source });
}
