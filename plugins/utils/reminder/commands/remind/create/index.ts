import { defineCommand, type CommandMessage } from 'zhin.js/command';
import type { ReminderConfig } from '../../../src/config.js';
import { createPersonalReminder } from '../../../src/create-reminder.js';

const params = {
  when: { type: 'string', optional: true, max: 200, description: '提醒时间，例如 10分钟后、明天上午九点；含空格须加引号', descriptionI18n: { en: "Reminder time, such as in 10 minutes or tomorrow at 09:00; quote expressions containing spaces" } },
  text: { type: 'text', optional: true, max: 500, description: '个人提醒正文；缺省时会逐步补问', descriptionI18n: { en: "Personal reminder text; missing fields are requested step by step" } },
} as const;

export default defineCommand<ReminderConfig, string | undefined, CommandMessage, typeof params>({
  description: '逐步补全时间和正文，明确确认后创建一次性个人提醒', descriptionI18n: { en: "Complete the time and text, then explicitly confirm a one-time personal reminder" },
  params,
  execute: context => createPersonalReminder(context, context.params),
});
