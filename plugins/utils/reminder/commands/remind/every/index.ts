import { reminderMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';
import { MAX_DELAY_SECONDS } from '../../../src/service.js';

export default defineCommand({
  description: '创建固定周期提醒', descriptionI18n: { en: "Create a recurring reminder with a fixed interval" },
  params: { seconds: { type: 'integer', min: 60, max: MAX_DELAY_SECONDS, description: '周期秒数（至少 60）', descriptionI18n: { en: "Interval in seconds (at least 60)" } }, text: { type: 'text', min: 1, max: 500, description: '提醒内容', descriptionI18n: { en: "Reminder text" } } },
  async execute({ input, params, use, locale }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const task = await service.add(reminderActor(input, locale), params.text, Date.now() + params.seconds * 1000, params.seconds * 1000);
      return `${t(locale, 'createdPeriodic')}\n${service.describe(task, locale)}`;
    });
  },
});
