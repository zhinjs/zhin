import type { AIEventPayload } from '../ai-event-subscriber.js';

export type ActivityFeedbackGatePhase =
  | 'queued'
  | 'thinking'
  | 'active'
  | 'schedule_start'
  | 'schedule_finish'
  | 'schedule_error';

function readHook(payload: AIEventPayload): Record<string, unknown> {
  const ctx = payload.hookContext;
  return ctx && typeof ctx === 'object' ? ctx as Record<string, unknown> : {};
}

function isScheduleTurn(hook: Record<string, unknown>): boolean {
  return hook.scheduleJobId != null
    || hook.schedulePreview === true
    || hook.scheduleCreatedBy != null;
}

/**
 * 手动 turn：activityFeedbackEligible===true → queued/thinking/active；
 * Schedule turn：仅 scheduleActivityFeedback===true → schedule 三相位。
 */
export function isActivityFeedbackEnabled(
  payload: AIEventPayload,
  phase: ActivityFeedbackGatePhase,
): boolean {
  const hook = readHook(payload);
  const scheduleTurn = isScheduleTurn(hook);
  const scheduleAf = hook.scheduleActivityFeedback === true;
  const manualEligible = hook.activityFeedbackEligible === true;

  if (phase === 'schedule_start' || phase === 'schedule_finish' || phase === 'schedule_error') {
    return scheduleTurn && scheduleAf;
  }

  if (scheduleTurn) return false;
  return manualEligible;
}
