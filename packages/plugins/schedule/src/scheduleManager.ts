import { ScheduledTask, schedule } from 'node-cron';
import { NumString } from 'zhin';
export class ScheduleManager {
  schedules: ScheduledTask[] = [];
  addTask(cron: CronDescriptors, callback: Function) {
    const task = schedule(cron, () => callback());
    this.schedules.push(task);
    return task;
  }
  removeTask(id: number) {
    const task = this.schedules[id - 1];
    if (task) task.stop();
    this.schedules.splice(id - 1, 1);
  }
}

export type CronDescriptors =
  `${CronDescriptor} ${CronDescriptor} ${CronDescriptor} ${CronDescriptor} ${CronDescriptor} ${CronDescriptor}`;
type CronDescriptor = '*' | `*/${number}` | `${number}-${number}` | NumString<','>;
