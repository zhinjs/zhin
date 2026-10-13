import { defineCommand } from 'zhin.js/command';
import { reminderServiceToken } from '../../../src/runtime.js';
import { reminderActor, replyReminder } from '../../../src/caller.js';

export default defineCommand({
  description: '取消本人在当前会话的提醒',
  params: { id: { type: 'string', description: 'remind list 中的任务 ID' } },
  async execute({ input, params, use }) {
    return replyReminder(async () => await use(reminderServiceToken).cancel(reminderActor(input), params.id) ? '已取消提醒；已经开始的投递无法撤销' : '未找到你在此会话的提醒');
  },
});
