import { reminderMessages as t } from '../../../../src/i18n.js';
import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { replyReminder } from "../../../../src/caller.js";
import { parseRelativeDelayMs } from "../../../../src/duration.js";
import { reminderServiceToken } from "../../../../src/runtime.js";
import {
  ReminderInputError,
  parseReminderInstant,
} from "../../../../src/service.js";
import { reminderActorFromTool } from "../../../../src/tool-actor.js";

export default defineAgentTool({
  description:
    "Create a personal reminder that delivers a message back to the current chat. " +
    "Use after (relative) or at (ISO with offset) for one-off; every_seconds for repeating. " +
    "Do NOT use this for agent re-invocation jobs — use schedule_add instead.",
  requiresApproval: "always",
  tags: ["reminder"],
  keywords: ["提醒", "reminder", "定时", "闹钟"],
  inputSchema: z.object({
    text: z.string().min(1).max(500).describe("Reminder message body"),
    after: z.string().optional().describe("Relative delay: 600, 10m, 2h, 1d"),
    at: z
      .string()
      .optional()
      .describe(
        "Absolute ISO time with Z or ±hh:mm, e.g. 2026-10-14T09:00:00+08:00"
      ),
    every_seconds: z
      .number()
      .int()
      .min(60)
      .max(365 * 24 * 60 * 60)
      .optional()
      .describe(
        "Repeat interval in seconds (min 60). First fire is now+interval."
      ),
  }),
  async execute({ text, after, at, every_seconds }, context) {
    return replyReminder(async () => {
      const modes = [
        after,
        at,
        every_seconds !== undefined ? "every" : undefined,
      ].filter(Boolean);
      if (modes.length !== 1) {
        throw new ReminderInputError(
          t(context.locale, 'toolMode')
        );
      }
      const service = context.use(reminderServiceToken);
      const actor = reminderActorFromTool(context);
      if (every_seconds !== undefined) {
        const intervalMs = every_seconds * 1000;
        const task = await service.add(
          actor,
          text,
          Date.now() + intervalMs,
          intervalMs
        );
        return `${t(context.locale, 'createdPeriodic')}\n${service.describe(task, context.locale)}`;
      }
      if (after) {
        const delayMs = parseRelativeDelayMs(after, context.locale);
        const task = await service.add(actor, text, Date.now() + delayMs, null);
        return `${t(context.locale, 'created')}\n${service.describe(task, context.locale)}`;
      }
      const task = await service.add(
        actor,
        text,
        parseReminderInstant(at!, context.locale),
        null
      );
      return `${t(context.locale, 'created')}\n${service.describe(task, context.locale)}`;
    });
  },
});
