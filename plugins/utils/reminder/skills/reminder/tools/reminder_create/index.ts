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
  async execute(input, context) {
    return replyReminder(async () => {
      const modes = [
        input.after,
        input.at,
        input.every_seconds !== undefined ? "every" : undefined,
      ].filter(Boolean);
      if (modes.length !== 1) {
        throw new ReminderInputError(
          "请在 after / at / every_seconds 中只选一种时间表达"
        );
      }
      const service = context.use(reminderServiceToken);
      const actor = reminderActorFromTool(context);
      if (input.every_seconds !== undefined) {
        const intervalMs = input.every_seconds * 1000;
        const task = await service.add(
          actor,
          input.text,
          Date.now() + intervalMs,
          intervalMs
        );
        return `已创建周期提醒\n${service.describe(task)}`;
      }
      if (input.after) {
        const delayMs = parseRelativeDelayMs(input.after);
        const task = await service.add(
          actor,
          input.text,
          Date.now() + delayMs,
          null
        );
        return `已创建提醒\n${service.describe(task)}`;
      }
      const task = await service.add(
        actor,
        input.text,
        parseReminderInstant(input.at!),
        null
      );
      return `已创建提醒\n${service.describe(task)}`;
    });
  },
});
