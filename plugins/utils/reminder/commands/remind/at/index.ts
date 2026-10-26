import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand, type CommandParameterValue } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';
import { parseReminderInstant } from '../../../src/service.js';

export default defineCommand({
  description: '创建绝对时间提醒', descriptionI18n: { en: "Create a reminder at an absolute time" },
  params: { time: { type: 'string', description: '包含 Z 或 ±hh:mm 的 ISO 时间', descriptionI18n: { en: "ISO timestamp with Z or an explicit ±hh:mm offset" }, validate: (value: CommandParameterValue) => { try { parseReminderInstant(String(value)); return true; } catch { return false; } } }, text: { type: 'text', min: 1, max: 500, description: '提醒内容', descriptionI18n: { en: "Reminder text" } } },
  async execute({ input, params, use, locale }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const task = await service.add(reminderActor(input, locale), params.text, parseReminderInstant(params.time, locale), null);
      return `${t(locale, 'created')}\n${service.describe(task, locale)}`;
    });
  },
});
