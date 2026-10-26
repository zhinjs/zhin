import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';

export default defineCommand({
  description: '取消本人在当前会话的提醒', descriptionI18n: { en: "Cancel your reminder in this conversation" },
  params: { id: { type: 'string', description: 'remind list 中的任务 ID', descriptionI18n: { en: "Task ID from the reminder list" } } },
  async execute({ input, params, use, locale }) {
    return replyReminder(async () => await use(reminderServiceToken).cancel(reminderActor(input, locale), params.id) ? t(locale, 'cancelled') : t(locale, 'notFound'));
  },
});
