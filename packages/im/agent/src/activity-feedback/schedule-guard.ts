import type { AIEventPayload } from '../ai-event-subscriber.js';

/** 调度/预演 turn 默认不触发 activity feedback，除非显式开启 */
export function isScheduleActivityFeedbackEnabled(payload: AIEventPayload): boolean {
  const ctx = payload.hookContext;
  if (!ctx || typeof ctx !== 'object') return true;
  const record = ctx as Record<string, unknown>;
  const isScheduleContext = record.scheduleJobId != null
    || record.schedulePreview === true
    || record.scheduleCreatedBy != null;
  if (!isScheduleContext) return true;
  return record.scheduleActivityFeedback === true;
}
