import { messages as t } from '../../../../src/i18n.js';
import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { findFreeSlots } from "../../../../src/free-time.js";
import { calendarRuntimeToken } from "../../../../src/runtime.js";
import { runCalendarTool } from "../../../../src/tool-errors.js";
import { parseDateTimeInZone } from "../../../../src/time.js";

export default defineAgentTool({
  description:
    "Find free slots of a given duration inside work hours between two datetimes.",
  requiresApproval: "never",
  tags: ["calendar"],
  keywords: ["空闲", "free time", "有空"],
  inputSchema: z.object({
    from: z.string(),
    to: z.string(),
    duration_minutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
  }),
  async execute({ from, to, duration_minutes }, context) {
    return runCalendarTool(async () => {
      const runtime = context.use(calendarRuntimeToken);
      if (!runtime.provider) return t(context.locale, 'disabled');
      const timezone = runtime.config.timezone;
      const fromDate = parseDateTimeInZone(from, timezone);
      const toDate = parseDateTimeInZone(to, timezone);
      const events = await runtime.provider.listEvents(
        fromDate,
        toDate,
        context.signal
      );
      const slots = findFreeSlots({
        from: fromDate,
        to: toDate,
        durationMinutes: duration_minutes,
        workDayStart: runtime.config.work_day_start,
        workDayEnd: runtime.config.work_day_end,
        timezone,
        events,
      });
      if (slots.length === 0) {
        return t(context.locale, 'noFreeTime', { start: runtime.config.work_day_start, end: runtime.config.work_day_end, timezone });
      }
      return slots.map((slot) => `• ${slot.start} → ${slot.end}`).join("\n");
    }, context.locale);
  },
});
