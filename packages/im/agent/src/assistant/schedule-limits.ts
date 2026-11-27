/**
 * Longest interval of an `every` job (#1250 b113): 365 days, the same bound as a one-shot job's
 * delay (`MAX_SCHEDULE_DELAY_MINUTES`). A larger one used to be stored and then fail: its next run
 * (`Date.now() + everyMs`) can pass the largest `Date` (8.64e15 ms) and become an Invalid Date.
 * The Console route (`MAX_SCHEDULE_EVERY_MS` in `packages/im/zhin/src/instance/console/assistant-job-routes.ts`)
 * and `zhin schedule` (`basic/cli/src/commands/schedule.ts`) refuse the same bound with the same
 * text; keep the three in step.
 */
export const MAX_SCHEDULE_EVERY_MS = 365 * 24 * 60 * 60_000;

/**
 * Why an `every` interval cannot be saved, or `undefined` when it can: a positive safe integer of
 * milliseconds at most {@link MAX_SCHEDULE_EVERY_MS}. Only the upper bound and a non-number are
 * refused here; a zero or negative interval stays "not schedulable" as before (`isRuntimeSchedulable`).
 */
export function scheduleEveryMsError(everyMs: unknown): string | undefined {
  if (typeof everyMs !== 'number' || Number.isNaN(everyMs)) {
    return `执行间隔（everyMs）必须是整数毫秒，收到: ${String(everyMs)}`;
  }
  if (everyMs > MAX_SCHEDULE_EVERY_MS || !Number.isFinite(everyMs)) {
    return `执行间隔（everyMs）最多 365 天，收到: ${String(everyMs)}`;
  }
  return undefined;
}
