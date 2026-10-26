import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';

export default defineCommand({
  description: '查看本人在当前会话的提醒', descriptionI18n: { en: "List your reminders in this conversation" },
  async execute({ input, use, locale }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const tasks = await service.list(reminderActor(input, locale));
      return tasks.length ? tasks.map(task => service.describe(task, locale)).join('\n\n') : t(locale, 'empty');
    });
  },
});
