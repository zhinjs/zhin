import { messages as t } from '../../../../src/i18n.js';
import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { calendarRuntimeToken } from "../../../../src/runtime.js";
import { runCalendarTool } from "../../../../src/tool-errors.js";
import { parseDateTimeInZone } from "../../../../src/time.js";

export default defineAgentTool({
  description:
    "Create a calendar event. Always confirm title, start, end and timezone with the user first.",
  requiresApproval: "always",
  permissions: ["role(master)"],
  tags: ["calendar"],
  keywords: ["创建日程", "约时间", "create event"],
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    start: z.string().describe("Start YYYY-MM-DDTHH:mm"),
    end: z.string().describe("End YYYY-MM-DDTHH:mm"),
    location: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    all_day: z.boolean().optional(),
  }),
  async execute(
    { title, start, end, location, description, all_day },
    context
  ) {
    return runCalendarTool(async () => {
      const runtime = context.use(calendarRuntimeToken);
      if (!runtime.provider) return t(context.locale, 'disabled');
      const timezone = runtime.config.timezone;
      const event = await runtime.provider.createEvent(
        {
          title,
          start: parseDateTimeInZone(start, timezone),
          end: parseDateTimeInZone(end, timezone),
          location,
          description,
          all_day,
        },
        context.signal
      );
      return t(context.locale, 'eventCreated', { id: event.id, title: event.title, start: event.start, end: event.end, timezone });
    }, context.locale);
  },
});
