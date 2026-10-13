import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';

export default defineCommand({
  description: '查看本人在当前会话的提醒',
  async execute({ input, use }) {
    return replyReminder(async () => {
      const service = use(reminderServiceToken);
      const tasks = await service.list(reminderActor(input));
      return tasks.length ? tasks.map(task => service.describe(task)).join('\n\n') : '你在此会话没有提醒任务';
    });
  },
});
