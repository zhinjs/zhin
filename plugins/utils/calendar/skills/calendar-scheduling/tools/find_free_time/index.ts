import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { findFreeSlots } from "../../../../src/free-time.js";
import { calendarRuntimeToken } from "../../../../src/runtime.js";
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
    const runtime = context.use(calendarRuntimeToken);
    if (!runtime.provider) return "日历未启用：请先配置 provider 与凭据";
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
      return `在工作时段（${runtime.config.work_day_start}-${runtime.config.work_day_end} ${timezone}）没有足够的空闲`;
    }
    return slots.map((slot) => `• ${slot.start} → ${slot.end}`).join("\n");
  },
});
