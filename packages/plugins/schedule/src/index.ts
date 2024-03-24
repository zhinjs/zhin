import { MessageBase, Message, Plugin } from 'zhin';
import { CronDescriptors, ScheduleManager } from '@/scheduleManager';
import { ScheduledTask } from 'node-cron';
export type Schedule = {
  adapter: string;
  bot_id: string;
  from_id: string;
  from_type: string;
  creator_id: string;
  template: string;
  cron: string;
  create_time: number;
  message: MessageBase;
};
declare module 'zhin' {
  namespace App {
    interface Services {
      addTask(cron: CronDescriptors, callback: Function): ScheduledTask;
      removeTask(no: number): void;
    }
  }
}
const schedulePlugin = new Plugin('定时任务');
const scheduleManager = new ScheduleManager();
schedulePlugin.service('addTask', (cron: CronDescriptors, callback: Function) => {
  return scheduleManager.addTask(cron, callback);
});
schedulePlugin.service('removeTask', no => {
  return scheduleManager.removeTask(no);
});
const initialize = () => {
  const schedules = schedulePlugin.jsondb.get<Schedule[]>('schedule', []);
  if (!schedules) return;
  for (const schedule of schedules) {
    addSchedule(schedule);
  }
};
const addSchedule = (schedule: Schedule) => {
  const adapter = schedulePlugin.app!.adapters.get(schedule.adapter);
  if (!adapter) return;
  const bot = adapter?.bots.find(bot => bot.unique_id === schedule.bot_id);
  if (!bot) return;
  scheduleManager.addTask(schedule.cron as any, async () => {
    const message = Message.fromJSON(adapter, bot, schedule.message);
    const result = await schedulePlugin.app!.renderMessage(schedule.template, message);
    result && message.reply(result);
  });
};
const scheduleCommand = schedulePlugin.command('定时模块');
scheduleCommand.command('定时列表').action(({ adapter, bot, message }) => {
  const schedules = schedulePlugin.jsondb.filter<Schedule>('schedule', schedule => {
    return (
      schedule.adapter === adapter.name &&
      schedule.bot_id === bot.unique_id &&
      schedule.from_type === message.message_type &&
      schedule.from_id === message.from_id
    );
  });
  if (!schedules.length) return '暂无任务';
  return `已有任务：\n${schedules
    .map((schedule, index) => {
      return `${index + 1}.${schedule.cron} ${schedule.template}`;
    })
    .join('\n')}`;
});
scheduleCommand.command('添加定时').action(async ({ adapter, prompt, bot, message }) => {
  const cron = await prompt.text('请输入cron表达式');
  if (!cron) return;
  const template = await prompt.text('请输入需要执行的指令模板');
  if (!template) return;
  const schedule: Schedule = {
    from_id: message.from_id,
    from_type: message.message_type,
    template,
    cron,
    bot_id: bot.unique_id,
    adapter: adapter.name,
    creator_id: message.sender?.user_id + '',
    create_time: Date.now(),
    message: message.toJSON(),
  };
  schedulePlugin.jsondb.push<Schedule>('schedule', schedule);
  addSchedule(schedule);
  return '添加成功';
});
scheduleCommand
  .command('删除定时 <no:number>')
  .option('-c <confirm:boolean> 是否确认', false)
  .action(async ({ prompt, options, bot, message }, no) => {
    const schedule = schedulePlugin.jsondb.get<Schedule>(`schedule.${no - 1}`);
    if (!schedule) return '无此定时任务';
    if (schedule.creator_id !== `${message.sender?.user_id}`) return `非作者本人(${schedule.creator_id})不可删除`;
    const isConfirm = options.confirm || (await prompt.confirm('确认删除吗？'));
    if (!isConfirm) return '已取消删除';
    schedulePlugin.jsondb.splice('schedule', no - 1, 1);
    scheduleManager.removeTask(no);
    return '删除成功';
  });

schedulePlugin.mounted(() => {
  schedulePlugin.app!.on('ready', initialize);
});
schedulePlugin.beforeUnmount(() => {
  schedulePlugin.app!.off('ready', initialize);
});
export default schedulePlugin;
