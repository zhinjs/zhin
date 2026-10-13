import { defineCommand, type CommandParameterValue } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';
import { parseReminderInstant } from '../../../src/service.js';

export default defineCommand({
  description: '创建绝对时间提醒',
  params: { time: { type: 'string', description: '包含 Z 或 ±hh:mm 的 ISO 时间', validate: (value: CommandParameterValue) => { try { parseReminderInstant(String(value)); return true; } catch { return '绝对时间须为有效的 ISO 时间并包含时区 offset'; } } }, text: { type: 'text', min: 1, max: 500, description: '提醒内容' } },
  async execute({ input, params, use }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const task = await service.add(reminderActor(input), params.text, parseReminderInstant(params.time), null);
      return `已创建提醒\n${service.describe(task)}`;
    });
  },
});
