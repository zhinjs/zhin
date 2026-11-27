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
 * Why an `every` interval cannot be saved, or `undefined` when it can. This is only the shared upper
 * bound (#1250 b113): a non-number (`NaN` and `-Infinity` included) and an interval of more than 365 days
 * ({@link MAX_SCHEDULE_EVERY_MS}, `Infinity` included) are refused. Positive and whole values are each
 * caller's check: the Console route requires a safe integer of at least 1000, `zhin schedule --every`
 * parses at least one second, `validateAssistantProfile` reports a heartbeat that is not positive, and
 * `TimerScheduler` keeps a zero or negative interval "not schedulable" (`isRuntimeSchedulable`) as before;
 * a fractional interval is run as is by the kernel `ScheduleEngine`.
 */
export function scheduleEveryMsError(everyMs: unknown): string | undefined {
  if (typeof everyMs !== 'number' || Number.isNaN(everyMs) || everyMs === Number.NEGATIVE_INFINITY) {
    return `执行间隔（everyMs）必须是毫秒数，收到: ${String(everyMs)}`;
  }
  if (everyMs > MAX_SCHEDULE_EVERY_MS) {
    return `执行间隔（everyMs）最多 365 天，收到: ${String(everyMs)}`;
  }
  return undefined;
}
