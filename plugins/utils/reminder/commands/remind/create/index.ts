import { defineCommand, type CommandMessage } from 'zhin.js/command';
import type { ReminderConfig } from '../../../src/config.js';
import { createPersonalReminder } from '../../../src/create-reminder.js';

const params = {
  when: { type: 'string', optional: true, max: 200, description: '提醒时间，例如 10分钟后、明天上午九点；含空格须加引号' },
  text: { type: 'text', optional: true, max: 500, description: '个人提醒正文；缺省时会逐步补问' },
} as const;

export default defineCommand<ReminderConfig, string | undefined, CommandMessage, typeof params>({
  description: '逐步补全时间和正文，明确确认后创建一次性个人提醒',
  params,
  execute: context => createPersonalReminder(context, context.params),
});
