import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';
import { resolveReminderRef } from '../../../src/task-ref.js';

export default defineCommand({
  description: '取消本人在当前会话的提醒', descriptionI18n: { en: "Cancel your reminder in this conversation" },
  params: { id: { type: 'string', description: 'remind list 中的序号、任务 ID 或至少 6 位的 ID 前缀', descriptionI18n: { en: "Number from the reminder list, task ID, or an ID prefix of at least 6 characters" } } },
  async execute({ input, params, use, locale }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const actor = reminderActor(input, locale);
      const resolved = resolveReminderRef(await service.list(actor), params.id, locale);
      if (resolved.kind === 'error') return resolved.message;
      return await service.cancel(actor, resolved.task.id) ? t(locale, 'cancelled') : t(locale, 'notFound');
    });
  },
});
