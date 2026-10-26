import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';
import { MAX_DELAY_SECONDS } from '../../../src/service.js';

export default defineCommand({
  description: '创建一次性延迟提醒', descriptionI18n: { en: "Create a one-time reminder after a delay" },
  params: { seconds: { type: 'integer', min: 1, max: MAX_DELAY_SECONDS, description: '延迟秒数', descriptionI18n: { en: "Delay in seconds" } }, text: { type: 'text', min: 1, max: 500, description: '提醒内容', descriptionI18n: { en: "Reminder text" } } },
  async execute({ input, params, use, locale }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const task = await service.add(reminderActor(input, locale), params.text, Date.now() + params.seconds * 1000, null);
      return `${t(locale, 'created')}\n${service.describe(task, locale)}`;
    });
  },
});
