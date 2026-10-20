/**
 * Schedule → adapter delivery helper — ADR 0039 P1.
 * Routes scheduled task output through NotificationRouter (unified outbound chain).
 */
import type { JobNotify } from './types.js';
import {
  type DeliverResult,
  type NotificationRouter,
} from './notification-router.js';

export interface DeliverScheduleToAdapterInput {
  notify: JobNotify;
  content: string;
  jobId?: string;
  label?: string;
  router: NotificationRouter;
  source?: string;
}

/**
 * Deliver schedule/cron task output to IM via the unified outbound chain.
 */
export async function deliverScheduleToAdapter(
  input: DeliverScheduleToAdapterInput,
): Promise<DeliverResult> {
  const { notify, content, jobId, label, source, router } = input;
  return router.deliver({ notify, content, jobId, label, source });
}
